const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Never let Supabase's edge CDN or any intermediate proxy cache this response.
// Without these headers the same activity payload can stick around for minutes
// even though the front-end is refetching every 30s, which is exactly the
// "Sales tab stuck on old cards" symptom we saw.
const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
};

const ME_API = "https://api-mainnet.magiceden.dev/v2";

// Known Collector Crypt collections on Magic Eden
const COLLECTIONS = [
  "collector_crypt",
  "collector_crypt_graded",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const collection = url.searchParams.get("collection") || "collector_crypt";
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const type = url.searchParams.get("type") || ""; // buyNow, list, delist, bid, cancelBid

    // Validate collection is in allowlist
    if (!COLLECTIONS.includes(collection)) {
      return new Response(
        JSON.stringify({ error: "Invalid collection" }),
        { status: 400, headers: { ...corsHeaders, ...noStoreHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch a wider window from ME than the caller asked for so that, after
    // strict server-side filtering, we can still satisfy the requested page.
    // ME caps `limit` at 500; we pull 200 which comfortably covers ~10 pages
    // of buyNow filtering even on busy collections.
    const fetchLimit = type ? 200 : Math.min(limit + 1, 100);
    // Cache-bust through any upstream/edge proxies between us and Magic Eden.
    const cacheBuster = `_t=${Date.now()}`;
    let endpoint = `${ME_API}/collections/${collection}/activities?offset=0&limit=${fetchLimit}&${cacheBuster}`;
    if (type) endpoint += `&type=${type}`;

    const res = await fetch(endpoint, {
      headers: { "Accept": "application/json" },
      // Deno's fetch has its own caching; force a network hit every time.
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Magic Eden API error [${res.status}]: ${await res.text()}`);
    }

    const raw = await res.json();
    const list: Array<{ type: string; blockTime: number }> = Array.isArray(raw) ? raw : [];

    // Strict server-side filter — ME's `type=` param has been observed to leak
    // neighbouring event types in the past. Belt + suspenders. When the user
    // picks "Sales", we ONLY return type=buyNow, never bids or listings.
    const filtered = type ? list.filter((a) => a.type === type) : list;

    // Newest first, then page server-side so the client always sees the
    // freshest matching events even after filtering.
    filtered.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
    const paged = filtered.slice(offset, offset + limit);

    return new Response(JSON.stringify(paged), {
      headers: { ...corsHeaders, ...noStoreHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("onchain-activity error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, ...noStoreHeaders, "Content-Type": "application/json" } }
    );
  }
});
