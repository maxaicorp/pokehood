// sync-cards-catalog — populates the `cards` DB table from Scrydex.
//
// Replaces the broken local script scripts/sync-scrydex-cards.js (stale anon key
// + obsolete proxy endpoint) AND the 9.9 MB static public/data/all-cards.json.
// The frontend now reads card metadata one row at a time from the `cards` table
// instead of downloading/parsing the whole index. New sets appear automatically
// (no "Card not found", searchable immediately).
//
// Catalog changes slowly → run WEEKLY (~235 pages × 1 credit). Idempotent upsert
// on id, so safe to re-run any time. EN only for now (JP is undervalued P2).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SCRYDEX_BASE = "https://api.scrydex.com";
const FUNCTION_VERSION = "2026-05-29-cards-catalog-v1";
const FETCH_RETRIES = 2;

interface ScrydexCard {
  id: string;
  name: string;
  number?: string;
  rarity?: string;
  supertype?: string;
  subtypes?: string[];
  types?: string[];
  hp?: string;
  expansion?: { id?: string; name?: string; series?: string; language_code?: string; is_online_only?: boolean };
}

async function fetchPage(url: string, headers: Record<string, string>): Promise<{ data: ScrydexCard[]; total_count: number } | null> {
  for (let a = 0; a <= FETCH_RETRIES; a++) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20_000);
      const r = await fetch(url, { signal: ctl.signal, headers });
      clearTimeout(t);
      if (r.ok) return await r.json();
      console.error(`Scrydex ${r.status} (attempt ${a + 1})`);
    } catch (e) { console.error(`fetch err (attempt ${a + 1}):`, (e as Error).message); }
    if (a < FETCH_RETRIES) await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const apiKey = Deno.env.get("SCRYDEX_API_KEY") ?? "";
  const teamId = Deno.env.get("SCRYDEX_TEAM_ID") ?? "";
  if (!apiKey || !teamId) return new Response(JSON.stringify({ error: "Missing Scrydex creds" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

  // Auth: cron secret or admin JWT.
  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  let ok = !!(cronSecret && provided && provided === cronSecret);
  if (!ok) {
    const h = req.headers.get("Authorization");
    if (h) { const { data: u } = await supabase.auth.getUser(h.replace("Bearer ", "")); if (u?.user) { const { data: a } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" }); ok = !!a; } }
  }
  if (!ok) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const headers = { "X-Api-Key": apiKey, "X-Team-ID": teamId };
  const body = await req.json().catch(() => ({}));
  const maxPages = Math.max(1, Math.min(300, Number(body.maxPages) || 300));
  const t0 = Date.now();

  try {
    let page = 1, totalUpserted = 0, creditsUsed = 0;
    let buffer: Record<string, unknown>[] = [];
    const flush = async () => {
      if (!buffer.length) return;
      const { error } = await supabase.from("cards").upsert(buffer, { onConflict: "id" });
      if (error) console.error("cards upsert:", error.message);
      else totalUpserted += buffer.length;
      buffer = [];
    };

    while (page <= maxPages) {
      const url = `${SCRYDEX_BASE}/pokemon/v1/en/cards?page=${page}&page_size=100&orderBy=-expansion.release_date`;
      const res = await fetchPage(url, headers); creditsUsed++;
      if (!res?.data?.length) break;
      for (const c of res.data) {
        if (c.expansion?.language_code !== "EN") continue;
        if (c.expansion?.is_online_only) continue;
        if ((c.expansion?.series ?? "").toLowerCase() === "pokémon tcg pocket") continue;
        const setId = c.expansion?.id ?? (c.id.includes("-") ? c.id.split("-").slice(0, -1).join("-") : c.id);
        buffer.push({
          id: c.id,
          name: c.name ?? "",
          set_id: setId,
          set_name: c.expansion?.name ?? "",
          number: c.number ?? (c.id.includes("-") ? c.id.split("-").at(-1) : "") ?? "",
          rarity: c.rarity ?? null,
          supertype: c.supertype ?? null,
          subtypes: c.subtypes ?? null,
          types: c.types ?? null,
          hp: c.hp ?? null,
          series: c.expansion?.series ?? null,
          language: "EN",
          updated_at: new Date().toISOString(),
        });
      }
      if (buffer.length >= 500) await flush();
      if (res.data.length < 100) break;
      page++;
      await new Promise((r) => setTimeout(r, 150));
    }
    await flush();

    const summary = { success: true, version: FUNCTION_VERSION, pages: page, cards_upserted: totalUpserted, credits_used: creditsUsed, duration_ms: Date.now() - t0 };
    console.log("sync-cards-catalog done:", summary);
    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
