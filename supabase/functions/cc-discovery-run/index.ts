// cc-discovery-run — Collector Crypt valuation matcher.
//
// Called by an admin from /admin/cc-discovery. Cooldown-gated (10 min) to
// prevent accidental double-clicks. Per run:
//   1. Verify admin + cooldown
//   2. Pull active onchain_listings + joined nft_names attributes
//   3. Match each listing to a card in latest_card_prices (raw, today) or
//      latest_graded_prices (once Scrydex graded plan is active) via the
//      structured attributes (set_hint + card_number + company + grade)
//   4. TRUNCATE + INSERT cc_discovery_results, update cc_discovery_state
//
// Today (no graded prices available), all matches are "raw vs raw" —
// useless for graded slabs because graded carries a premium over raw. We
// surface these anyway so the matcher's plumbing is exercised end-to-end;
// the moment latest_graded_prices is populated, the same code starts
// producing actionable undervalued signals automatically.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COOLDOWN_MINUTES = 10;

// ─── Types ───────────────────────────────────────────────────────────────────
interface ActiveListing {
  pda_address: string;
  token_mint: string;
  name: string | null;
  image: string | null;
  price_usd: number | null;
  marketplace_url: string | null;
  // From nft_names join
  card_name_attr: string | null;
  set_hint: string | null;
  card_number: string | null;
  grading_company: string | null;
  grade_value: number | null;
}

interface RawPriceRow {
  card_id: string;
  card_name: string;
  set_name: string;
  price: number;
}

interface GradedPriceRow {
  card_id: string;
  company: string;
  grade: number;
  market: number;
}

