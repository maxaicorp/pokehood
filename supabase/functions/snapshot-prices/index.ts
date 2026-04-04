// Daily price snapshot cron function
// Fetches current market prices from TCGdex for recent set cards
// AND sealed product prices from Scrydex, storing them in price_snapshots.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TCGDEX_SETS_URL = "https://api.tcgdex.net/v2/en/sets";
const SCRYDEX_BASE = "https://api.scrydex.com";

// ── TCGdex types ──────────────────────────────────────────────────────────────

interface TcgdexSetBrief { id: string; name: string; }
interface TcgdexSetDetail {
  id: string; name: string; releaseDate?: string;
  cards?: Array<{ id: string; name: string; image?: string }>;
}
interface TcgdexCardPricing {
  id: string; name: string; set?: { name?: string };
  pricing?: {
    tcgplayer?: Record<string, { lowPrice?: number; midPrice?: number; highPrice?: number; marketPrice?: number }>;
    cardmarket?: Record<string, number>;
  };
}

// ── Scrydex sealed types ──────────────────────────────────────────────────────

interface ScrydexSealedProduct {
  id: string;
  name: string;
  type: string;
  expansion: { id: string; name: string; release_date?: string };
  variants: Array<{
    name: string;
    prices: Array<{ low: number; market: number; currency: string }>;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractMarketPrice(data: TcgdexCardPricing): { price: number; currency: "USD" | "EUR" } | null {
  const tcp = data.pricing?.tcgplayer;
  if (tcp) {
    for (const variant of ["holofoil", "normal", "reverseHolofoil", "firstEdition"]) {
      const v = tcp[variant];
      if (v?.marketPrice && v.marketPrice > 0) return { price: v.marketPrice, currency: "USD" };
      if (v?.midPrice && v.midPrice > 0) return { price: v.midPrice, currency: "USD" };
    }
  }
  const cm = data.pricing?.cardmarket;
  if (cm) {
    const isHolo = (cm["avg-holo"] ?? 0) > 0;
    const trend = isHolo ? cm["trend-holo"] : cm["trend"];
    const avg = isHolo ? cm["avg-holo"] : cm["avg"];
    const low = isHolo ? cm["low-holo"] : cm["low"];
    if (trend != null && trend > 0) return { price: trend, currency: "EUR" };
    if (avg != null && avg > 0) return { price: avg, currency: "EUR" };
    if (low != null && low > 0) return { price: low, currency: "EUR" };
  }
  return null;
}

function getSealedPrice(product: ScrydexSealedProduct): number | null {
  for (const variant of product.variants) {
    for (const price of variant.prices) {
      if (price.market > 0) return price.market;
      if (price.low > 0) return price.low;
    }
  }
  return null;
}

async function getEurToUsdRate(): Promise<number> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/EUR");
    if (res.ok) {
      const data = await res.json();
      const rate = data?.rates?.USD;
      if (typeof rate === "number" && rate > 0) return rate;
    }
  } catch (e) {
    console.warn("Exchange rate fetch failed, using fallback:", e);
  }
  return 1.08;
}

async function fetchJson<T>(url: string, retries = 2, headers?: Record<string, string>): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(url, { signal: controller.signal, headers });
      clearTimeout(timeout);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      if (attempt === retries) return null;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

// ── Sealed product snapshot via Scrydex ───────────────────────────────────────

