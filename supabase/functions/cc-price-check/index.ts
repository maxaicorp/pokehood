// cc-price-check - admin-only one-listing valuation check for /onchain/marketplace.
//
// Reads one cached onchain_listings row, matches its Collector Crypt-style slab
// title to latest_card_prices, then returns all cached graded comps for that
// card from latest_graded_prices. No Scrydex calls and no Collector Crypt live
// calls happen here.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

function parseCardName(itemName: string | null | undefined): string | null {
  if (!itemName) return null;
  const m = itemName.match(/^\d{4}\s+#?\S+\s+(.+?)\s+(PSA|CGC|BGS|TAG|SGC|ACE)\b/i);
  if (!m) return null;
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

function setIdOf(cardId: string): string {
  return cardId.split("-").slice(0, -1).join("-") || cardId;
}

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
  const a = aTokens.join("");
  const b = bTokens.join("");
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

interface RawCard { card_id: string; card_name: string; set_name: string }

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

function cardNumberOf(cardId: string): string {
  const b = cardId.split("::")[0];
  const d = b.lastIndexOf("-");
  return stripCardNumber(d >= 0 ? b.slice(d + 1) : "");
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

function chooseCandidate(cands: RawCard[], listing: ParsedListing): { card: RawCard; confidence: number; method: string } | undefined {
  if (cands.length === 0) return undefined;

  const setMatches = listing.set ? cands.filter((c) => setNameMatches(c.set_name, listing.set)) : [];
  if (setMatches.length === 1) return { card: setMatches[0], confidence: 0.9, method: "exact_set" };

  if (cands.length === 1) {
    const only = cands[0];
    if (listing.set && !setNameMatches(only.set_name, listing.set)) return undefined;
    return { card: only, confidence: 0.8, method: "exact_single" };
  }

  return undefined;
}

function looseCandidateScore(c: RawCard, listing: ParsedListing): number {
  const overlap = nameOverlapScore(c.card_name, listing.cardName);
  if (overlap <= 0) return 0;

  const exactName = normalize(c.card_name) === normalize(listing.cardName);
  const setMatch = Boolean(listing.set && setNameMatches(c.set_name, listing.set));

  let score = overlap * 3;
  if (exactName) score += 3;
  if (setMatch) score += 4;
  if (listing.set && !setMatch) score -= 2;
  return score;
}

function chooseLooseCandidate(numberIdx: Map<string, RawCard[]>, listing: ParsedListing): { card: RawCard; confidence: number; method: string } | undefined {
  if (!listing.number) return undefined;
  const numbered = numberIdx.get(listing.number) ?? [];
  if (numbered.length === 0) return undefined;

  const scored = numbered
    .map((card) => ({ card, score: looseCandidateScore(card, listing) }))
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return undefined;
  const [top, second] = scored;
  if (second && top.score - second.score < 1.25) return undefined;

  return { card: top.card, confidence: Math.max(0.55, Math.min(0.72, top.score / 12)), method: "loose_number_name" };
}

interface ParsedListing {
  itemName: string;
  cardName: string;
  number: string;
  company: string | null;
  grade: number | null;
  set: string;
  priceUsd: number | null;
}

function parseListing(row: any): ParsedListing {
  const priceInfo = row.price_info ?? {};
  const itemName = String(row.name ?? "");
  const company = priceInfo.gradingCompany ? String(priceInfo.gradingCompany).toUpperCase() : null;
  const grade = priceInfo.gradeNum != null ? Number(priceInfo.gradeNum) : null;
  const cardName = parseCardName(itemName) ?? itemName;
  const number = itemNumber(itemName, priceInfo.serial ?? null);
  const set = String(priceInfo.set ?? parseSetHint(itemName) ?? "").trim();
  const priceUsd =
    Number(row.price_usd) > 0
      ? Math.round(Number(row.price_usd) * 100) / 100
      : String(priceInfo.currency ?? "").toUpperCase() === "USDC" && Number(row.price) > 0
      ? Math.round(Number(row.price) * 100) / 100
      : null;

  return { itemName, cardName, number, company, grade: Number.isFinite(grade) ? grade : null, set, priceUsd };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const token = authHeader.replace("Bearer ", "");
  const { data: userData } = await supabase.auth.getUser(token);
  if (!userData?.user) return json({ error: "Unauthorized" }, 401);

  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "admin",
  });
  if (!isAdmin) return json({ error: "Admin only" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const pdaAddress = String(body.pdaAddress ?? "").trim();
    const tokenMint = String(body.tokenMint ?? "").trim();
    if (!pdaAddress && !tokenMint) return json({ error: "pdaAddress or tokenMint required" }, 400);

    let listingQuery = supabase
      .from("onchain_listings")
      .select("pda_address, token_mint, collection, name, image, price, price_usd, price_info, marketplace_url, delisted_at")
      .is("delisted_at", null)
      .limit(1);

    listingQuery = pdaAddress
      ? listingQuery.eq("pda_address", pdaAddress)
      : listingQuery.eq("token_mint", tokenMint);

    const { data: listingRows, error: listingError } = await listingQuery;
    if (listingError) throw new Error(`onchain_listings: ${listingError.message}`);
    const listing = listingRows?.[0];
    if (!listing) return json({ error: "listing not found" }, 404);

    const parsed = parseListing(listing);

    // Narrow query — full table scan was timing out. Fetch only candidates
    // that could plausibly match by name token or card number suffix.
    const cards: RawCard[] = [];
    const seenIds = new Set<string>();
    const pushRows = (rows: RawCard[] | null) => {
      for (const r of rows ?? []) {
        if (seenIds.has(r.card_id)) continue;
        seenIds.add(r.card_id);
        cards.push(r);
      }
    };

    const nameTokens = significantWords(parsed.cardName);
    const primaryToken = nameTokens[0] ?? "";

    if (primaryToken) {
      const { data, error } = await supabase
        .from("latest_card_prices")
        .select("card_id, card_name, set_name")
        .not("card_id", "like", "sealed-%")
        .ilike("card_name", `%${primaryToken}%`)
        .limit(5000);
      if (error) throw new Error(`latest_card_prices: ${error.message}`);
      pushRows(data as RawCard[] | null);
    }

    if (parsed.number) {
      const { data, error } = await supabase
        .from("latest_card_prices")
        .select("card_id, card_name, set_name")
        .not("card_id", "like", "sealed-%")
        .ilike("card_id", `%-${parsed.number.toLowerCase()}`)
        .limit(5000);
      if (error) throw new Error(`latest_card_prices: ${error.message}`);
      pushRows(data as RawCard[] | null);
    }

    const nameIdx = buildNameIndex(cards);
    const numberIdx = buildNumberIndex(cards);
    const exactCandidates = candidatesForListingName(nameIdx, parsed.cardName)
      .filter((c) => cardNumberOf(c.card_id) === parsed.number);
    const chosen = chooseCandidate(exactCandidates, parsed) ?? chooseLooseCandidate(numberIdx, parsed);

    if (!chosen) {
      return json({
        listing,
        parsed,
        match: null,
        exactComp: null,
        gradedComps: [],
      });
    }

    const { data: gradedRows, error: gradedError } = await supabase
      .from("latest_graded_prices")
      .select("card_id, company, grade, market, low, mid, high, currency, updated_at")
      .eq("card_id", chosen.card.card_id)
      .order("company", { ascending: true })
      .order("grade", { ascending: false });
    if (gradedError) throw new Error(`latest_graded_prices: ${gradedError.message}`);

    const gradedComps = (gradedRows ?? []).map((r: any) => ({
      ...r,
      grade: Number(r.grade),
      market: r.market == null ? null : Number(r.market),
      low: r.low == null ? null : Number(r.low),
      mid: r.mid == null ? null : Number(r.mid),
      high: r.high == null ? null : Number(r.high),
      isExact:
        parsed.company != null &&
        parsed.grade != null &&
        String(r.company).toUpperCase() === parsed.company &&
        Number(r.grade) === Number(parsed.grade),
    }));

    const exactComp = gradedComps.find((r) => r.isExact) ?? null;
    const deltaPct =
      exactComp?.market && parsed.priceUsd
        ? ((parsed.priceUsd - exactComp.market) / exactComp.market) * 100
        : null;

    return json({
      listing,
      parsed,
      match: {
        card_id: chosen.card.card_id,
        card_name: chosen.card.card_name,
        set_name: chosen.card.set_name,
        method: chosen.method,
        confidence: chosen.confidence,
      },
      exactComp: exactComp ? { ...exactComp, deltaPct } : null,
      gradedComps,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("cc-price-check error:", msg);
    return json({ error: msg }, 500);
  }
});
