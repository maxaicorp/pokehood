// ingest-cc-marketplace — snapshots Collector Crypt's full listed Pokémon
// inventory into onchain_listings so the marketplace tab shows it.
//
// Source: api.collectorcrypt.com/marketplace (CC's own public API). Cleaner than
// the Magic Eden listings ingest for CC slabs — it carries category, gradeNum,
// gradingCompany, set, serial, and listing price (USDC/SOL) per item. CC's
// listings mostly settle on ME, so this overlaps the ME ingest; we tag these
// rows with pda_address `cc-<mint>` so they're distinguishable, and the read
// RPC can dedupe by token_mint later (or we retire the ME-CC ingest).
//
// Snapshot model (NOT event tracking): each run upserts every current listing
// and — only if the full run completed — soft-deletes (delisted_at) any cc-*
// row not seen this pass. Coverage-guarded so a partial fetch never delists
// real listings (same discipline as the snapshot pipeline).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const CC_API = "https://api.collectorcrypt.com/marketplace";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const FUNCTION_VERSION = "2026-05-30-cc-marketplace-v3-twotabs";

async function getSolUsd(): Promise<number | null> {
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v2?ids=${SOL_MINT}`);
    if (r.ok) { const j = await r.json(); const p = Number(j?.data?.[SOL_MINT]?.price); if (p > 0) return p; }
  } catch { /* fall through */ }
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Auth — cron secret or admin JWT (same as the other ingest crons).
  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  let ok = !!(cronSecret && provided && provided === cronSecret);
  if (!ok) {
    const h = req.headers.get("Authorization");
    if (h) { const { data: u } = await supabase.auth.getUser(h.replace("Bearer ", "")); if (u?.user) { const { data: a } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" }); ok = !!a; } }
  }
  if (!ok) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const body = await req.json().catch(() => ({}));
  const maxPages = Math.max(1, Math.min(706, Number(body.maxPages) || 150));
  const t0 = Date.now();
  const runStart = new Date().toISOString();

  try {
    const solUsd = await getSolUsd();
    let complete = true;
    let listed = 0;
    let upserted = 0;
    let firstErr: string | null = null;   // surfaced in the summary for diagnosis

    // Upsert each page AS WE FETCH IT — never accumulate everything and write
    // once at the end. The old all-at-end upsert meant that if the invocation
    // was cut short (platform wall-clock, or a pg_net client disconnect) before
    // the final write, ZERO rows persisted. Incremental writes survive that.
    const flush = async (batch: Record<string, unknown>[]) => {
      if (batch.length === 0) return;
      // De-dupe by pda within the batch — a single upsert can't touch the same
      // ON CONFLICT target twice ("cannot affect row a second time"), and the CC
      // API can repeat an nftAddress within/across a page. One dup would
      // otherwise reject the entire page's write.
      const seen = new Set<string>();
      const deduped = batch.filter((r) => {
        const p = r.pda_address as string;
        if (seen.has(p)) return false;
        seen.add(p);
        return true;
      });
      const { error } = await supabase
        .from("onchain_listings")
        .upsert(deduped.map((r) => ({ ...r, delisted_at: null })), { onConflict: "pda_address" });
      if (error) { if (!firstErr) firstErr = error.message; console.error("[cc-mkt] upsert:", error.message); }
      else upserted += deduped.length;
    };

    for (let page = 1; page <= maxPages; page++) {
      let j: any;
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000);
        const r = await fetch(`${CC_API}?page=${page}`, { signal: ctl.signal, headers: { Accept: "application/json" } });
        clearTimeout(t);
        if (!r.ok) { console.warn(`[cc-mkt] page ${page} -> ${r.status}`); complete = false; break; }
        j = await r.json();
      } catch (e) { console.warn(`[cc-mkt] page ${page} threw: ${(e as Error).message}`); complete = false; break; }

      const items: any[] = j?.filterNFtCard ?? [];
      if (items.length === 0) break;
      const pageRows: Record<string, unknown>[] = [];
      for (const it of items) {
        if (it.category !== "Pokemon") continue;           // marketplace shows Pokémon (EN + JP)
        const price = Number(it?.listing?.price);
        if (!(price > 0) || !it.nftAddress) continue;
        const cur = it.listing.currency;
        const usd = cur === "USDC" ? price : (solUsd ? price * solUsd : null);
        pageRows.push({
          pda_address: `cc-${it.nftAddress}`,
          collection: "collector_crypt_cc",   // own source — kept separate from the ME ingest's "collector_crypt"
          token_mint: it.nftAddress,
          seller: it.listing.sellerId ?? "",
          price,
          price_usd: usd != null ? Math.round(usd * 100) / 100 : null,
          price_info: { currency: cur, marketplace: it.listing.marketplace ?? null, gradeNum: it.gradeNum, gradingCompany: it.gradingCompany, set: it.set },
          rarity_rank: null,
          name: it.itemName ?? null,
          image: it.frontImage ?? null,
          marketplace_url: `https://collectorcrypt.com/nft/${it.nftAddress}`,
          last_seen_at: new Date().toISOString(),
        });
      }
      listed += pageRows.length;
      await flush(pageRows);     // persist this page before fetching the next
      if (items.length < 100) break;
      await new Promise((r) => setTimeout(r, 120));
    }

    // Soft-delete stale cc-* listings ONLY on a complete run (coverage guard:
    // a partial fetch must never delist real listings it just didn't reach).
    let delisted = 0;
    if (complete && listed > 0) {
      const { count } = await supabase
        .from("onchain_listings")
        .update({ delisted_at: new Date().toISOString() }, { count: "exact" })
        .eq("collection", "collector_crypt_cc")
        .is("delisted_at", null)
        .lt("last_seen_at", runStart);
      delisted = count ?? 0;
    }

    const summary = { success: true, version: FUNCTION_VERSION, complete, listed, upserted, delisted, upsert_error: firstErr, duration_ms: Date.now() - t0 };
    console.log("ingest-cc-marketplace done:", summary);
    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
