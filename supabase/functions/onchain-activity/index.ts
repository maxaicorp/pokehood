import { corsHeaders } from "@supabase/supabase-js/cors";

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
    const offset = url.searchParams.get("offset") || "0";
    const limit = url.searchParams.get("limit") || "20";
    const type = url.searchParams.get("type") || ""; // buyNow, list, delist, bid, cancelBid

    // Validate collection is in allowlist
    if (!COLLECTIONS.includes(collection)) {
      return new Response(
        JSON.stringify({ error: "Invalid collection" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let endpoint = `${ME_API}/collections/${collection}/activities?offset=${offset}&limit=${limit}`;
    if (type) endpoint += `&type=${type}`;

    const res = await fetch(endpoint, {
      headers: { "Accept": "application/json" },
    });

    if (!res.ok) {
      throw new Error(`Magic Eden API error [${res.status}]: ${await res.text()}`);
    }

    const data = await res.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("onchain-activity error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
