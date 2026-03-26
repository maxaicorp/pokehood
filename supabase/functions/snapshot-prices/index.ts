// Daily price snapshot cron function
// Fetches current market prices from TCGdex for recent set cards and stores them.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TCGDEX_SETS_URL = "https://api.tcgdex.net/v2/en/sets";

interface TcgdexSetBrief {
  id: string;
  name: string;
}

interface TcgdexSetDetail {
  id: string;
  name: string;
  releaseDate?: string;
  cards?: Array<{ id: string; name: string; image?: string }>;
}

interface TcgdexCardPricing {
  id: string;
  name: string;
  set?: { name?: string };
  pricing?: {
    cardmarket?: {
      updated?: string;
      unit?: string;
      avg?: number;
      low?: number;
      trend?: number;
      avg1?: number;
      avg7?: number;
      avg30?: number;
    };
  };
}

function extractMarketPrice(data: TcgdexCardPricing): number | null {
  const cm = data.pricing?.cardmarket;
  if (cm) {
    // Prefer trend, then avg, then low
    if (cm.trend != null && cm.trend > 0) return cm.trend;
    if (cm.avg != null && cm.avg > 0) return cm.avg;
    if (cm.low != null && cm.low > 0) return cm.low;
  }
  return null;
}

/** Fetch live EUR→USD exchange rate */
async function getEurToUsdRate(): Promise<number> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/EUR");
    if (res.ok) {
      const data = await res.json();
      const rate = data?.rates?.USD;
      if (typeof rate === "number" && rate > 0) {
        console.log(`EUR→USD rate: ${rate}`);
        return rate;
      }
    }
  } catch (e) {
    console.warn("Failed to fetch exchange rate, using fallback:", e);
  }
  // Fallback rate if API fails
  console.log("Using fallback EUR→USD rate: 1.08");
  return 1.08;
}

/** Fetch with timeout + retry */
async function fetchJson<T>(url: string, retries = 2): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(url, { signal: controller.signal });
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
    // 1. Get all sets
    const allSets = await fetchJson<TcgdexSetBrief[]>(TCGDEX_SETS_URL);
    if (!allSets) throw new Error("Failed to fetch sets from TCGdex");

    console.log(`Fetched ${allSets.length} sets from TCGdex, fetching details for release dates...`);

    // 2. Fetch live EUR→USD exchange rate
    const eurToUsd = await getEurToUsdRate();

    // 3. Fetch details for all sets to get release dates (batch 10 at a time)
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

    // 3. Sort by release date, pick the 8 most recent
    setDetails.sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
    const recentSets = setDetails.slice(0, 8);

    console.log(
      `Snapshotting prices for ${recentSets.length} sets:`,
      recentSets.map((s) => `${s.name} (${s.releaseDate})`)
    );

    // 4. For each set, fetch pricing for each card
    let totalInserted = 0;
    let totalSkipped = 0;
    const today = new Date().toISOString().split("T")[0];

    for (const set of recentSets) {
      if (!set.cards?.length) {
        console.log(`  ${set.name}: no cards found, skipping`);
        continue;
      }

      console.log(`  ${set.name}: ${set.cards.length} cards`);

      const rows: Array<{
        card_id: string;
        card_name: string;
        set_name: string;
        price: number;
        recorded_at: string;
      }> = [];

      const cardList = set.cards;
      const cardBatchSize = 5;

      for (let i = 0; i < cardList.length; i += cardBatchSize) {
        const batch = cardList.slice(i, i + cardBatchSize);
        const results = await Promise.all(
          batch.map((c) =>
            fetchJson<TcgdexCardPricing>(
              `https://api.tcgdex.net/v2/en/cards/${c.id}`
            )
          )
        );

        for (const data of results) {
          if (!data) continue;
          const priceEur = extractMarketPrice(data);
          if (priceEur !== null && priceEur > 0) {
            const price = Math.round(priceEur * eurToUsd * 100) / 100; // Convert EUR → USD
            rows.push({
              card_id: data.id,
              card_name: data.name ?? "",
              set_name: data.set?.name ?? set.name,
              price,
              recorded_at: today,
            });
          }
        }

        if (i + cardBatchSize < cardList.length) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      // 5. Upsert into price_snapshots
      if (rows.length > 0) {
        const { error } = await supabase
          .from("price_snapshots")
          .upsert(rows, { onConflict: "card_id,recorded_at" });

        if (error) {
          console.error(`  ${set.name}: insert error:`, error.message);
          totalSkipped += rows.length;
        } else {
          totalInserted += rows.length;
          console.log(`  ${set.name}: ${rows.length} prices saved`);
        }
      }
    }

    // 6. Cleanup: remove snapshots older than 90 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    await supabase
      .from("price_snapshots")
      .delete()
      .lt("recorded_at", cutoffStr);

    const summary = {
      success: true,
      date: today,
      sets_processed: recentSets.length,
      prices_saved: totalInserted,
      prices_skipped: totalSkipped,
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
