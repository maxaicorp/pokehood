// Sealed product price snapshot function
// Fetches sealed product prices from Scrydex and stores in price_snapshots.
// Runs independently from card snapshots to avoid timeout issues.

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
  expansion: { id: string; name: string; release_date?: string };
  variants: Array<{
    name: string;
    prices: Array<{ low: number; market: number; currency: string }>;
  }>;
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

  const scrydexHeaders = { "X-Api-Key": apiKey, "X-Team-ID": teamId };
  const today = new Date().toISOString().split("T")[0];

  try {
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
          console.error(`Page ${page}: insert error:`, error.message);
          totalSkipped += rows.length;
        } else {
          totalSaved += rows.length;
        }
      }

      console.log(`Page ${page}: ${res.data.length} fetched, ${products.length} after case filter, ${rows.length} priced`);

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
