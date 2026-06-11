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
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
function words(s: string | null | undefined): string[] {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
function stripCardNumber(s: string | null | undefined): string {
  if (!s) return "";
  const raw = String(s).trim().replace(/^#/, "").split("/")[0].split("_")[0].trim();
  const m = raw.match(/^([A-Za-z]+)?0*(\d+)([A-Za-z]*)$/);
  if (m) return `${(m[1] ?? "").toUpperCase()}${Number(m[2])}${(m[3] ?? "").toUpperCase()}`;
  return raw.toUpperCase().replace(/\s+/g, "");
}

// Parse the card name out of a CC itemName like
//   "2023 #170 Squirtle PSA 10 Japanese Sv2a- 151 Pokemon"
//   "2025 #060 Mega Gardevoir EX PSA 10 Meg EN-Mega Evolution"
// → name between "#<serial> " and the grading company. Strips printing
// prefixes ("Full Art/", "Reverse Holo/", ...).
function parseCardName(itemName: string | null | undefined): string | null {
  if (!itemName) return null;
  const m = itemName.match(/^\d{4}\s+#?\S+\s+(.+?)\s+(PSA|CGC|BGS|TAG|SGC|ACE)\b/i);
  if (!m) return null;
  // Strip printing/finish markers that aren't part of the card name, so the
  // match against Scrydex card_name succeeds. Validated to lift the match rate
  // ~34% (e.g. "Kabutops-Holo 1st Edition" → "Kabutops", "Blastoise-Holo" →
  // "Blastoise"). Keeps EX/V/VMAX/VSTAR — those ARE part of the name.
  const name = m[1]
    .replace(/\b(reverse\s+(holo|foil)|reverse\s+holo|full\s+art|alt\s+art)\b/gi, " ")
    .replace(/[-\s]+(holo|foil)\b/gi, " ")
    .replace(/[-\s]+gold\s+star\b/gi, " ")
    .replace(/\b(trainer\s+gallery|rare\s+base\s+set)\b/gi, " ")
    .replace(/\bSR\b/g, " ")
    .replace(/\b(1st\s+edition|first\s+edition|shadowless|unlimited(\s+edition)?|staff|promo)\b/gi, " ")
    .replace(/^[-\s/]+|[-\s/]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return name || null;
}

function itemNumber(itemName: string | null | undefined, serial: string | null | undefined): string {
  const fromTitle = String(itemName ?? "").match(/^\s*\d{4}\s+#?(\S+)\s+/)?.[1];
  return stripCardNumber(serial || fromTitle || "");
}

function parseSetHint(itemName: string | null | undefined): string {
  const m = String(itemName ?? "").match(/\s(?:PSA|CGC|BGS|TAG|SGC|ACE)\s+[0-9.]+\s+(.+?)(?:\s+Pokemon)?$/i);
  if (!m) return "";
  return m[1]
    .replace(/\b(gem\s+mint|mint|pristine|authentic)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isNonEnglishPokemonListing(itemName: string | null | undefined, set: string | null | undefined, language: string | null | undefined): boolean {
  return /\b(japanese|chinese|korean|thai|indonesian|german|french|spanish|italian|portuguese|dutch)\b/i
    .test(`${itemName ?? ""} ${set ?? ""} ${language ?? ""}`);
}

function isNonTcgProductListing(itemName: string | null | undefined, set: string | null | undefined): boolean {
  return /\b(riftbound|league\s+of\s+legends|bicycle|playing\s+cards|topps|panini|bowman)\b/i
    .test(`${itemName ?? ""} ${set ?? ""}`);
}

// set_id from a card_id ("base1-2" → "base1", "tcgp-PB-11" → "tcgp-PB").
function setIdOf(cardId: string): string {
  return cardId.split("-").slice(0, -1).join("-") || cardId;
}

// Loose set-name match between CC's set label and a Scrydex set_name.
function setNameMatches(setName: string, ccSet: string): boolean {
  const setTokens = (s: string) => words(s)
    .filter((t) => !["pokemon", "en", "english", "edition", "1st", "first", "and", "the"].includes(t))
    .flatMap((t) => {
      if (t === "svp") return ["scarlet", "violet", "promo"];
      if (t === "sv") return ["scarlet", "violet"];
      if (t === "swsh") return ["sword", "shield"];
      if (t === "hs") return ["heartgold", "soulsilver"];
      if (t === "sm") return ["sun", "moon"];
      if (t === "paf") return ["paldean", "fates"];
      if (t === "wotc") return ["wizards"];
      if (t === "game") return ["base"];
      if (t === "promo" || t === "promos") return ["promo"];
      return [t];
    });
  const aTokens = setTokens(setName);
  const bTokens = setTokens(ccSet);
  const a = aTokens.join(""), b = bTokens.join("");
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const bSet = new Set(bTokens);
  const overlap = aTokens.filter((t) => t.length > 2 && bSet.has(t)).length;
  const required = Math.min(2, aTokens.length, bTokens.length);
  return overlap >= required;
}

function cardNameKeys(name: string | null | undefined): string[] {
  const out = new Set<string>();
  const w = words(name);
  for (let i = 0; i < w.length; i++) out.add(w.slice(i).join(""));
  const full = normalize(name);
  if (full) out.add(full);
  // CC labels the classic promo as "Birthday Pikachu"; Scrydex stores the
  // official blank-owner name "_____'s Pikachu".
  if (full === "birthdaypikachu") out.add(normalize("_____'s Pikachu"));
  return [...out].filter(Boolean);
}

const GENERIC_CARD_WORDS = new Set([
  "holo", "foil", "reverse", "rare", "base", "set", "edition", "first", "1st",
  "unlimited", "shadowless", "promo", "pokemon", "card", "tcg",
]);

function significantWords(s: string | null | undefined): string[] {
  return words(s).filter((w) => w.length > 1 && !GENERIC_CARD_WORDS.has(w));
}

function nameOverlapScore(cardName: string, listingName: string): number {
  const cardWords = significantWords(cardName);
  const listingWords = new Set(significantWords(listingName));
  if (cardWords.length === 0 || listingWords.size === 0) return 0;
  const overlap = cardWords.filter((w) => listingWords.has(w)).length;
  return overlap / Math.max(1, Math.min(cardWords.length, listingWords.size));
}

// set_id → release year, from the app's published market-sets.json. Used to
// disambiguate same name+number across sets (a 2021 Blastoise must NOT match
// the 1999 Base Set Blastoise). Best-effort: if it can't load, year matching
// is simply skipped and we fall back to set-name / single-candidate logic.
async function fetchSetYearMap(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  try {
    const r = await fetch("https://collectiblez.app/data/market-sets.json");
    if (!r.ok) return m;
    const j = await r.json();
    for (const s of (j?.sets ?? [])) {
      const y = String(s.releaseDate ?? "").match(/(\d{4})/)?.[1];
      if (s.id && y) m.set(s.id, y);
    }
  } catch { /* best effort */ }
  return m;
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
  set: string;     // CC's set label (it.set) — disambiguates same name+number across sets
  year: string;    // 4-digit year parsed from the start of itemName (e.g. "2021")
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
      if (isNonEnglishPokemonListing(it.itemName, it.set, it.language)) continue; // EN catalog only
      if (isNonTcgProductListing(it.itemName, it.set)) continue;
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
        number: itemNumber(it.itemName, it.serial),
        company: String(it.gradingCompany).toUpperCase(),
        grade: Number(it.gradeNum),
        price_usd: Math.round(usd * 100) / 100,
        image: it.frontImage ?? null,
        set: String(it.set ?? parseSetHint(it.itemName) ?? "").trim(),
        year: String(it.itemName ?? "").match(/^\s*(\d{4})/)?.[1] ?? "",
      });
    }
    if (items.length < 100) break; // last page
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

interface RawCard { card_id: string; card_name: string; set_name: string; }
interface GradedMatch {
  card_id: string;
  card_name: string;
  set_name: string;
  company: string;
  grade: number;
  market: number;
}

// name(normalized) → cards; used to resolve a CC slab to a Scrydex card_id.
function buildNameIndex(rows: RawCard[]): Map<string, RawCard[]> {
  const m = new Map<string, RawCard[]>();
  for (const r of rows) {
    const base = r.card_id.split("::")[0];
    const key = normalize(r.card_name);
    if (!key) continue;
    const arr = m.get(key) ?? [];
    if (!arr.some((c) => c.card_id === base)) arr.push({ ...r, card_id: base });
    m.set(key, arr);
  }
  return m;
}

function buildCardInfoIndex(rows: RawCard[]): Map<string, RawCard> {
  const m = new Map<string, RawCard>();
  for (const r of rows) {
    const base = r.card_id.split("::")[0];
    if (!m.has(base)) m.set(base, { ...r, card_id: base });
  }
  return m;
}

function buildNumberIndex(rows: RawCard[]): Map<string, RawCard[]> {
  const m = new Map<string, RawCard[]>();
  for (const r of rows) {
    const base = r.card_id.split("::")[0];
    const n = cardNumberOf(base);
    if (!n) continue;
    const arr = m.get(n) ?? [];
    if (!arr.some((c) => c.card_id === base)) arr.push({ ...r, card_id: base });
    m.set(n, arr);
  }
  return m;
}

function cardNumberOf(cardId: string): string {
  const b = cardId.split("::")[0];
  const d = b.lastIndexOf("-");
  return stripCardNumber(d >= 0 ? b.slice(d + 1) : "");
}

function candidatesForListingName(nameIdx: Map<string, RawCard[]>, name: string): RawCard[] {
  const seen = new Set<string>();
  const out: RawCard[] = [];
  for (const key of cardNameKeys(name)) {
    for (const c of nameIdx.get(key) ?? []) {
      if (seen.has(c.card_id)) continue;
      seen.add(c.card_id);
      out.push(c);
    }
  }
  return out;
}

function chooseCandidate(cands: RawCard[], listing: CCListing, setYear: Map<string, string>): RawCard | undefined {
  if (cands.length === 0) return undefined;

  const setMatches = listing.set ? cands.filter((c) => setNameMatches(c.set_name, listing.set)) : [];
  if (setMatches.length === 1) return setMatches[0];
  if (setMatches.length > 1 && listing.year) {
    const byYear = setMatches.find((c) => setYear.get(setIdOf(c.card_id)) === listing.year);
    if (byYear) return byYear;
  }

  const yearMatches = listing.year ? cands.filter((c) => setYear.get(setIdOf(c.card_id)) === listing.year) : [];
  if (yearMatches.length === 1 && !listing.set) return yearMatches[0];

  if (cands.length === 1) {
    const only = cands[0];
    const cy = listing.year ? setYear.get(setIdOf(only.card_id)) : null;
    // Title year is often copyright/slab label year, especially promos. Treat
    // it as a weak signal when a CC set label exists; if no set label exists,
    // keep the old wrong-era guard.
    if (listing.set && !setNameMatches(only.set_name, listing.set)) return undefined;
    if (!listing.set && cy && listing.year && cy !== listing.year) return undefined;
    return only;
  }

  return undefined;
}

function looseCandidateScore(c: RawCard, listing: CCListing, setYear: Map<string, string>): number {
  const overlap = nameOverlapScore(c.card_name, listing.card_name);
  if (overlap <= 0) return 0;

  const exactName = normalize(c.card_name) === normalize(listing.card_name);
  const setMatch = Boolean(listing.set && setNameMatches(c.set_name, listing.set));
  const yearMatch = Boolean(listing.year && setYear.get(setIdOf(c.card_id)) === listing.year);

  let score = overlap * 3;
  if (exactName) score += 3;
  if (setMatch) score += 4;
  if (yearMatch) score += 2;
  if (listing.set && !setMatch) score -= 2;
  if (!listing.set && listing.year && !yearMatch) score -= 1;
  return score;
}

function chooseLooseCandidate(
  numberIdx: Map<string, RawCard[]>,
  listing: CCListing,
  setYear: Map<string, string>,
): { card: RawCard; confidence: number } | undefined {
  if (!listing.number) return undefined;
  const numbered = numberIdx.get(listing.number) ?? [];
  if (numbered.length === 0) return undefined;

  const scored = numbered
    .map((card) => ({ card, score: looseCandidateScore(card, listing, setYear) }))
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return undefined;
  const [top, second] = scored;
  if (second && top.score - second.score < 1.25) return undefined;

  return { card: top.card, confidence: Math.max(0.55, Math.min(0.72, top.score / 12)) };
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
        const cardInfoIdx = buildCardInfoIndex(cards);
        const numberIdx = buildNumberIndex(cards);
        const setYear = await fetchSetYearMap();   // set_id → release year

        // Graded index: `${card_id}|${company}|${grade}` → canonical graded
        // market row. The name/set displayed in Admin must come from the DB
        // card identity we matched, not from CC's messy listing title, while
        // the price comes from latest_graded_prices (never the raw card cache).
        const gradedMap = new Map<string, GradedMatch>();
        { let from = 0; const P = 1000;
          while (true) {
            const { data, error } = await supabase.from("latest_graded_prices").select("card_id, company, grade, market").range(from, from + P - 1);
            if (error) throw new Error(`latest_graded_prices: ${error.message}`);
            const rows = (data ?? []) as { card_id: string; company: string; grade: number; market: number }[];
            for (const r of rows) {
              const market = Number(r.market);
              if (!(market > 0)) continue;
              const company = String(r.company).toUpperCase();
              const info = cardInfoIdx.get(r.card_id);
              gradedMap.set(`${r.card_id}|${company}|${Number(r.grade)}`, {
                card_id: r.card_id,
                card_name: info?.card_name || r.card_id,
                set_name: info?.set_name || "",
                company,
                grade: Number(r.grade),
                market,
              });
            }
            if (rows.length < P) break; from += P;
          } }

        // Match.
        const results = listings.map((l) => {
          const cands = candidatesForListingName(nameIdx, l.card_name)
            .filter((c) => cardNumberOf(c.card_id) === l.number);
          let card = chooseCandidate(cands, l, setYear);
          let cardConfidence = cands.length === 1 ? 0.9 : 0.75;
          let usedLooseCardMatch = false;
          if (!card) {
            const loose = chooseLooseCandidate(numberIdx, l, setYear);
            if (loose) {
              card = loose.card;
              cardConfidence = loose.confidence;
              usedLooseCardMatch = true;
            }
          }

          // Candidate selection prefers CC set labels, then year, then a safe
          // single-candidate fallback. Title year is weak for promos.

          let matched_card_id: string | null = null, matched_set: string | null = null, market: number | null = null, delta: number | null = null, method = "none", conf = 0;
          let matched_card_name: string | null = null;
          let matched_company: string | null = l.company;
          let matched_grade: number | null = l.grade;
          if (card) {
            matched_card_id = card.card_id; matched_set = card.set_name;
            const g = gradedMap.get(`${card.card_id}|${l.company}|${l.grade}`);
            if (g) {
              matched_card_id = g.card_id;
              matched_card_name = g.card_name;
              matched_set = g.set_name;
              matched_company = g.company;
              matched_grade = g.grade;
              market = g.market; delta = ((l.price_usd - g.market) / g.market) * 100;
              method = usedLooseCardMatch ? "cc_api_loose_graded" : "cc_api_graded";
              conf = cardConfidence;
            } else {
              // Keep the canonical raw-card identity on the unmatched row so
              // admins can see "card matched, grade comp missing" diagnostics.
              matched_card_name = card.card_name;
              method = usedLooseCardMatch ? "cc_api_loose_card" : "cc_api_card";
              conf = Math.min(cardConfidence, 0.65); // matched the card but no graded price for that grade
            }
          }
          return {
            pda_address: l.mint, token_mint: l.mint,
            listing_name: l.item_name, listing_image: l.image, listing_price_usd: l.price_usd,
            marketplace_url: `https://collectorcrypt.com/nft/${l.mint}`,
            matched_card_id, matched_card_name, matched_set_name: matched_set,
            matched_company, matched_grade,
            market_price_usd: market, delta_pct: delta,
            match_method: method, match_confidence: conf,
            status: matched_card_id != null ? "matched" : "unmatched",
          };
        });

        // Upsert results, THEN delete stale rows — never delete-first. The old
        // delete-then-insert wiped the table at the start of the run; if the
        // background work was then cut short before re-inserting, the UI showed
        // an empty table while cc_discovery_state still held the prior run's
        // counts (the "1,271 matched but no rows" bug). Stamp computed_at so we
        // can prune anything not refreshed this run.
        const runStamp = new Date().toISOString();
        // De-dupe by pda_address BEFORE writing. The CC API repeats a mint
        // across pages, and a single upsert can't touch the same ON CONFLICT
        // target twice ("cannot affect row a second time") — one dup rejected
        // the whole 500-row chunk, leaving cc_discovery_results EMPTY while the
        // in-memory counts still updated cc_discovery_state. That's the
        // "counts show, table empty" bug.
        const seenPda = new Set<string>();
        const uniqueResults = results.filter((r) => {
          if (seenPda.has(r.pda_address)) return false;
          seenPda.add(r.pda_address);
          return true;
        });
        let writeErr: string | null = null;
        for (let i = 0; i < uniqueResults.length; i += 500) {
          const slice = uniqueResults.slice(i, i + 500).map((r) => ({ ...r, computed_at: runStamp }));
          const { error } = await supabase
            .from("cc_discovery_results")
            .upsert(slice, { onConflict: "pda_address" });
          if (error) { if (!writeErr) writeErr = error.message; console.error("[cc-discovery] upsert chunk:", error.message); }
        }
        // Remove listings no longer present this run (only if we actually wrote some).
        if (uniqueResults.length > 0 && !writeErr) {
          await supabase.from("cc_discovery_results").delete().lt("computed_at", runStamp);
        }

        // Counts come from the SAME deduped set we wrote, so state matches the table.
        const matched = uniqueResults.filter((r) => r.status === "matched");
        const undervalued = matched.filter((r) => (r.delta_pct ?? 0) < 0);
        await supabase.from("cc_discovery_state").update({
          last_run_at: new Date().toISOString(), status: "idle",
          total_active: uniqueResults.length, matched_count: matched.length,
          unmatched_count: uniqueResults.length - matched.length, undervalued_count: undervalued.length,
          last_error: writeErr,   // null on success; the upsert error if the write failed
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
