// scrydex-new-sets-check — detects new TCG sets released on Scrydex that
// haven't been added to our local set list yet.
//
// Problem this solves: our set metadata lives in two static files
// (public/data/market-sets.json, public/data/all-cards.json) baked into
// the frontend bundle. New sets (e.g. "Chaos Rising" released 2026-05-21)
// don't appear on the site until someone manually re-runs
// scripts/build-card-index.js and commits the regenerated JSON.
//
// This function compares Scrydex's current expansion list against the set
// IDs that have prices in latest_card_prices (which is the universe of
// sets the site can currently show). Any expansion ID in Scrydex that we
// have ZERO prices for is reported as "missing from site" — i.e. a new
// set that needs the build script to run.
//
// Returned shape:
//   { healthy: boolean, missing: [{id, name, releaseDate}], scrydexCount, localCount }
//
// Cron-able via the admin health page. When a new set appears, the admin
// sees an amber/red badge and knows to regenerate the static card index.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCRYDEX_API = "https://api.scrydex.com";

interface ScrydexExpansion {
  id: string;
  name: string;
  series?: string;
  release_date?: string;
  language_code?: string;
  is_online_only?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("SCRYDEX_API_KEY") ?? "";
  const teamId = Deno.env.get("SCRYDEX_TEAM_ID") ?? "";
  if (!apiKey || !teamId) {
    return new Response(
      JSON.stringify({ healthy: false, error: "Missing SCRYDEX_API_KEY or SCRYDEX_TEAM_ID" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    // ─── Fetch Scrydex's current expansion list ───────────────────────────
    // Scrydex's expansions endpoint returns all sets in one call (paginated
    // but small — ~200 sets total). Filter to English physical (excluding
    // TCG Pocket / digital-only) to match what our site shows.
    const expansionsRes = await fetch(`${SCRYDEX_API}/pokemon/v1/en/expansions?page_size=500`, {
      headers: { "X-Api-Key": apiKey, "X-Team-ID": teamId },
    });
    if (!expansionsRes.ok) {
      throw new Error(`Scrydex expansions fetch failed (${expansionsRes.status})`);
    }
    const expansionsJson = await expansionsRes.json() as { data?: ScrydexExpansion[] };
    const expansions = (expansionsJson.data ?? []).filter((e) =>
      e.language_code === "EN" &&
      !e.is_online_only &&
      (e.series ?? "").toLowerCase() !== "pokémon tcg pocket"
    );

    // ─── Compare against local set IDs in latest_card_prices ──────────────
    // We don't have a `sets` table; the source of truth for "sets the site
    // can display" is the distinct set prefix of card_ids in
    // latest_card_prices. Pull all distinct prefixes via the cached table.
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.57.2");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // latest_card_prices has card_id like "me2pt5-225" — extract the prefix
    // before the last "-". Paginate to get full coverage.
    const localSetIds = new Set<string>();
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("latest_card_prices")
        .select("card_id")
        .range(offset, offset + 999);
      if (error) {
        throw new Error(`Supabase read failed: ${error.message}`);
      }
      if (!data || data.length === 0) break;
      for (const row of data as { card_id: string }[]) {
        const base = row.card_id.split("::")[0];
        const setId = base.split("-").slice(0, -1).join("-");
        if (setId) localSetIds.add(setId.toLowerCase());
      }
      if (data.length < 1000) break;
      offset += 1000;
    }

    // ─── Find new sets ───────────────────────────────────────────────────
    const missing: Array<{ id: string; name: string; releaseDate?: string; series?: string }> = [];
    for (const e of expansions) {
      if (!localSetIds.has(e.id.toLowerCase())) {
        missing.push({
          id: e.id,
          name: e.name,
          releaseDate: e.release_date,
          series: e.series,
        });
      }
    }
    // Sort newest first so the most-recently-released missing sets surface first.
    missing.sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));

    const report = {
      healthy: missing.length === 0,
      scrydexCount: expansions.length,
      localCount: localSetIds.size,
      missingCount: missing.length,
      missing: missing.slice(0, 20), // cap response so a giant diff doesn't blow the body
      checkedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("scrydex-new-sets-check error:", msg);
    return new Response(
      JSON.stringify({ healthy: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
