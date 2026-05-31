// cc-discovery-run — Collector Crypt UNDERVALUED matcher (v2: CC marketplace API).
//
// Admin-triggered from /admin/cc-discovery, cooldown-gated (10 min). Per run:
//   1. Verify admin + cooldown; mark running
//   2. Pull the ENTIRE CC marketplace from api.collectorcrypt.com (paginated)
//      — keep listed English Pokémon slabs with a grade
//   3. Match each to a Scrydex card (card-name + number) → look up the graded
//      market price (card_id, company, grade) in latest_graded_prices
//   4. delta_pct = (listing_usd - graded_market) / graded_market * 100
//      (negative = listed BELOW graded market = undervalued)
//   5. TRUNCATE + INSERT cc_discovery_results, update cc_discovery_state
//
// v2 change: source is now CC's public marketplace API, which carries clean
// structured fields (gradeNum, gradingCompany, set, serial, itemName, listing
// price in USDC/SOL) + a Category. This replaced the old onchain_listings +
// sparse nft_names path, which matched almost nothing. Validated live: real
// finds like PSA 10 listed at -97% vs graded market.
//
// Scope (user 2026-05-29): sales live in ingest-cc-native; this maps the whole
// marketplace. We do NOT track listing state — each run is a fresh snapshot.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COOLDOWN_MINUTES = 10;
const CC_API = "https://api.collectorcrypt.com/marketplace";
const SOL_MINT = "So11111111111111111111111111111111111111112";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}
function stripCardNumber(s: string | null | undefined): string {
  if (!s) return "";
  const m = String(s).match(/^0*(\d+)/);
  return m ? m[1] : String(s).trim();
}

