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

// Jupiter is our primary source because (a) with a JUPITER_API_KEY set as a
// Supabase secret it has no rate-limit risk for our traffic, and (b) its
// price reads the same Solana DEX liquidity that Magic Eden's UI displays,
// so the USD subtitles we render line up with what users see on ME.
const JUPITER_URL = "https://price.jup.ag/v6/price?ids=SOL";
// Pyth Hermes is the fallback. Free HTTP, no auth, but Pyth blocks some
// regions/IPs aggressively (verified 2026-05-21 from local), so we don't
// trust it as primary. Pyth's number is CEX-aggregated and may differ from
// the Solana DEX price Jupiter reads by ~0.5% — fine for a fallback.
const PYTH_SOL_USD_ID = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const PYTH_URL = `https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=${PYTH_SOL_USD_ID}`;
const CACHE_TTL_MS = 60_000;

interface CachedPrice {
  price: number;
  source: "jupiter" | "pyth";
  fetchedAt: number;
}

let cache: CachedPrice | null = null;

async function fetchPyth(): Promise<number | null> {
  try {
    const r = await fetch(PYTH_URL, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    // Response shape: { parsed: [{ price: { price: "1499950000", expo: -8, ... } }] }
    const entry = j?.parsed?.[0]?.price;
    if (!entry) return null;
    const raw = Number(entry.price);
    const expo = Number(entry.expo);
    if (!Number.isFinite(raw) || !Number.isFinite(expo)) return null;
    const price = raw * Math.pow(10, expo);
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function fetchJupiter(): Promise<number | null> {
  try {
    // Optional Jupiter Pro key for higher rate limits. If the JUPITER_API_KEY
    // secret is set in Supabase, we send it as x-api-key; otherwise the call
    // hits the free unauthenticated endpoint (shared IP rate limit applies).
    const apiKey = Deno.env.get("JUPITER_API_KEY");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;
    const r = await fetch(JUPITER_URL, { headers });
    if (!r.ok) return null;
    const j = await r.json();
    const p = j?.data?.SOL?.price;
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

  // Try Jupiter first (matches what Magic Eden shows). Pyth as fallback.
  let price = await fetchJupiter();
  let source: CachedPrice["source"] = "jupiter";
  if (price == null) {
    price = await fetchPyth();
    source = "pyth";
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
