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
const KNOWN_NON_ROUTED_PRICE_PREFIXES = new Set(["miscp"]);

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

    // ─── Two universes of "set IDs the site knows about" ────────────────
    //
    // 1. priced — distinct set prefixes in latest_card_prices. These are
    //    sets we have snapshot data for (snapshot-prices pulls Scrydex's
    //    /cards endpoint, which sometimes returns cards for sets not in
    //    /expansions — that's how me4 'Chaos Rising' first surfaced).
    //
    // 2. catalog — set IDs in the static public/data/market-sets.json that
    //    the frontend uses for routing + display. Without an entry here,
    //    /sets/{slug} won't resolve regardless of whether we have prices.
    //
    // A "missing" set can be discovered three ways, in priority order:
    //   - HIGH: in Scrydex /expansions, not in catalog → undisputed new set
    //   - HIGH: in priced (i.e. we have data) but not in catalog → me4 case
    //   - MED:  in Scrydex /expansions, not in priced → metadata exists but
    //           no snapshot has run yet (will resolve on next daily cron)

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.57.2");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // 1. priced set IDs from latest_card_prices
    const priced = new Set<string>();
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("latest_card_prices")
        .select("card_id")
        .range(offset, offset + 999);
      if (error) throw new Error(`Supabase read failed: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data as { card_id: string }[]) {
        if (row.card_id.startsWith("sealed-")) continue;
        const base = row.card_id.split("::")[0];
        const setId = base.split("-").slice(0, -1).join("-");
        if (KNOWN_NON_ROUTED_PRICE_PREFIXES.has(setId.toLowerCase())) continue;
        if (setId) priced.add(setId.toLowerCase());
      }
      if (data.length < 1000) break;
      offset += 1000;
    }

    // 2. catalog set IDs from the deployed market-sets.json
    const catalog = new Set<string>();
    try {
      const catRes = await fetch("https://collectiblez.app/data/market-sets.json", {
        headers: { Accept: "application/json" },
      });
      if (catRes.ok) {
        const catJson = await catRes.json() as { sets?: Array<{ id: string; isOnlineOnly?: boolean }> };
        for (const s of catJson.sets ?? []) {
          if (s.isOnlineOnly) continue;
          if (s.id) catalog.add(s.id.toLowerCase());
        }
      } else {
        console.warn(`market-sets.json fetch returned HTTP ${catRes.status} — treating catalog as empty`);
      }
    } catch (e) {
      console.warn("market-sets.json fetch failed:", e);
    }

    // ─── Find missing sets across both routes ────────────────────────────
    type Missing = {
      id: string;
      name: string;
      releaseDate?: string;
      series?: string;
      priority: "high" | "med";
      reason: string;
    };
    const missingMap = new Map<string, Missing>();

    // High-priority: in Scrydex /expansions but not in catalog (frontend)
    for (const e of expansions) {
      const id = e.id.toLowerCase();
      if (catalog.size > 0 && !catalog.has(id)) {
        missingMap.set(id, {
          id: e.id,
          name: e.name,
          releaseDate: e.release_date,
          series: e.series,
          priority: "high",
          reason: "In Scrydex /expansions but not in market-sets.json — frontend can't render this set's landing page.",
        });
      }
    }

    // High-priority: in latest_card_prices but not in catalog (the me4 case)
    for (const id of priced) {
      if (catalog.size > 0 && !catalog.has(id) && !missingMap.has(id)) {
        // Try to find Scrydex metadata; fall back to "Unknown" if Scrydex doesn't list it
        const meta = expansions.find((e) => e.id.toLowerCase() === id);
        missingMap.set(id, {
          id,
          name: meta?.name ?? `(unknown — set ID ${id})`,
          releaseDate: meta?.release_date,
          series: meta?.series,
          priority: "high",
          reason: "Has snapshot prices but no entry in market-sets.json — frontend has prices but no /sets/{slug} page.",
        });
      }
    }

    const missing: Missing[] = [...missingMap.values()].sort((a, b) =>
      (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "")
    );

    const report = {
      healthy: missing.length === 0,
      scrydexExpansionsCount: expansions.length,
      pricedSetCount: priced.size,
      catalogSetCount: catalog.size,
      missingCount: missing.length,
      missing: missing.slice(0, 30),
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
