// Daily price snapshot cron function
// Fetches current market prices from TCGdex for recent set cards and stores them.
//
// Deploy: supabase functions deploy snapshot-prices
// Schedule: Add a pg_cron job or use Supabase dashboard to invoke daily at ~3 AM UTC
//   select cron.schedule('daily-price-snapshot', '0 3 * * *',
//     $$select net.http_post(url := '...',  headers := '...', body := '{}')$$);
//
// Or invoke manually: curl -X POST <SUPABASE_URL>/functions/v1/snapshot-prices

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// TCGdex set list endpoint
const TCGDEX_SETS_URL = "https://api.tcgdex.net/v2/en/sets";

interface TcgdexSetBrief {
  id: string;
  name: string;
  releaseDate?: string;
}

interface TcgdexSetDetail {
  id: string;
  name: string;
  cards?: Array<{ id: string; name: string; image?: string }>;
}

interface TcgdexCardPricing {
  id: string;
  name: string;
  set?: { name?: string };
  pricing?: {
    tcgplayer?: Record<
      string,
      {
        lowPrice?: number;
        midPrice?: number;
        highPrice?: number;
        marketPrice?: number;
      }
    >;
    cardmarket?: Record<string, number>;
  };
}

function extractMarketPrice(data: TcgdexCardPricing): number | null {
  // TCGPlayer only (USD). Cardmarket prices are EUR and would corrupt the
  // historical chart which uses USD as its currency baseline.
  const tcp = data.pricing?.tcgplayer;
  if (tcp) {
    for (const variant of ["holofoil", "normal", "reverseHolofoil", "firstEdition"]) {
      const v = tcp[variant];
      if (v?.marketPrice) return v.marketPrice;
      if (v?.midPrice) return v.midPrice;
    }
  }
  return null;
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
    // 1. Get all sets, pick the 8 most recent
    const allSets = await fetchJson<TcgdexSetBrief[]>(TCGDEX_SETS_URL);
    if (!allSets) throw new Error("Failed to fetch sets from TCGdex");

    const sorted = allSets
      .filter((s) => s.releaseDate)
      .sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
    const recentSets = sorted.slice(0, 8);

    console.log(
      `Snapshotting prices for ${recentSets.length} sets:`,
      recentSets.map((s) => s.name)
    );

    // 2. For each set, get its card list
    let totalInserted = 0;
    let totalSkipped = 0;
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    for (const set of recentSets) {
      const setDetail = await fetchJson<TcgdexSetDetail>(
        `${TCGDEX_SETS_URL}/${set.id}`
      );
      if (!setDetail?.cards?.length) {
        console.log(`  ${set.name}: no cards found, skipping`);
        continue;
      }

      console.log(`  ${set.name}: ${setDetail.cards.length} cards`);

      // 3. Fetch pricing for each card (batched, 5 at a time to be polite)
      const rows: Array<{
        card_id: string;
        card_name: string;
        set_name: string;
        price: number;
        recorded_at: string;
      }> = [];

      const cardList = setDetail.cards;
      const batchSize = 5;

      for (let i = 0; i < cardList.length; i += batchSize) {
        const batch = cardList.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((c) =>
            fetchJson<TcgdexCardPricing>(
              `https://api.tcgdex.net/v2/en/cards/${c.id}`
            )
          )
        );

        for (const data of results) {
          if (!data) continue;
          const price = extractMarketPrice(data);
          if (price !== null && price > 0) {
            rows.push({
              card_id: data.id,
              card_name: data.name ?? "",
              set_name: data.set?.name ?? set.name,
              price,
              recorded_at: today,
            });
          }
        }

        // Small delay between batches to avoid rate-limiting
        if (i + batchSize < cardList.length) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      // 4. Upsert into price_snapshots
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

    // 5. Optional cleanup: remove snapshots older than 90 days
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
