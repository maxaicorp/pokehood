// sol-price — tiny proxy that returns the current SOL/USD price.
//
// Why this exists:
// Magic Eden returns trade prices in SOL (via priceInfo.solPrice) and sometimes
// in USDC (via priceInfo.splPrice). To show a USD equivalent next to SOL prices
// on /onchain, we need a SOL/USD spot price. Hitting Jupiter from the browser
// works but adds a third-party CORS dependency and exposes our request pattern
// to whoever owns price.jup.ag. Routing through this edge function lets us
// swap providers (Jupiter -> CoinGecko -> Pyth) without touching the frontend,
// and cache server-side so we never hammer the upstream.
//
// Cache: 60s in-memory map (Deno isolates may evict; that's fine, worst case
// we fetch fresh). Front end has its own React Query 60s staleTime too, so
// the upstream gets at most ~1 hit per minute per active edge isolate.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const JUPITER_URL = "https://price.jup.ag/v6/price?ids=SOL";
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
const CACHE_TTL_MS = 60_000;

interface CachedPrice {
  price: number;
  source: "jupiter" | "coingecko";
  fetchedAt: number;
}

let cache: CachedPrice | null = null;

async function fetchJupiter(): Promise<number | null> {
  try {
    const r = await fetch(JUPITER_URL, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const p = j?.data?.SOL?.price;
    return typeof p === "number" && p > 0 ? p : null;
  } catch {
    return null;
  }
}

async function fetchCoinGecko(): Promise<number | null> {
  try {
    const r = await fetch(COINGECKO_URL, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const p = j?.solana?.usd;
    return typeof p === "number" && p > 0 ? p : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Serve from cache when fresh.
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return new Response(
      JSON.stringify({ ...cache, cached: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Try Jupiter first, fall back to CoinGecko.
  let price = await fetchJupiter();
  let source: CachedPrice["source"] = "jupiter";
  if (price == null) {
    price = await fetchCoinGecko();
    source = "coingecko";
  }

  if (price == null) {
    // Both upstreams failed. Return the last good cache value if we have one
    // (even if expired) so the UI doesn't lose the USD column entirely.
    if (cache) {
      return new Response(
        JSON.stringify({ ...cache, cached: true, stale: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: "sol-price upstreams unavailable" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  cache = { price, source, fetchedAt: Date.now() };
  return new Response(
    JSON.stringify({ ...cache, cached: false }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