// Parse the card name out of a CC itemName like
//   "2023 #170 Squirtle PSA 10 Japanese Sv2a- 151 Pokemon"
//   "2025 #060 Mega Gardevoir EX PSA 10 Meg EN-Mega Evolution"
// → name between "#<serial> " and the grading company. Strips printing
// prefixes ("Full Art/", "Reverse Holo/", ...).
function parseCardName(itemName: string | null | undefined): string | null {
  if (!itemName) return null;
  const m = itemName.match(/^\d{4}\s+#?\d+\s+(.+?)\s+(PSA|CGC|BGS|TAG|SGC|ACE)\b/i);
  if (!m) return null;
  // Strip printing/finish markers that aren't part of the card name, so the
  // match against Scrydex card_name succeeds. Validated to lift the match rate
  // ~34% (e.g. "Kabutops-Holo 1st Edition" → "Kabutops", "Blastoise-Holo" →
  // "Blastoise"). Keeps EX/V/VMAX/VSTAR — those ARE part of the name.
  const name = m[1]
    .replace(/\b(reverse\s+holo|full\s+art|alt\s+art)\b/gi, " ")
    .replace(/[-\s]+holo\b/gi, " ")
    .replace(/\b(1st\s+edition|first\s+edition|shadowless|unlimited(\s+edition)?|staff|promo)\b/gi, " ")
    .replace(/^[-\s/]+|[-\s/]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return name || null;
}

// SOL/USD spot (Jupiter primary, Pyth fallback) — only needed for SOL-priced
// listings; USDC listings are 1:1. Both public, no key.
async function getSolUsd(): Promise<number | null> {
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v2?ids=${SOL_MINT}`);
    if (r.ok) { const j = await r.json(); const p = Number(j?.data?.[SOL_MINT]?.price); if (p > 0) return p; }
  } catch { /* fall through */ }
  try {
    const r = await fetch("https://hermes.pyth.network/api/latest_price_feeds?ids[]=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d");
    if (r.ok) { const a = await r.json(); const f = Array.isArray(a) ? a[0] : null; const raw = Number(f?.price?.price); const e = Number(f?.price?.expo); if (raw > 0 && Number.isFinite(e)) return raw * Math.pow(10, e); }
  } catch { /* fall through */ }
  return null;
}

interface CCListing {
  mint: string;
  item_name: string;
  card_name: string;
  number: string;
  company: string;
  grade: number;
  price_usd: number;
  image: string | null;
}

// Pull listed English Pokémon slabs from the CC marketplace API.
async function fetchCCPokemon(maxPages: number, solUsd: number | null): Promise<CCListing[]> {
  const out: CCListing[] = [];
  for (let page = 1; page <= maxPages; page++) {
    let j: any;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15_000);
      const r = await fetch(`${CC_API}?page=${page}`, { signal: ctl.signal, headers: { Accept: "application/json" } });
      clearTimeout(t);
      if (!r.ok) { console.warn(`[cc-api] page ${page} -> ${r.status}, stopping`); break; }
      j = await r.json();
    } catch (e) {
      console.warn(`[cc-api] page ${page} threw: ${(e as Error).message}, stopping`);
      break;
    }
    const items: any[] = j?.filterNFtCard ?? [];
    if (items.length === 0) break;
    for (const it of items) {
      if (it.category !== "Pokemon") continue;                       // clean source filter
      if (/japanese/i.test(`${it.set ?? ""}${it.language ?? ""}`)) continue; // EN catalog only
      const price = Number(it?.listing?.price);
      if (!(price > 0) || !it.gradeNum || !it.gradingCompany || !it.nftAddress) continue;
      const cardName = parseCardName(it.itemName);
      if (!cardName) continue;
      const cur = it.listing.currency;
      const usd = cur === "USDC" ? price : (solUsd ? price * solUsd : 0);
      if (!(usd > 0)) continue; // SOL-priced and no spot → skip rather than store garbage
      out.push({
        mint: it.nftAddress,
        item_name: it.itemName,
        card_name: cardName,
        number: stripCardNumber(it.serial),
        company: String(it.gradingCompany).toUpperCase(),
        grade: Number(it.gradeNum),
        price_usd: Math.round(usd * 100) / 100,
        image: it.frontImage ?? null,
      });
    }
    if (items.length < 100) break; // last page
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

interface RawCard { card_id: string; card_name: string; set_name: string; }
// name(normalized) → cards; used to resolve a CC slab to a Scrydex card_id.
function buildNameIndex(rows: RawCard[]): Map<string, RawCard[]> {
  const m = new Map<string, RawCard[]>();
  for (const r of rows) {
    const base = r.card_id.split("::")[0];
    const key = normalize(r.card_name);
    if (!key) continue;
    const arr = m.get(key) ?? [];
    arr.push({ ...r, card_id: base });
    m.set(key, arr);
  }
  return m;
}
function cardNumberOf(cardId: string): string {
  const b = cardId.split("::")[0];
  const d = b.lastIndexOf("-");
  return stripCardNumber(d >= 0 ? b.slice(d + 1) : "");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Admin-only.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const { data: u } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (!u?.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
  if (!isAdmin) return new Response(JSON.stringify({ error: "Admin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Cooldown.
    const { data: state } = await supabase.from("cc_discovery_state").select("last_run_at, status").eq("id", 1).single();
    if (state?.last_run_at) {
      const mins = (Date.now() - new Date(state.last_run_at).getTime()) / 60_000;
      if (mins < COOLDOWN_MINUTES) {
        return new Response(JSON.stringify({ error: "cooldown", message: `Wait ${Math.ceil(COOLDOWN_MINUTES - mins)}m`, can_run_at: new Date(new Date(state.last_run_at).getTime() + COOLDOWN_MINUTES * 60_000).toISOString() }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    if (state?.status === "running") return new Response(JSON.stringify({ error: "already_running" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    await supabase.from("cc_discovery_state").update({ status: "running", last_error: null }).eq("id", 1);

    const body = await req.json().catch(() => ({}));
    const maxPages = Math.max(1, Math.min(706, Number(body.maxPages) || 150)); // ~default 150 pages

    // Heavy work in the background so the ~150s request timeout can't kill it.
    const work = (async () => {
      try {
        const t0 = Date.now();
        const solUsd = await getSolUsd();
        const listings = await fetchCCPokemon(maxPages, solUsd);

        // Build Scrydex card-name index + graded index once.
        const cards: RawCard[] = [];
        { let from = 0; const P = 1000;
          while (true) {
            const { data, error } = await supabase.from("latest_card_prices").select("card_id, card_name, set_name").not("card_id", "like", "sealed-%").range(from, from + P - 1);
            if (error) throw new Error(`latest_card_prices: ${error.message}`);
            const rows = (data ?? []) as RawCard[]; cards.push(...rows);
            if (rows.length < P) break; from += P;
          } }
        const nameIdx = buildNameIndex(cards);

        // Graded index: `${card_id}|${company}|${grade}` → market.
        const gradedMap = new Map<string, number>();
        { let from = 0; const P = 1000;
          while (true) {
            const { data, error } = await supabase.from("latest_graded_prices").select("card_id, company, grade, market").range(from, from + P - 1);
            if (error) throw new Error(`latest_graded_prices: ${error.message}`);
            const rows = (data ?? []) as { card_id: string; company: string; grade: number; market: number }[];
            for (const r of rows) if (r.market > 0) gradedMap.set(`${r.card_id}|${r.company}|${r.grade}`, Number(r.market));
            if (rows.length < P) break; from += P;
          } }

        // Match.
        const results = listings.map((l) => {
          const cands = (nameIdx.get(normalize(l.card_name)) ?? []).filter((c) => cardNumberOf(c.card_id) === l.number);
          let matched_card_id: string | null = null, matched_set: string | null = null, market: number | null = null, delta: number | null = null, method = "none", conf = 0;
          if (cands.length > 0) {
            const card = cands[0];
            matched_card_id = card.card_id; matched_set = card.set_name;
            const g = gradedMap.get(`${card.card_id}|${l.company}|${l.grade}`);
            if (g && g > 0) {
              market = g; delta = ((l.price_usd - g) / g) * 100;
              method = "cc_api_graded"; conf = cands.length === 1 ? 0.9 : 0.7;
            } else {
              method = "cc_api_nograde"; conf = 0.5; // matched the card but no graded price for that grade
            }
          }
          return {
            pda_address: l.mint, token_mint: l.mint,
            listing_name: l.item_name, listing_image: l.image, listing_price_usd: l.price_usd,
            marketplace_url: `https://collectorcrypt.com/nft/${l.mint}`,
            matched_card_id, matched_card_name: matched_card_id ? l.card_name : null, matched_set_name: matched_set,
            matched_company: l.company, matched_grade: l.grade,
            market_price_usd: market, delta_pct: delta,
            match_method: method, match_confidence: conf,
            status: matched_card_id != null && market != null ? "matched" : "unmatched",
          };
        });

        // Upsert results, THEN delete stale rows — never delete-first. The old
        // delete-then-insert wiped the table at the start of the run; if the
        // background work was then cut short before re-inserting, the UI showed
        // an empty table while cc_discovery_state still held the prior run's
        // counts (the "1,271 matched but no rows" bug). Stamp computed_at so we
        // can prune anything not refreshed this run.
        const runStamp = new Date().toISOString();
        for (let i = 0; i < results.length; i += 500) {
          const slice = results.slice(i, i + 500).map((r) => ({ ...r, computed_at: runStamp }));
          const { error } = await supabase
            .from("cc_discovery_results")
            .upsert(slice, { onConflict: "pda_address" });
          if (error) console.error("[cc-discovery] upsert chunk:", error.message);
        }
        // Remove listings no longer present this run (only if we actually wrote some).
        if (results.length > 0) {
          await supabase.from("cc_discovery_results").delete().lt("computed_at", runStamp);
        }

        const matched = results.filter((r) => r.status === "matched");
        const undervalued = matched.filter((r) => (r.delta_pct ?? 0) < 0);
        await supabase.from("cc_discovery_state").update({
          last_run_at: new Date().toISOString(), status: "idle",
          total_active: listings.length, matched_count: matched.length,
          unmatched_count: results.length - matched.length, undervalued_count: undervalued.length,
          last_error: null,
        }).eq("id", 1);
        console.log("cc-discovery-run done:", { dur_ms: Date.now() - t0, listed: listings.length, matched: matched.length, undervalued: undervalued.length });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("cc-discovery-run bg error:", msg);
        await supabase.from("cc_discovery_state").update({ status: "error", last_error: msg }).eq("id", 1);
      }
    })();
    // @ts-ignore EdgeRuntime is available in Supabase
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work);
    else work.catch((e) => console.error("bg", e));

    return new Response(JSON.stringify({ success: true, status: "running", note: "Mapping CC marketplace in background — poll cc_discovery_state for completion." }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("cc_discovery_state").update({ status: "error", last_error: msg }).eq("id", 1);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
