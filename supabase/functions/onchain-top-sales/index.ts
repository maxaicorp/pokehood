// onchain-top-sales — public READ endpoint for the /onchain/top-sales tab.
//
// Returns the highest-USD buyNow sales for a collection within a rolling
// window (1d / 7d / 30d). All work is one indexed SELECT; ME + Helius are
// never touched on this path.
//
// Query params:
//   collection: collector_crypt | collector_crypt_graded   (default: collector_crypt)
//   window:     1 | 7 | 30                                 (default: 7, expressed in days)
//   limit:      1..200                                     (default: 50)
//   min_usd:    numeric                                    (default: 10 — skips $1 test noise)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const cacheHeaders = {
  "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=120",
};

const COLLECTIONS = new Set(["collector_crypt", "collector_crypt_graded"]);
const ALLOWED_WINDOWS = new Set([1, 7, 30]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const collection = url.searchParams.get("collection") || "collector_crypt";
    const windowDays = parseInt(url.searchParams.get("window") || "7", 10);
    const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get("limit") || "50", 10)));
    const minUsd = Math.max(0, Number(url.searchParams.get("min_usd") ?? "10"));

    if (!COLLECTIONS.has(collection)) {
      return new Response(
        JSON.stringify({ error: "Invalid collection" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!ALLOWED_WINDOWS.has(windowDays)) {
      return new Response(
        JSON.stringify({ error: "Invalid window — allowed: 1, 7, 30" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data, error } = await supabase.rpc("get_onchain_top_sales", {
      p_collection: collection,
      p_window_days: windowDays,
      p_min_usd: minUsd,
      p_limit: limit,
    });
    if (error) throw new Error(`get_onchain_top_sales: ${error.message}`);

    const items = (data ?? []).map((r: any) => ({
      signature: r.signature,
      type: r.type,
      source: r.source,
      tokenMint: r.token_mint,
      collection: r.collection,
      blockTime: Number(r.block_time),
      buyer: r.buyer ?? undefined,
      seller: r.seller ?? undefined,
      price: r.price != null ? Number(r.price) : 0,
      priceUsd: r.price_usd != null ? Number(r.price_usd) : null,
      priceInfo: r.price_info ?? undefined,
      image: r.image ?? undefined,
      name: r.name ?? undefined,
    }));

    return new Response(JSON.stringify({ items, window: windowDays, count: items.length }), {
      headers: { ...corsHeaders, ...cacheHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("onchain-top-sales error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
