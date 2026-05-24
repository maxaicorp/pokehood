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

interface ScrydexSealedProduct {
  id: string;
  name: string;
  type: string;
  expansion: {
    id: string;
    name: string;
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
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, { signal: controller.signal, headers });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`Scrydex ${res.status}: ${await res.text().catch(() => "")}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error("Fetch error:", e);
    return null;
  }
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

    const pageSize = 100;
    let page = 1;
    let totalSaved = 0;
    let totalSkipped = 0;
    let creditsUsed = 0;

    while (true) {
      const url = `${SCRYDEX_BASE}/pokemon/v1/sealed?pageSize=${pageSize}&page=${page}&include=prices&orderBy=-expansion.release_date`;
      const res = await fetchPage(url, scrydexHeaders);
      creditsUsed++;

      if (!res?.data?.length) break;

      const rows: Array<{
        card_id: string;
        card_name: string;
        set_name: string;
        price: number;
        recorded_at: string;
      }> = [];

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

      console.log(`Page ${page}: ${res.data.length} fetched, ${rows.length} saved`);

      if (res.data.length < pageSize) break;
      page++;
      await new Promise((r) => setTimeout(r, 150));
    }

    const summary = {
      success: true,
      date: today,
      sealed_saved: totalSaved,
      sealed_skipped: totalSkipped,
      pages_fetched: page,
      scrydex_credits_used: creditsUsed,
    };
    console.log("Done:", JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
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
