// Sealed product price snapshot function
// Fetches sealed product prices from Scrydex and stores in price_snapshots.
// Runs independently from card snapshots to avoid timeout issues.
//
// Filters applied:
//   - English only (language_code === "EN", treat missing as non-EN)
//   - No "Case" wholesale products
//   - Must have a market price > 0
//   - Prefers USD market price first

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SCRYDEX_BASE = "https://api.scrydex.com";
// Bump on deploy so logs/health confirm which code is live.
const FUNCTION_VERSION = "2026-05-28-phase2-coverage-guard";
const FETCH_RETRIES = 2;

// Free balance probe (does not cost a credit). Pre-flight so we abort a
// credit-starved run instead of 403ing every page.
async function getScrydexCredits(headers: Record<string, string>): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${SCRYDEX_BASE}/account/v1/usage`, { signal: controller.signal, headers });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const c = data?.data?.credits_remaining;
    return typeof c === "number" ? c : null;
  } catch {
    return null;
  }
}

interface ScrydexSealedProduct {
  id: string;
  name: string;
  type: string;
  description?: string;
  images?: Array<{ small?: string; medium?: string; large?: string }>;
  expansion: {
    id: string;
    name: string;
    series?: string;
    logo?: string;
    release_date?: string;
    language_code?: string;
    is_online_only?: boolean;
  };
  variants: Array<{
    name: string;
    prices: Array<{
      low: number;
      market: number;
      currency: string;
      condition?: string;
      type?: string;
    }>;
  }>;
}

/** Extract best market price — prefer USD, fall back to any currency */
function getSealedPrice(product: ScrydexSealedProduct): number | null {
  // Prefer USD market price
  for (const variant of product.variants) {
    for (const price of variant.prices) {
      if (price.currency === "USD" && price.market > 0) return price.market;
    }
  }
  // Any currency market price
  for (const variant of product.variants) {
    for (const price of variant.prices) {
      if (price.market > 0) return price.market;
    }
  }
  // Low price as last resort
  for (const variant of product.variants) {
    for (const price of variant.prices) {
      if (price.currency === "USD" && price.low > 0) return price.low;
    }
  }
  return null;
}

async function fetchPage(
  url: string,
  headers: Record<string, string>
): Promise<{ data: ScrydexSealedProduct[]; total_count: number } | null> {
  // Retry transient failures before giving up — a page that fails every attempt
  // marks the run incomplete, which skips the read-cache refresh.
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(url, { signal: controller.signal, headers });
      clearTimeout(timeout);
      if (res.ok) return await res.json();
      console.error(`Scrydex ${res.status} (attempt ${attempt + 1}/${FETCH_RETRIES + 1}): ${await res.text().catch(() => "")}`);
    } catch (e) {
      console.error(`Fetch error (attempt ${attempt + 1}/${FETCH_RETRIES + 1}):`, e);
    }
    if (attempt < FETCH_RETRIES) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("SCRYDEX_API_KEY") ?? "";
  const teamId = Deno.env.get("SCRYDEX_TEAM_ID") ?? "";

  if (!apiKey || !teamId) {
    return new Response(
      JSON.stringify({ error: "Missing Scrydex credentials" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  // ── Auth: require either CRON_SECRET header (scheduler) or admin JWT ──
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  let authorized = !!(cronSecret && providedSecret && providedSecret === cronSecret);
  if (!authorized) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: u } = await supabase.auth.getUser(token);
      if (u?.user) {
        const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
        authorized = !!isAdmin;
      }
    }
  }
  if (!authorized) {
    return new Response(
      JSON.stringify({ error: "Unauthorized — admin or cron secret required" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
    );
  }

  const scrydexHeaders = { "X-Api-Key": apiKey, "X-Team-ID": teamId };
  const today = new Date().toISOString().split("T")[0];

  try {
    // Idempotency guard. A successful sealed run writes ~600 rows. If we're
    // already past 500 sealed snapshots for today, the caller is almost
    // certainly a duplicate (stuck cron, manual + cron) and should not spend
    // more Scrydex credits. Pass { force: true } in the body to override.
    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;
    if (!force) {
      const { count: existingToday } = await supabase
        .from("price_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("recorded_at", today)
        .like("card_id", "sealed-%");
      const have = existingToday ?? 0;
      if (have >= 500) {
        console.log(`[skip] ${have} sealed rows already exist for ${today} — skipping (override with force:true)`);
        return new Response(
          JSON.stringify({ success: true, skipped: true, today_count: have, reason: "already-snapshotted-today" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Pre-flight credit check (free). Abort cleanly if we can't afford a run
    // rather than 403ing every page and reporting a confusing partial.
    const SEALED_EST_COST = 30; // ~26 pages × 1 credit
    const creditsRemaining = await getScrydexCredits(scrydexHeaders);
    if (creditsRemaining != null && creditsRemaining < SEALED_EST_COST) {
      console.warn(`[preflight] ${creditsRemaining} credits < est ${SEALED_EST_COST} — aborting (insufficient_credits). ${FUNCTION_VERSION}`);
      return new Response(
        JSON.stringify({ success: false, reason: "insufficient_credits", credits_remaining: creditsRemaining, estimated_cost: SEALED_EST_COST, version: FUNCTION_VERSION }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }

    const pageSize = 100;
    let page = 1;
    let totalSaved = 0;
    let totalSkipped = 0;
    let totalCatalog = 0;
    let creditsUsed = 0;
    let failed = false;

    while (true) {
      const url = `${SCRYDEX_BASE}/pokemon/v1/sealed?pageSize=${pageSize}&page=${page}&include=prices&orderBy=-expansion.release_date`;
      const res = await fetchPage(url, scrydexHeaders);
      creditsUsed++;

      // Distinguish a hard fetch failure (null, after retries) from a genuinely
      // empty page (true end of data). The old `!res?.data?.length` lumped them
      // together, so a mid-run Scrydex failure looked like "done" and reported
      // success with partial data.
      if (res === null) {
        console.error(`[sealed] Page ${page}: fetch failed after retries — marking run INCOMPLETE`);
        failed = true;
        break;
      }
      if (!res.data?.length) break; // genuine end of data

      const rows: Array<{
        card_id: string;
        card_name: string;
        set_name: string;
        price: number;
        recorded_at: string;
      }> = [];

      // Catalog rows — the product metadata the Sealed tab renders. Built from
      // the SAME data this function already fetches for prices, so keeping the
      // catalog current is essentially free. This is what eliminates the manual
      // sync-scrydex-sealed.js step that silently broke for ~7 weeks.
      const catalogRows: Array<Record<string, unknown>> = [];

      for (const product of res.data) {
        // English physical only — treat missing language_code as non-English
        if (product.expansion?.language_code !== "EN") continue;
        // No "Case" wholesale products
        if (product.name.toLowerCase().includes("case")) continue;

        const price = getSealedPrice(product);
        if (!price || price <= 0) continue;

        rows.push({
          card_id: `sealed-${product.id}`,
          card_name: product.name,
          set_name: product.expansion.name,
          price,
          recorded_at: today,
        });

        const img = product.images?.[0] ?? {};
        catalogRows.push({
          id: product.id,
          name: product.name,
          type: product.type ?? "",
          description: product.description ?? "",
          image_small: img.small ?? "",
          image_medium: img.medium ?? "",
          expansion_id: product.expansion?.id ?? "",
          expansion_name: product.expansion?.name ?? "",
          expansion_series: product.expansion?.series ?? "",
          expansion_release_date: (product.expansion?.release_date ?? "").replace(/\//g, "-"),
          expansion_logo: product.expansion?.logo ?? "",
          variants: product.variants ?? [],
          updated_at: new Date().toISOString(),
        });
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from("price_snapshots")
          .upsert(rows, { onConflict: "card_id,recorded_at" });

        if (error) {
          console.error(`Page ${page}: insert error:`, error.message);
          totalSkipped += rows.length;
        } else {
          totalSaved += rows.length;
        }
      }

      if (catalogRows.length > 0) {
        const { error: catErr } = await supabase
          .from("sealed_products")
          .upsert(catalogRows, { onConflict: "id" });
        if (catErr) {
          console.error(`Page ${page}: catalog upsert error:`, catErr.message);
        } else {
          totalCatalog += catalogRows.length;
        }
      }

      console.log(`Page ${page}: ${res.data.length} fetched, ${rows.length} priced, ${catalogRows.length} catalog`);

      if (res.data.length < pageSize) break;
      page++;
      await new Promise((r) => setTimeout(r, 150));
    }

    // Refresh the read cache so sealed prices + deltas are fresh WITHOUT waiting
    // for the card cron. Only on a complete run — a partial leaves last-good data
    // intact. Fixes the coupling where sealed freshness depended on snapshot-prices.
    if (!failed) {
      try {
        const { error } = await supabase.rpc("refresh_latest_card_prices");
        if (error) console.error("[sealed] refresh_latest_card_prices failed:", error.message);
        else console.log(`[sealed] read cache refreshed. ${FUNCTION_VERSION}`);
      } catch (e) {
        console.error("[sealed] refresh threw:", e);
      }
    } else {
      console.warn(`[sealed] PARTIAL run — skipped read-cache refresh to protect last-good data. ${FUNCTION_VERSION}`);
    }

    const summary = {
      success: !failed,
      partial: failed,
      version: FUNCTION_VERSION,
      date: today,
      sealed_saved: totalSaved,
      sealed_skipped: totalSkipped,
      catalog_upserted: totalCatalog,
      pages_fetched: page,
      scrydex_credits_used: creditsUsed,
    };
    console.log("Done:", JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: failed ? 207 : 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Sealed snapshot error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
