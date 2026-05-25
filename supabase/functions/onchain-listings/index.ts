// onchain-listings — public READ proxy for the Marketplace tab.
//
// Reads from onchain_listings (populated by ingest-onchain-listings cron).
// Magic Eden is NOT called from this path. The DB index handles both
// directions of price sort natively, so the prior "walk from the end with
// include_total" gymnastics for "Price: High to Low" are gone.
//
// Response shape preserved: { items: NormalizedListing[], totalListings? }
// so the existing Onchain.tsx marketplace branch keeps working unchanged.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const cacheHeaders = {
  "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60",
};

const COLLECTIONS = new Set(["collector_crypt", "collector_crypt_graded"]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const collection = url.searchParams.get("collection") || "collector_crypt";
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") || "20", 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    // Accept the legacy "sort" param (listPrice|createdAt) used by older
    // frontend builds, but normalize to our DB-native sort tokens.
    const rawSort = url.searchParams.get("sort") || "price-asc";
    const sort =
      rawSort === "createdAt" ? "recent"
      : rawSort === "listPrice" ? "price-asc"
      : rawSort === "price-desc" ? "price-desc"
      : rawSort === "recent" ? "recent"
      : "price-asc";

    if (!COLLECTIONS.has(collection)) {
      return new Response(
        JSON.stringify({ error: "Invalid collection" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data, error } = await supabase.rpc("get_onchain_listings", {
      p_collection: collection,
      p_sort: sort,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw new Error(`get_onchain_listings: ${error.message}`);

    const items = (data ?? []).map((r: any) => ({
      pdaAddress: r.pda_address,
      tokenMint: r.token_mint,
      collection: r.collection,
      seller: r.seller,
      price: Number(r.price),
      priceInfo: r.price_info ?? undefined,
      name: r.name ?? undefined,
      image: r.image ?? undefined,
      rarityRank: r.rarity_rank,
      marketplaceUrl: r.marketplace_url,
    }));

    // Optional total count — preserved for callers that still ask for it
    // (e.g. older frontend builds). Cheap because the partial index on
    // (collection) WHERE delisted_at IS NULL keeps the count narrow.
    let totalListings: number | null = null;
    if (url.searchParams.get("include_total") === "1") {
      const { count } = await supabase
        .from("onchain_listings")
        .select("pda_address", { count: "exact", head: true })
        .eq("collection", collection)
        .is("delisted_at", null);
      totalListings = count ?? null;
    }

    return new Response(JSON.stringify({ items, totalListings }), {
      headers: { ...corsHeaders, ...cacheHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("onchain-listings error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
