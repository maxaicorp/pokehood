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
const HELIUS_RPC = "https://mainnet.helius-rpc.com";

// Enrich activity rows with card names via Helius getAssetBatch. Takes ME's
// activity objects (which only have tokenMint, no name) and returns them with
// a `name` field added wherever we can resolve it. Best-effort: any error
// returns the activities unchanged so the page still loads.
//
// One Helius RPC call covers up to ~1000 mints per batch. Our page sizes are
// way below that. ~1 Helius credit per page load.
interface ActivityRow {
  tokenMint?: string;
  name?: string;
  [k: string]: unknown;
}

async function enrichWithNames<T extends ActivityRow>(rows: T[]): Promise<T[]> {
  const apiKey = Deno.env.get("HELIUS_API_KEY");
  if (!apiKey || rows.length === 0) return rows;
  const uniqueMints = [...new Set(rows.map((r) => r.tokenMint).filter((m): m is string => !!m))];
  if (uniqueMints.length === 0) return rows;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${HELIUS_RPC}/?api-key=${apiKey}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "onchain-activity-enrich",
        method: "getAssetBatch",
        params: { ids: uniqueMints },
      }),
    });
    clearTimeout(timeoutId);
    if (!res.ok) return rows;

    const j = await res.json() as {
      result?: Array<{ id?: string; content?: { metadata?: { name?: string } } }>;
    };
    const nameByMint = new Map<string, string>();
    for (const asset of j.result ?? []) {
      const id = asset?.id;
      const name = asset?.content?.metadata?.name;
      if (id && name) nameByMint.set(id, name);
    }
    if (nameByMint.size === 0) return rows;

    return rows.map((r) => {
      const name = r.tokenMint ? nameByMint.get(r.tokenMint) : undefined;
      return name ? { ...r, name } : r;
    });
  } catch (e) {
    console.error("enrichWithNames failed:", e);
    return rows;
  }
}

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

    // Enrich with card names via Helius getAssetBatch. ME's activity feed
    // includes only tokenMint, not the card name — so without this step every
    // Activity row would show "Mint: EkFq...dEyq" with no human-readable
    // title. One Helius RPC call covers all unique mints in the page (20-200
    // mints, ~1 Helius credit). Strictly best-effort: any failure here just
    // returns the events without names rather than failing the request.
    const enriched = await enrichWithNames(paged);

    return new Response(JSON.stringify(enriched), {
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