interface MatchResult {
  matched_card_id: string | null;
  matched_card_name: string | null;
  matched_set_name: string | null;
  matched_company: string | null;
  matched_grade: number | null;
  market_price_usd: number | null;
  delta_pct: number | null;
  match_method: "graded_attrs" | "raw_attrs" | "name_parse" | "none";
  match_confidence: number;     // 0..1
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

// Strip leading zeros from card numbers ("001" → "1"). Scrydex card_ids use
// the unpadded form ("sv8pt5-1"), but slab attributes often pad ("001").
function stripCardNumber(s: string | null | undefined): string {
  if (!s) return "";
  const m = String(s).match(/^0*(\d+)/);
  return m ? m[1] : String(s).trim();
}

// ─── Matchers ────────────────────────────────────────────────────────────────
//
// Strategy: try the cheapest, most-specific match first; fall back as needed.
//   1. graded_attrs: nft has (set_hint, card_number, company, grade) →
//      look up latest_graded_prices by (card_id, company, grade) where
//      card_id is found by matching set + number in latest_card_prices
//   2. raw_attrs: nft has (set_hint, card_number) → look up
//      latest_card_prices directly. Used today since latest_graded_prices
//      is empty until the Scrydex upgrade.
//   3. name_parse: regex-extract from the listing's display name. Last
//      resort, lowest confidence.

// Index helpers — built once per Run from latest_card_prices, keyed for
// O(1) lookup. The catalog is ~23k rows; building the maps is cheap.
interface CardIndex {
  bySetNormAndNumber: Map<string, RawPriceRow>;
  byCardNameNorm: Map<string, RawPriceRow[]>;
}

function buildCardIndex(rows: RawPriceRow[]): CardIndex {
  const bySetNormAndNumber = new Map<string, RawPriceRow>();
  const byCardNameNorm = new Map<string, RawPriceRow[]>();
  for (const r of rows) {
    // Skip the ::variant suffix for matching since slabs map to base cards.
    const baseId = r.card_id.split("::")[0];
    // Set+number key. card_id format is "{setCode}-{localNumber}"; we want
    // (normalized set name) + "|" + (unpadded number) as the join key.
    const dashIdx = baseId.lastIndexOf("-");
    const number = stripCardNumber(dashIdx >= 0 ? baseId.slice(dashIdx + 1) : "");
    const setNorm = normalize(r.set_name);
    if (setNorm && number) {
      const key = `${setNorm}|${number}`;
      // First write wins so we don't accidentally overwrite the base card
      // with a vintage variant of the same set+number.
      if (!bySetNormAndNumber.has(key)) bySetNormAndNumber.set(key, { ...r, card_id: baseId });
    }
    const nameNorm = normalize(r.card_name);
    if (nameNorm) {
      const arr = byCardNameNorm.get(nameNorm) ?? [];
      arr.push({ ...r, card_id: baseId });
      byCardNameNorm.set(nameNorm, arr);
    }
  }
  return { bySetNormAndNumber, byCardNameNorm };
}

interface GradedIndex {
  // Key: `${card_id}|${company}|${grade}` → market price
  byCardCompanyGrade: Map<string, GradedPriceRow>;
}

function buildGradedIndex(rows: GradedPriceRow[]): GradedIndex {
  const map = new Map<string, GradedPriceRow>();
  for (const r of rows) {
    const key = `${r.card_id}|${r.company}|${r.grade}`;
    map.set(key, r);
  }
  return { byCardCompanyGrade: map };
}

function tryAttrMatch(
  listing: ActiveListing,
  cardIdx: CardIndex,
  gradedIdx: GradedIndex,
): MatchResult {
  // Need at minimum a set + number to use the deterministic path.
  if (!listing.set_hint || !listing.card_number) {
    return { matched_card_id: null, matched_card_name: null, matched_set_name: null,
      matched_company: null, matched_grade: null, market_price_usd: null,
      delta_pct: null, match_method: "none", match_confidence: 0 };
  }
  const setNorm = normalize(listing.set_hint);
  const number = stripCardNumber(listing.card_number);
  const cardKey = `${setNorm}|${number}`;
  const card = cardIdx.bySetNormAndNumber.get(cardKey);
  if (!card) {
    return { matched_card_id: null, matched_card_name: null, matched_set_name: null,
      matched_company: null, matched_grade: null, market_price_usd: null,
      delta_pct: null, match_method: "none", match_confidence: 0 };
  }
  // Have a card. Now try graded match if we have grade info.
  if (listing.grading_company && listing.grade_value != null) {
    const gKey = `${card.card_id}|${listing.grading_company}|${listing.grade_value}`;
    const graded = gradedIdx.byCardCompanyGrade.get(gKey);
    if (graded && graded.market > 0 && listing.price_usd != null) {
      const deltaPct = ((listing.price_usd - graded.market) / graded.market) * 100;
      return {
        matched_card_id: card.card_id,
        matched_card_name: card.card_name,
        matched_set_name: card.set_name,
        matched_company: graded.company,
        matched_grade: graded.grade,
        market_price_usd: graded.market,
        delta_pct: deltaPct,
        match_method: "graded_attrs",
        match_confidence: 0.95,
      };
    }
  }
  // Fall back to raw comparison. Less useful for graded slabs but lets us
  // surface the match so admin can see we found the card; just no
  // actionable delta until graded prices land.
  if (listing.price_usd != null && card.price > 0) {
    const deltaPct = ((listing.price_usd - card.price) / card.price) * 100;
    return {
      matched_card_id: card.card_id,
      matched_card_name: card.card_name,
      matched_set_name: card.set_name,
      matched_company: listing.grading_company,
      matched_grade: listing.grade_value,
      market_price_usd: card.price,
      delta_pct: deltaPct,
      match_method: "raw_attrs",
      match_confidence: 0.70,
    };
  }
  return { matched_card_id: card.card_id, matched_card_name: card.card_name,
    matched_set_name: card.set_name, matched_company: listing.grading_company,
    matched_grade: listing.grade_value, market_price_usd: null, delta_pct: null,
    match_method: "raw_attrs", match_confidence: 0.50 };
}

// Last resort: parse the listing's display name string when structured
// attributes were missing. Looks for patterns like
//   "2024 Pokémon Prismatic Evolutions Umbreon ex #161 PSA 10"
// Extracts: card name, card number, company, grade.
function tryNameParse(
  listing: ActiveListing,
  cardIdx: CardIndex,
  gradedIdx: GradedIndex,
): MatchResult {
  const empty: MatchResult = { matched_card_id: null, matched_card_name: null,
    matched_set_name: null, matched_company: null, matched_grade: null,
    market_price_usd: null, delta_pct: null, match_method: "none", match_confidence: 0 };
  if (!listing.name) return empty;
  const s = listing.name;
  const numberMatch = s.match(/#\s*(\d+)|\b(\d{1,3})\s*\/\s*\d{1,3}\b/);
  const number = stripCardNumber(numberMatch?.[1] ?? numberMatch?.[2] ?? "");
  const companyMatch = s.match(/\b(PSA|CGC|BGS|TAG|SGC|ACE)\b/i);
  const company = companyMatch ? companyMatch[1].toUpperCase() : null;
  const gradeMatch = s.match(/\b(PSA|CGC|BGS|TAG|SGC|ACE)\s*(\d+(?:\.\d+)?)/i);
  const grade = gradeMatch ? Number.parseFloat(gradeMatch[2]) : null;
  if (!number) return empty;

  // We don't know the set from the name. Search every card with a matching
  // unpadded number — if exactly one matches, accept; otherwise bail.
  const candidates: RawPriceRow[] = [];
  for (const r of cardIdx.bySetNormAndNumber.values()) {
    const baseId = r.card_id;
    const dashIdx = baseId.lastIndexOf("-");
    const num = stripCardNumber(dashIdx >= 0 ? baseId.slice(dashIdx + 1) : "");
    if (num === number) candidates.push(r);
  }
  if (candidates.length !== 1) return empty;
  const card = candidates[0];
  if (company && grade != null) {
    const gKey = `${card.card_id}|${company}|${grade}`;
    const graded = gradedIdx.byCardCompanyGrade.get(gKey);
    if (graded && graded.market > 0 && listing.price_usd != null) {
      const deltaPct = ((listing.price_usd - graded.market) / graded.market) * 100;
      return {
        matched_card_id: card.card_id, matched_card_name: card.card_name,
        matched_set_name: card.set_name, matched_company: company, matched_grade: grade,
        market_price_usd: graded.market, delta_pct: deltaPct,
        match_method: "name_parse", match_confidence: 0.65,
      };
    }
  }
  if (listing.price_usd != null && card.price > 0) {
    const deltaPct = ((listing.price_usd - card.price) / card.price) * 100;
    return {
      matched_card_id: card.card_id, matched_card_name: card.card_name,
      matched_set_name: card.set_name, matched_company: company, matched_grade: grade,
      market_price_usd: card.price, delta_pct: deltaPct,
      match_method: "name_parse", match_confidence: 0.45,
    };
  }
  return empty;
}

// ─── Main ────────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Admin-only — verify the JWT.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: u } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (!u?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // ── Cooldown check ──
    const { data: state } = await supabase
      .from("cc_discovery_state")
      .select("last_run_at, status")
      .eq("id", 1)
      .single();
    if (state?.last_run_at) {
      const minsSince = (Date.now() - new Date(state.last_run_at).getTime()) / 60_000;
      if (minsSince < COOLDOWN_MINUTES) {
        const waitMin = Math.ceil(COOLDOWN_MINUTES - minsSince);
        return new Response(
          JSON.stringify({
            error: "cooldown",
            message: `Wait ${waitMin}m before running again`,
            can_run_at: new Date(new Date(state.last_run_at).getTime() + COOLDOWN_MINUTES * 60_000).toISOString(),
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
    if (state?.status === "running") {
      return new Response(
        JSON.stringify({ error: "already_running", message: "A discovery run is already in progress" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Mark running. last_run_at is updated at the END so cooldown timer
    // starts from completion, not start (a long run shouldn't get a "free"
    // second click while it's still going).
    await supabase
      .from("cc_discovery_state")
      .update({ status: "running", last_error: null })
      .eq("id", 1);

    const t0 = Date.now();

    // ── Load active listings + their attribute data via join. ──
    // PostgREST nested select syntax pulls nft_names columns alongside.
    const { data: listingsRaw, error: lErr } = await supabase
      .from("onchain_listings")
      .select(`
        pda_address, token_mint, name, image, price_usd, marketplace_url,
        nft_names:nft_names!onchain_listings_token_mint_fkey ( card_name_attr, set_hint, card_number, grading_company, grade_value )
      `)
      .is("delisted_at", null)
      .eq("collection", "collector_crypt");
    // The named FK may not exist; fall back to two-query approach if join fails.
    let listings: ActiveListing[];
    if (lErr) {
      console.warn("[cc-discovery] joined select failed, falling back:", lErr.message);
      const { data: l2, error: l2err } = await supabase
        .from("onchain_listings")
        .select("pda_address, token_mint, name, image, price_usd, marketplace_url")
        .is("delisted_at", null)
        .eq("collection", "collector_crypt");
      if (l2err) throw new Error(`listings query failed: ${l2err.message}`);
      const mints = [...new Set((l2 ?? []).map((r: any) => r.token_mint).filter(Boolean))];
      const { data: namesRows } = await supabase
        .from("nft_names")
        .select("mint, card_name_attr, set_hint, card_number, grading_company, grade_value")
        .in("mint", mints);
      const nameMap = new Map((namesRows ?? []).map((n: any) => [n.mint, n]));
      listings = (l2 ?? []).map((r: any) => {
        const n: any = nameMap.get(r.token_mint) ?? {};
        return {
          pda_address: r.pda_address, token_mint: r.token_mint,
          name: r.name, image: r.image,
          price_usd: r.price_usd != null ? Number(r.price_usd) : null,
          marketplace_url: r.marketplace_url,
          card_name_attr: n.card_name_attr ?? null,
          set_hint: n.set_hint ?? null,
          card_number: n.card_number ?? null,
          grading_company: n.grading_company ?? null,
          grade_value: n.grade_value != null ? Number(n.grade_value) : null,
        };
      });
    } else {
      listings = (listingsRaw ?? []).map((r: any) => {
        const n = Array.isArray(r.nft_names) ? r.nft_names[0] : r.nft_names;
        return {
          pda_address: r.pda_address, token_mint: r.token_mint,
          name: r.name, image: r.image,
          price_usd: r.price_usd != null ? Number(r.price_usd) : null,
          marketplace_url: r.marketplace_url,
          card_name_attr: n?.card_name_attr ?? null,
          set_hint: n?.set_hint ?? null,
          card_number: n?.card_number ?? null,
          grading_company: n?.grading_company ?? null,
          grade_value: n?.grade_value != null ? Number(n.grade_value) : null,
        };
      });
    }

    // ── Load price catalogs (paginated SELECT to bypass PostgREST cap). ──
    const cards: RawPriceRow[] = [];
    {
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("latest_card_prices")
          .select("card_id, card_name, set_name, price")
          .not("card_id", "like", "sealed-%")
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`latest_card_prices query failed: ${error.message}`);
        const rows = (data ?? []) as RawPriceRow[];
        cards.push(...rows);
        if (rows.length < PAGE) break;
        from += PAGE;
      }
    }
    const cardIdx = buildCardIndex(cards);

    // Graded prices may be empty (Scrydex tier hasn't been upgraded yet);
    // the index is still built and the matcher gracefully misses + falls
    // back to raw comparison.
    const graded: GradedPriceRow[] = [];
    {
      const { data } = await supabase
        .from("latest_graded_prices")
        .select("card_id, company, grade, market");
      for (const r of (data ?? []) as GradedPriceRow[]) graded.push(r);
    }
    const gradedIdx = buildGradedIndex(graded);

    // ── Match every listing. ──
    const results = listings.map((l) => {
      let m = tryAttrMatch(l, cardIdx, gradedIdx);
      if (m.matched_card_id == null) m = tryNameParse(l, cardIdx, gradedIdx);
      const status = m.matched_card_id != null ? "matched" : "unmatched";
      return {
        pda_address: l.pda_address,
        token_mint: l.token_mint,
        listing_name: l.name,
        listing_image: l.image,
        listing_price_usd: l.price_usd,
        marketplace_url: l.marketplace_url,
        matched_card_id: m.matched_card_id,
        matched_card_name: m.matched_card_name,
        matched_set_name: m.matched_set_name,
        matched_company: m.matched_company,
        matched_grade: m.matched_grade,
        market_price_usd: m.market_price_usd,
        delta_pct: m.delta_pct,
        match_method: m.match_method,
        match_confidence: m.match_confidence,
        status,
      };
    });

    // ── Replace cache atomically. ──
    await supabase.from("cc_discovery_results").delete().neq("pda_address", "");
    if (results.length > 0) {
      // Chunk inserts for large batches (~400 today, but defensive).
      for (let i = 0; i < results.length; i += 500) {
        const slice = results.slice(i, i + 500);
        const { error } = await supabase.from("cc_discovery_results").insert(slice);
        if (error) console.error("[cc-discovery] insert chunk failed:", error.message);
      }
    }

    const matched = results.filter((r) => r.status === "matched");
    const undervalued = matched.filter((r) => (r.delta_pct ?? 0) < 0);

    await supabase.from("cc_discovery_state").update({
      last_run_at: new Date().toISOString(),
      status: "idle",
      total_active: listings.length,
      matched_count: matched.length,
      unmatched_count: results.length - matched.length,
      undervalued_count: undervalued.length,
      last_error: null,
    }).eq("id", 1);

    const summary = {
      success: true,
      duration_ms: Date.now() - t0,
      total_active: listings.length,
      matched: matched.length,
      unmatched: results.length - matched.length,
      undervalued: undervalued.length,
      graded_catalog_size: graded.length,
    };
    console.log("cc-discovery-run done:", summary);
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("cc-discovery-run error:", msg);
    await supabase.from("cc_discovery_state").update({
      status: "error", last_error: msg,
    }).eq("id", 1);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
