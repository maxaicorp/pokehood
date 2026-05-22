// onchain-listings — Magic Eden listings proxy for the Onchain Marketplace tab.
//
// Mirrors the shape of onchain-activity but hits ME's /listings endpoint
// instead of /activities. Returned items become rows in the Marketplace table
// on /onchain. Admin-only access is enforced at the page level
// (AdminRouteGuard on the route) — this function itself is unauthenticated
// because Magic Eden's listings are public anyway.
//
// Allowlist of collection symbols is intentional: it stops someone from
// passing an arbitrary collection and using this function as a generic ME
// proxy, which would burn our rate limit on their behalf.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ME_API = "https://api-mainnet.magiceden.dev/v2";

const COLLECTIONS = [
  "collector_crypt",
  "collector_crypt_graded",
];

// Magic Eden listings endpoint returns up to 20 by default and caps at 100.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface RawAmount {
  rawAmount: string;
  address?: string;
  decimals: number;
}

interface MeListing {
  pdaAddress: string;
  tokenMint: string;
  auctionHouse?: string;
  seller: string;
  sellerReferral?: string;
  tokenAddress: string;
  tokenSize: number;
  price: number;             // SOL-equivalent (always)
  priceInfo?: {
    solPrice?: RawAmount;
    splPrice?: RawAmount;    // present when listed in USDC etc.
  };
  rarity?: { howRare?: { rank?: number } };
  extra?: { img?: string };
  token?: { name?: string };
}

interface NormalizedListing {
  pdaAddress: string;
  tokenMint: string;
  collection: string;
  seller: string;
  price: number;
  // Pass priceInfo through so the frontend can render USDC vs SOL correctly.
  // Without this, we'd display every USDC listing as SOL.
  priceInfo?: MeListing["priceInfo"];
  name?: string;
  image?: string;
  rarityRank?: number | null;
  marketplaceUrl: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const collection = url.searchParams.get("collection") || "collector_crypt";
    const offset = url.searchParams.get("offset") || "0";
    const requestedLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Math.max(1, Math.min(MAX_LIMIT, isNaN(requestedLimit) ? DEFAULT_LIMIT : requestedLimit));
    // ME listings endpoint supports: offset, limit, min_price, max_price,
    // attributes, sort (listPrice), listingAggMode. It does NOT accept a
    // sortDirection param — passing it returns 500 "Missing field spec:
    // sortDirection". Direction is implicit (ascending by listPrice).
    const sort = url.searchParams.get("sort") || "listPrice";
    const minPrice = url.searchParams.get("min_price");
    const maxPrice = url.searchParams.get("max_price");

    if (!COLLECTIONS.includes(collection)) {
      return new Response(
        JSON.stringify({ error: "Invalid collection" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch a wider window from ME than the caller asked for so that, after
    // filtering out moonbirds / non-Pokémon items, we still have enough
    // entries to fill the requested page. Without this, the first ~80 ME
    // listings sorted by price are nearly all moonbirds and the page comes
    // back empty. ME caps `limit` at 100.
    const fetchLimit = 100;
    const fetchOffset = parseInt(offset, 10) * (fetchLimit / limit) || 0;
    const params = new URLSearchParams({
      offset: String(fetchOffset),
      limit: String(fetchLimit),
      sort,
    });

    if (minPrice) params.set("min_price", minPrice);
    if (maxPrice) params.set("max_price", maxPrice);

    const endpoint = `${ME_API}/collections/${collection}/listings?${params.toString()}`;

    const res = await fetch(endpoint, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`Magic Eden API error [${res.status}]: ${await res.text()}`);
    }

    const raw = (await res.json()) as MeListing[];
    // Normalize so the frontend doesn't depend on ME's exact shape.
    // Also drop non-Pokémon items — the Collector Crypt platform tokenizes
    // other brands' physical items (currently "moonbirds physical collectible")
    // and they share the same collection symbol on Magic Eden. They display
    // as identical mystery-pack placeholders and have no Pokémon trait data,
    // so they're noise on the marketplace tab. Filter by exact name match
    // for now; expand the blocklist when other non-Pokémon items appear.
    //
    // Items with NO name are kept — they may be legitimate listings whose
    // token metadata isn't indexed yet, and rendering them with just price +
    // image is better than blank-screening the page.
    const NAME_BLOCKLIST = new Set(["moonbirds physical collectible"]);
    const allItems: NormalizedListing[] = (raw ?? [])
      .filter((l) => {
        const nm = (l.token?.name ?? "").trim().toLowerCase();
        if (NAME_BLOCKLIST.has(nm)) return false;
        return true;
      })
      .map((l) => ({
        pdaAddress: l.pdaAddress,
        tokenMint: l.tokenMint,
        collection,
        seller: l.seller,
        price: l.price,
        priceInfo: l.priceInfo,
        name: l.token?.name,
        image: l.extra?.img,
        rarityRank: l.rarity?.howRare?.rank ?? null,
        marketplaceUrl: `https://magiceden.us/item-details/${l.tokenMint}`,
      }));

    // Slice down to what the caller actually asked for.
    const items = allItems.slice(0, limit);

    // Optionally fetch total listings count for the collection. Used by the
    // frontend's "Price: High to Low" sort, which has to walk offsets from
    // the end (Magic Eden's listings endpoint sorts ascending only). The
    // /stats endpoint is cheap and returns listedCount alongside floor/vol.
    let totalListings: number | null = null;
    if (url.searchParams.get("include_total") === "1") {
      try {
        const sRes = await fetch(`${ME_API}/collections/${collection}/stats`, {
          headers: { Accept: "application/json" },
        });
        if (sRes.ok) {
          const s = await sRes.json();
          totalListings = Number(s?.listedCount ?? null) || null;
        }
      } catch {
        // Non-fatal — frontend can fall back to a default if total is null.
      }
    }

    return new Response(JSON.stringify({ items, totalListings }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
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