async function snapshotSealedProducts(
  supabase: ReturnType<typeof createClient>,
  today: string
): Promise<{ saved: number; skipped: number; credits: number }> {
  const apiKey = Deno.env.get("SCRYDEX_API_KEY") ?? "";
  const teamId = Deno.env.get("SCRYDEX_TEAM_ID") ?? "";

  if (!apiKey || !teamId) {
    console.warn("Scrydex credentials missing, skipping sealed snapshot");
    return { saved: 0, skipped: 0, credits: 0 };
  }

  const scrydexHeaders = { "X-Api-Key": apiKey, "X-Team-ID": teamId };
  const pageSize = 100;
  let page = 1;
  let totalSaved = 0;
  let totalSkipped = 0;
  let totalCredits = 0;

  while (true) {
    const url = `${SCRYDEX_BASE}/pokemon/v1/sealed?pageSize=${pageSize}&page=${page}&include=prices&orderBy=-expansion.release_date`;
    const res = await fetchJson<{
      data: ScrydexSealedProduct[];
      total_count: number;
      page: number;
    }>(url, 1, scrydexHeaders);

    totalCredits++;

    if (!res?.data?.length) break;

    // Filter out "Case" products
    const products = res.data.filter(
      (p) => !p.name.toLowerCase().includes("case")
    );

    const rows: Array<{
      card_id: string;
      card_name: string;
      set_name: string;
      price: number;
      recorded_at: string;
    }> = [];

    for (const product of products) {
      const price = getSealedPrice(product);
      if (price != null && price > 0) {
        rows.push({
          card_id: `sealed-${product.id}`,
          card_name: product.name,
          set_name: product.expansion.name,
          price,
          recorded_at: today,
        });
      }
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from("price_snapshots")
        .upsert(rows, { onConflict: "card_id,recorded_at" });

      if (error) {
        console.error(`Sealed page ${page}: insert error:`, error.message);
        totalSkipped += rows.length;
      } else {
        totalSaved += rows.length;
      }
    }

    console.log(`  Sealed page ${page}: ${products.length} products (${rows.length} priced)`);

    if (res.data.length < pageSize) break;
    page++;
    await new Promise((r) => setTimeout(r, 200));
  }

  return { saved: totalSaved, skipped: totalSkipped, credits: totalCredits };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    const today = new Date().toISOString().split("T")[0];

    // ── 1. TCGdex card snapshots ──────────────────────────────────────────

    const allSets = await fetchJson<TcgdexSetBrief[]>(TCGDEX_SETS_URL);
    if (!allSets) throw new Error("Failed to fetch sets from TCGdex");

    const eurToUsd = await getEurToUsdRate();

    const setDetails: TcgdexSetDetail[] = [];
    const batchSize = 10;
    for (let i = 0; i < allSets.length; i += batchSize) {
      const batch = allSets.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((s) => fetchJson<TcgdexSetDetail>(`${TCGDEX_SETS_URL}/${s.id}`))
      );
      for (const r of results) {
        if (r?.releaseDate) setDetails.push(r);
      }
      if (i + batchSize < allSets.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    setDetails.sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
    const recentSets = setDetails.slice(0, 8);

    console.log(`Snapshotting cards for ${recentSets.length} sets`);

    let cardsSaved = 0;
    let cardsSkipped = 0;

    for (const set of recentSets) {
      if (!set.cards?.length) continue;

      const rows: Array<{
        card_id: string; card_name: string; set_name: string;
        price: number; recorded_at: string;
      }> = [];

      const cardBatchSize = 5;
      for (let i = 0; i < set.cards.length; i += cardBatchSize) {
        const batch = set.cards.slice(i, i + cardBatchSize);
        const results = await Promise.all(
          batch.map((c) => fetchJson<TcgdexCardPricing>(`https://api.tcgdex.net/v2/en/cards/${c.id}`))
        );
        for (const data of results) {
          if (!data) continue;
          const result = extractMarketPrice(data);
          if (result !== null) {
            const price = result.currency === "EUR"
              ? Math.round(result.price * eurToUsd * 100) / 100
              : result.price;
            rows.push({
              card_id: data.id,
              card_name: data.name ?? "",
              set_name: data.set?.name ?? set.name,
              price,
              recorded_at: today,
            });
          }
        }
        if (i + cardBatchSize < set.cards.length) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from("price_snapshots")
          .upsert(rows, { onConflict: "card_id,recorded_at" });
        if (error) {
          console.error(`  ${set.name}: insert error:`, error.message);
          cardsSkipped += rows.length;
        } else {
          cardsSaved += rows.length;
          console.log(`  ${set.name}: ${rows.length} prices saved`);
        }
      }
    }

    // ── 2. Scrydex sealed product snapshots ───────────────────────────────

    console.log("Snapshotting sealed products via Scrydex...");
    const sealed = await snapshotSealedProducts(supabase, today);
    console.log(`  Sealed: ${sealed.saved} saved, ${sealed.skipped} skipped (${sealed.credits} API credits used)`);

    // ── 3. Cleanup old snapshots ──────────────────────────────────────────

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    await supabase
      .from("price_snapshots")
      .delete()
      .lt("recorded_at", cutoff.toISOString().split("T")[0]);

    const summary = {
      success: true,
      date: today,
      cards_saved: cardsSaved,
      cards_skipped: cardsSkipped,
      sealed_saved: sealed.saved,
      sealed_skipped: sealed.skipped,
      scrydex_credits_used: sealed.credits,
    };
    console.log("Done:", summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Snapshot error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
