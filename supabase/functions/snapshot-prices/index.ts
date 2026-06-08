/**
 * snapshot-prices edge function — Scrydex edition
 *
 * Fetches current card prices from Scrydex and upserts into price_snapshots.
 *
 * Modes (pass in POST body):
 *   {}                                    → daily: newest 60 pages + oldest 60 pages (~12,000 cards, 120 credits)
 *   { mode:"full" }                       → full:  all pages (~23,000 cards, ~235 credits) — run weekly
 *   { mode:"sets", setIds:["me3",...] }   → backfill specific sets only (1-2 credits per set,
 *                                            paginated at page_size=250). Use this to fix gaps
 *                                            in middle-numbered cards that the daily passes miss.
 *
 * Credit budget:
 *   Daily 120 pages × 30 days  = 3,600 credits/month
 *   Full  235 pages × 4 weeks  =   940 credits/month
 *   Total ≈ 4,540 credits/month (460 buffer under 5,000 Starter limit)
 *
 * Scheduling:
 *   - Daily job: POST {} every day (covers newest + oldest ~6k each)
 *   - Weekly job: POST { mode:"full" } once/week (covers all middle cards too)
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Bump on every deploy so the health check / logs can confirm which code is
// actually live (we've been bitten by old deployed functions still running).
const FUNCTION_VERSION = "2026-06-08-trends-6window-anchors";

const PAGE_SIZE = 100;
const DAILY_PAGE_LIMIT = 60; // 60 pages newest + 60 pages oldest = 120 credits/day
const DELAY_MS = 150;        // ~6-7 req/sec, well under 100/sec limit
const FETCH_RETRIES = 2;     // retry a failed Scrydex page before declaring the run incomplete
const EARLY_VARIANT_SET_IDS = new Set([
  "base1", "base2", "base3", "base4", "base5", "base6",
  "gym1", "gym2",
  "neo1", "neo2", "neo3", "neo4",
]);

// Scrydex sometimes returns the same physical set under two ID formats — a
// zero-padded version (me01, me02.5) and an unpadded canonical (me1, me2pt5).
// Our market-sets.json catalog uses the unpadded form, so any cards written
// with the padded prefix get orphaned from /sets/{slug} pages and inflate
// row counts. Normalize at write time.
//
// Conversion rules (mirror what's already in the catalog):
//   me01    → me1
//   me02    → me2
//   me02.5  → me2pt5   (decimal → "pt")
//   me03    → me3
// Generalized: any "me0X.5" → "meXpt5", any "me0X" → "meX". Other prefixes
// (sv, sm, swsh, ...) are untouched because we haven't observed padding
// duplicates there.
function normalizeScrydexCardId(id: string): string {
  // me0X.5-... → meXpt5-...
  let next = id.replace(/^me0?(\d+)\.5(-)/, (_m, n, sep) => `me${n}pt5${sep}`);
  // me0X.5 with no leading zero pattern just in case → meXpt5-
  next = next.replace(/^me(\d+)\.5(-)/, (_m, n, sep) => `me${n}pt5${sep}`);
  // me0X-... → meX-...
  next = next.replace(/^me0+(\d+)(-)/, (_m, n, sep) => `me${n}${sep}`);
  return next;
}

// De-dup + padded-twin handling for a single crawl/backfill run.
//
// Scrydex returns some sets under BOTH a padded expansion id (me02.5) and the
// canonical unpadded one (me2pt5). Both normalize to the same card_id and both
// upsert onto (card_id, recorded_at), so the LAST one written in a crawl wins —
// nondeterministically clobbering the canonical price with the duplicate's.
// That is the recurring Mega Gengar ex (me2pt5-284) bug: a set-scoped backfill
// writes the correct $1,396, then the global cron overwrites it with the twin's
// $1,187.99. (The old dedup keyed on the RAW id, so the twin always slipped
// through.)
//
// Fix: dedup on the NORMALIZED id and let the canonical (unpadded) source win:
//   - first sighting of a normalized id        → write it
//   - canonical arriving after a padded twin    → write again (same-day upsert
//                                                  overwrites → canonical wins)
//   - anything arriving after a canonical       → skip (never clobber it)
//   - a padded twin after another padded twin   → skip (dup)
// Never drops a card: a card that only ever appears in padded form is still
// written once. Returns true if the caller should write this card's rows.
function claimCard(seen: Map<string, boolean>, rawId: string): boolean {
  const normId = normalizeScrydexCardId(rawId);
  const isCanonical = rawId === normId;
  const prev = seen.get(normId);
  if (prev === undefined) { seen.set(normId, isCanonical); return true; }
  if (prev === true) return false;   // canonical already written — protect it
  if (!isCanonical) return false;    // padded twin already written, this is another padded
  seen.set(normId, true);            // upgrade: canonical overwrites the earlier padded row
  return true;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScrydexPrice {
  market: number;
  low: number;
  currency: string;
  condition?: string;        // "NM" | "LP" | "MP" | "HP" | "DMG" (raw only; absent on graded)
  type: string;              // "raw" | "graded"
  // ─── Graded-only fields (present when type === "graded") ───
  mid?: number;
  high?: number;
  // Per Scrydex docs sample, grade arrives as a STRING ("10", "9.5") in
  // the JSON response — NOT a number. Accept both; coerce in extractor.
  grade?: number | string;
  company?: string;          // "PSA" | "CGC" | "BGS" | "TAG" | "SGC" | "ACE"
  is_perfect?: boolean;
  is_signed?: boolean;
  is_error?: boolean;
  // Scrydex ships price movement per window directly — price_change is
  // (current - prior). We use these as the SOURCE of the site's 1d/7d/30d
  // deltas instead of diffing our own stored history (which needed many clean
  // days before deltas populated). days_14/90/180 also exist; we keep 1/7/30.
  trends?: {
    days_1?: { price_change?: number; percent_change?: number };
    days_7?: { price_change?: number; percent_change?: number };
    days_14?: { price_change?: number; percent_change?: number };
    days_30?: { price_change?: number; percent_change?: number };
    days_90?: { price_change?: number; percent_change?: number };
    days_180?: { price_change?: number; percent_change?: number };
  };
}

interface ScrydexVariant {
  name: string;
  prices?: ScrydexPrice[];
}

interface ScrydexCard {
  id: string;
  name: string;
  language_code?: string;
  expansion?: {
    id: string;
    name: string;
    series?: string;
    release_date?: string;
    language_code?: string;
    is_online_only?: boolean;
  };
  variants?: ScrydexVariant[];
}

interface SnapshotRow {
  card_id: string;
  card_name: string;
  set_name: string;
  price: number;
  // Prior prices derived from Scrydex trends (market - price_change). Stored on
  // each snapshot so the refresh copies the latest row's deltas — no history diff.
  // 1/7/30 power the Market deltas; 14/90/180 give the card chart its 6-month
  // shape (served from the DB, never a live per-view fetch).
  price_1d: number | null;
  price_7d: number | null;
  price_14d: number | null;
  price_30d: number | null;
  price_90d: number | null;
  price_180d: number | null;
  recorded_at: string;
}

// One row per graded price in the Scrydex response. Flushed to
// graded_price_snapshots in batches alongside the raw price rows so the
// pipeline doesn't make any extra Scrydex calls.
interface GradedSnapshotRow {
  card_id: string;
  company: string;
  grade: number;
  is_perfect: boolean;
  is_signed: boolean;
  is_error: boolean;
  low: number | null;
  mid: number | null;
  market: number | null;
  high: number | null;
  currency: string;
  recorded_at: string;
}

// ─── Price extraction ─────────────────────────────────────────────────────────

// Variant names that indicate a card genuinely has multiple collectible
// printings worth tracking separately (vintage-era markers). When none of
// these are present, Scrydex's "normal" and "holofoil" entries are usually
// two takes on the same physical card and should be collapsed.
const MODERN_PRIORITY = ["normal", "holofoil", "reverseHolofoil"];

function isVintageVariantName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("shadowless") || n.includes("1stedition") || n.includes("firstedition") || n.startsWith("unlimited");
}

function isEarlyVariantSet(card: ScrydexCard): boolean {
  const expansionId = card.expansion?.id?.toLowerCase();
  const cardPrefix = card.id.split("-")[0]?.toLowerCase();
  return Boolean(
    (expansionId && EARLY_VARIANT_SET_IDS.has(expansionId)) ||
    (cardPrefix && EARLY_VARIANT_SET_IDS.has(cardPrefix))
  );
}

// Pull every graded price entry out of a Scrydex card. Each variant's prices
// array can contain a mix of raw + graded; we want only the graded rows. No
// dedup, no variant collapsing — graded prices are tied to the physical card
// not a foil variant, so all variants typically expose the same graded data
// (Scrydex returns them on every variant for convenience). Dedup happens at
// upsert time via the UNIQUE constraint on (card_id, company, grade, flags,
// recorded_at).
function extractGradedPrices(card: ScrydexCard, today: string): GradedSnapshotRow[] {
  const rows: GradedSnapshotRow[] = [];
  const seen = new Set<string>();
  for (const v of card.variants ?? []) {
    for (const p of v.prices ?? []) {
      if (p.type !== "graded") continue;
      if (!p.company) continue;
      // BUG FIX 2026-05-26: Scrydex returns `grade` as a string ("10",
      // "9.5") per their docs sample — NOT a number. The previous
      // `typeof p.grade !== "number"` check was rejecting every graded
      // entry, so graded_price_snapshots stayed empty after a full run.
      // Coerce to number for storage in the NUMERIC column.
      const gradeNum =
        typeof p.grade === "number" ? p.grade
        : typeof p.grade === "string" ? Number.parseFloat(p.grade)
        : NaN;
      if (!Number.isFinite(gradeNum)) continue;
      // De-dup within the same card across variants (since Scrydex echoes
      // graded prices on each variant). Key: company+grade+flags.
      const key = `${p.company}|${gradeNum}|${p.is_perfect ?? false}|${p.is_signed ?? false}|${p.is_error ?? false}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        card_id: normalizeScrydexCardId(card.id),
        company: p.company,
        grade: gradeNum,
        is_perfect: !!p.is_perfect,
        is_signed: !!p.is_signed,
        is_error: !!p.is_error,
        low: p.low ?? null,
        mid: p.mid ?? null,
        market: p.market ?? null,
        high: p.high ?? null,
        currency: p.currency || "USD",
        recorded_at: today,
      });
    }
  }
  return rows;
}

interface VariantPrice {
  variant: string;
  price: number;
  price_1d: number | null;
  price_7d: number | null;
  price_14d: number | null;
  price_30d: number | null;
  price_90d: number | null;
  price_180d: number | null;
}

// Derive the prior price from a Scrydex trend window. price_change is
// (current - prior), so prior = market - price_change. We store PRIOR PRICES
// (latest_card_prices' existing contract) and let the frontend compute the %,
// so nothing downstream changes — the deltas just come from Scrydex now.
function priorFromTrend(market: number, t?: { price_change?: number }): number | null {
  if (!t || typeof t.price_change !== "number") return null;
  const prior = market - t.price_change;
  return prior > 0 ? Math.round(prior * 100) / 100 : null;
}

function extractAllVariantPrices(card: ScrydexCard): VariantPrice[] {
  const all: VariantPrice[] = [];
  const variants = card.variants ?? [];

  for (const v of variants) {
    // NM raw USD market ONLY — no condition fallback. (The old code fell through
    // to LP/MP/HP/DMG when no NM existed, fabricating chase-card lows — the Mega
    // Gengar ex me2pt5-284 bug. No NM market ⇒ record nothing.)
    const entry = v.prices?.find(
      (x) => x.condition === "NM" && x.type === "raw" && x.currency === "USD" && x.market > 0,
    );
    if (entry && entry.market > 0) {
      all.push({
        variant: v.name,
        price: entry.market,
        price_1d: priorFromTrend(entry.market, entry.trends?.days_1),
        price_7d: priorFromTrend(entry.market, entry.trends?.days_7),
        price_14d: priorFromTrend(entry.market, entry.trends?.days_14),
        price_30d: priorFromTrend(entry.market, entry.trends?.days_30),
        price_90d: priorFromTrend(entry.market, entry.trends?.days_90),
        price_180d: priorFromTrend(entry.market, entry.trends?.days_180),
      });
    }
  }

  if (all.length === 0) return [];

  // Vintage early set: keep every real printing (1st Edition, Shadowless, …).
  const isVintage = isEarlyVariantSet(card) && all.some((vp) => isVintageVariantName(vp.variant));
  if (isVintage) return all;

  // Modern card: collapse to one bare-id row using the best variant (carry its trends too).
  const best =
    MODERN_PRIORITY.map((p) => all.find((vp) => vp.variant === p)).find(Boolean) ??
    all[0];
  return [{ ...best!, variant: "normal" }];
}

// ─── Scrydex fetch helper ─────────────────────────────────────────────────────

async function scrydexFetch(
  endpoint: string,
  apiKey: string,
  teamId: string,
): Promise<{ data: ScrydexCard[]; total_count: number } | null> {
  // Retry transient failures (timeouts, 429, 5xx, network blips) before giving
  // up. A page that fails ALL attempts marks the whole run incomplete, which
  // makes the caller skip the destructive 90-day prune + cache refresh. So the
  // retry is what keeps a single Scrydex hiccup from freezing every update.
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const res = await fetch(`https://api.scrydex.com${endpoint}`, {
        headers: { "X-Api-Key": apiKey, "X-Team-ID": teamId },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) return await res.json();
      console.error(`Scrydex ${res.status} for ${endpoint} (attempt ${attempt + 1}/${FETCH_RETRIES + 1})`);
    } catch (e) {
      console.error(`Scrydex fetch error for ${endpoint} (attempt ${attempt + 1}/${FETCH_RETRIES + 1}):`, e);
    }
    if (attempt < FETCH_RETRIES) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return null;
}

// Free balance probe — /account/v1/usage does NOT cost a credit. Used for the
// pre-flight check so we abort a doomed run instead of 403ing every page.
async function getScrydexCredits(apiKey: string, teamId: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://api.scrydex.com/account/v1/usage", {
      headers: { "X-Api-Key": apiKey, "X-Team-ID": teamId },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const c = data?.data?.credits_remaining;
    return typeof c === "number" ? c : null;
  } catch {
    return null;
  }
}

// ─── Supabase upsert helper ───────────────────────────────────────────────────

// Mirror of flushRows for graded snapshots. Lives next to it so changes
// to upsert behavior happen in one place. Non-fatal on error — graded data
// is best-effort enrichment, the raw price pipeline must keep running.
async function flushGradedRows(
  supabase: any,
  rows: GradedSnapshotRow[],
): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  const { error } = await supabase
    .from("graded_price_snapshots")
    .upsert(rows, { onConflict: "card_id,company,grade,is_perfect,is_signed,is_error,recorded_at" });
  if (error) {
    console.error("Graded upsert error:", error.message);
    return { inserted: 0, skipped: rows.length };
  }
  return { inserted: rows.length, skipped: 0 };
}

async function flushRows(
  supabase: any,
  rows: SnapshotRow[],
): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  const { error } = await supabase
    .from("price_snapshots")
    .upsert(rows, { onConflict: "card_id,recorded_at" });
  if (error) {
    console.error("Upsert error:", error.message);
    return { inserted: 0, skipped: rows.length };
  }
  return { inserted: rows.length, skipped: 0 };
}

// ─── Latest-prices cache refresh ──────────────────────────────────────────────
//
// Called at the end of every successful snapshot run. Materializes the latest
// per-card price + the 1d/7d/30d prior prices into the latest_card_prices
// table so the public Market RPCs become flat indexed reads instead of
// per-request join-heavy aggregations. Failure here does NOT fail the cron —
// the snapshot rows are still safely in price_snapshots; the cache just stays
// one run behind until the next refresh.

async function refreshLatestCardPrices(supabase: any): Promise<void> {
  try {
    const t0 = Date.now();
    const { data, error } = await supabase.rpc("refresh_latest_card_prices");
    if (error) {
      console.error("[cache] refresh_latest_card_prices failed:", error.message);
      return;
    }
    console.log(`[cache] refresh_latest_card_prices wrote ${data ?? "?"} rows in ${Date.now() - t0}ms`);
  } catch (e) {
    console.error("[cache] refresh_latest_card_prices threw:", e);
  }
}

// Mirror for graded cache. Same failure semantics — non-fatal so a broken
// graded refresh doesn't take down the daily raw snapshot run.
async function refreshLatestGradedPrices(supabase: any): Promise<void> {
  try {
    const t0 = Date.now();
    const { data, error } = await supabase.rpc("refresh_latest_graded_prices");
    if (error) {
      console.error("[cache] refresh_latest_graded_prices failed:", error.message);
      return;
    }
    console.log(`[cache] refresh_latest_graded_prices wrote ${data ?? "?"} rows in ${Date.now() - t0}ms`);
  } catch (e) {
    console.error("[cache] refresh_latest_graded_prices threw:", e);
  }
}

// ─── Fetch pass helper ────────────────────────────────────────────────────────

async function runPass(opts: {
  label: string;
  orderBy: string;
  pageLimit: number;
  startPage?: number;
  apiKey: string;
  teamId: string;
  supabase: any;
  today: string;
  seenIds: Map<string, boolean>;
  buffer: SnapshotRow[];
  // Graded data is harvested from the same Scrydex response as raw data
  // (zero extra API credits). Passed through opts so caller controls the
  // buffer's lifecycle and final flush alongside the raw buffer.
  gradedBuffer: GradedSnapshotRow[];
  counters: { inserted: number; skipped: number };
  gradedCounters: { inserted: number; skipped: number };
  // Shared across passes. Set to failed if any page hard-fails after retries —
  // the caller then skips the prune + refresh to protect last-good data.
  runState: { failed: boolean };
}): Promise<number> {
  const { label, orderBy, pageLimit, apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters, runState } = opts;
  const startPage = Math.max(1, opts.startPage ?? 1);
  let page = startPage;
  let totalPages = 1;
  let pagesProcessed = 0;
  const endPage = startPage + pageLimit - 1;

  do {
    const endpoint = `/pokemon/v1/cards?page=${page}&page_size=${PAGE_SIZE}&include=prices&orderBy=${orderBy}`;
    const result = await scrydexFetch(endpoint, apiKey, teamId);

    if (!result) {
      console.error(`[${label}] Page ${page}: fetch failed after retries — marking run INCOMPLETE`);
      runState.failed = true;
      break;
    }

    if (page === startPage) {
      const total = result.total_count ?? 0;
      totalPages = Math.ceil(total / PAGE_SIZE);
      const lastPage = Math.min(endPage, totalPages);
      console.log(`[${label}] Total cards: ${total} — ${totalPages} pages total, fetching ${startPage}..${lastPage}`);
    }

    for (const card of result.data ?? []) {
      // English physical TCG only
      if (card.language_code && card.language_code !== "EN") continue;
      if (card.expansion?.language_code !== "EN") continue;
      if (card.expansion?.is_online_only) continue; // skip TCG Pocket
      const series = (card.expansion?.series ?? "").toLowerCase();
      if (series.includes("pocket")) continue;
      const variantPrices = extractAllVariantPrices(card);
      if (variantPrices.length === 0) continue;

      // Dedup on the normalized id; canonical (unpadded) source wins a twin
      // collision so a padded duplicate can't clobber the real price.
      if (!claimCard(seenIds, card.id)) continue;

      for (const vp of variantPrices) {
        // We append the variant name to make it unique in the DB
        const suffix = vp.variant !== "normal" ? `::${vp.variant}` : "";
        buffer.push({
          card_id: `${normalizeScrydexCardId(card.id)}${suffix}`,
          card_name: card.name ?? "",
          set_name: card.expansion?.name ?? "",
          price: vp.price,
          price_1d: vp.price_1d,
          price_7d: vp.price_7d,
          price_14d: vp.price_14d,
          price_30d: vp.price_30d,
          price_90d: vp.price_90d,
          price_180d: vp.price_180d,
          recorded_at: today,
        });
      }

      // Harvest graded prices from the same response (free — already paid
      // for these bytes via include=prices). Each card gets one set of
      // graded rows regardless of variant — see extractGradedPrices for
      // the dedup logic.
      const gradedRows = extractGradedPrices(card, today);
      if (gradedRows.length > 0) gradedBuffer.push(...gradedRows);
    }

    // Flush every 500 rows to avoid memory pressure
    if (buffer.length >= 500) {
      const { inserted, skipped } = await flushRows(supabase, buffer);
      counters.inserted += inserted;
      counters.skipped += skipped;
      buffer.length = 0;
    }

    if (gradedBuffer.length >= 500) {
      const { inserted, skipped } = await flushGradedRows(supabase, gradedBuffer);
      gradedCounters.inserted += inserted;
      gradedCounters.skipped += skipped;
      gradedBuffer.length = 0;
    }

    pagesProcessed++;
    const lastPage = Math.min(endPage, totalPages);
    console.log(`[${label}] Page ${page}/${lastPage} — ${counters.inserted} saved so far`);
    page++;
    if (page <= lastPage) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  } while (page <= Math.min(endPage, totalPages));

  return pagesProcessed;
}

// ─── Per-set backfill helper ──────────────────────────────────────────────────
//
// Queries Scrydex for one set at a time using q=expansion.id:{id}. page_size=250
// is Scrydex's max, so the largest current set (~295 cards) needs 2 pages.

async function runSetBackfill(opts: {
  setId: string;
  apiKey: string;
  teamId: string;
  supabase: any;
  today: string;
  seenIds: Map<string, boolean>;
  buffer: SnapshotRow[];
  gradedBuffer: GradedSnapshotRow[];
  counters: { inserted: number; skipped: number };
  gradedCounters: { inserted: number; skipped: number };
  runState: { failed: boolean };
}): Promise<{ pages: number; cardsWithPrice: number }> {
  const { setId, apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters, runState } = opts;
  // Scrydex caps page_size at 100 for the cards endpoint; asking for 250 silently truncates
  // and reports total_count == returned, leading to "page 1/1" with missing cards.
  const pageSize = 100;
  let page = 1;
  let totalPages = 1;
  let cardsWithPrice = 0;
  const MAX_PAGES = 10; // hard ceiling — no real set has 1000+ cards

  do {
    const endpoint =
      `/pokemon/v1/cards?q=${encodeURIComponent(`expansion.id:${setId}`)}` +
      `&page=${page}&page_size=${pageSize}&include=prices`;
    const result = await scrydexFetch(endpoint, apiKey, teamId);
    if (!result) {
      console.error(`[set:${setId}] Page ${page}: fetch failed after retries — marking run INCOMPLETE`);
      runState.failed = true;
      break;
    }
    if (page === 1) {
      const total = result.total_count ?? 0;
      totalPages = Math.max(1, Math.min(MAX_PAGES, Math.ceil(total / pageSize)));
      console.log(`[set:${setId}] Total cards: ${total} — ${totalPages} pages`);
    }

    const rows = result.data ?? [];
    for (const card of rows) {
      if (card.language_code && card.language_code !== "EN") continue;
      if (card.expansion?.language_code !== "EN") continue;
      if (card.expansion?.is_online_only) continue;
      const series = (card.expansion?.series ?? "").toLowerCase();
      if (series.includes("pocket")) continue;
      const variantPrices = extractAllVariantPrices(card);
      if (variantPrices.length === 0) continue;
      if (!claimCard(seenIds, card.id)) continue;
      cardsWithPrice++;

      for (const vp of variantPrices) {
        const suffix = vp.variant !== "normal" ? `::${vp.variant}` : "";
        buffer.push({
          card_id: `${normalizeScrydexCardId(card.id)}${suffix}`,
          card_name: card.name ?? "",
          set_name: card.expansion?.name ?? "",
          price: vp.price,
          price_1d: vp.price_1d,
          price_7d: vp.price_7d,
          price_14d: vp.price_14d,
          price_30d: vp.price_30d,
          price_90d: vp.price_90d,
          price_180d: vp.price_180d,
          recorded_at: today,
        });
      }

      // Harvest graded prices from the same response (zero extra credits).
      const gradedRows = extractGradedPrices(card, today);
      if (gradedRows.length > 0) gradedBuffer.push(...gradedRows);
    }

    if (buffer.length >= 500) {
      const { inserted, skipped } = await flushRows(supabase, buffer);
      counters.inserted += inserted;
      counters.skipped += skipped;
      buffer.length = 0;
    }

    if (gradedBuffer.length >= 500) {
      const { inserted, skipped } = await flushGradedRows(supabase, gradedBuffer);
      gradedCounters.inserted += inserted;
      gradedCounters.skipped += skipped;
      gradedBuffer.length = 0;
    }

    console.log(`[set:${setId}] Page ${page}/${totalPages} (rows:${rows.length}) — ${cardsWithPrice} priced so far`);
    // Stop early if Scrydex returned a short page (true end of data) even if totalPages claims more
    if (rows.length < pageSize) break;
    page++;
    if (page <= totalPages) await new Promise((r) => setTimeout(r, DELAY_MS));
  } while (page <= totalPages);

  return { pages: page, cardsWithPrice };
}

// ─── Per-set ATOMIC crawl (the drift-free primitive) ──────────────────────────
//
// Fetches ONE expansion completely (q=expansion.id:{id}, all pages) into LOCAL
// buffers and returns them WITHOUT writing. The caller writes only if ok===true,
// so price_snapshots never holds a partial set — that atomicity is what makes
// the latest-per-card cache refresh safe (a row exists ⇒ its set fully succeeded).
// Per-set q-scoped paging is stable (no global offset drift), so no card is
// silently dropped the way the global page crawl drops chase cards.
async function crawlSetAtomic(opts: {
  setId: string;
  apiKey: string;
  teamId: string;
  today: string;
}): Promise<{
  ok: boolean;
  rows: SnapshotRow[];
  gradedRows: GradedSnapshotRow[];
  pages: number;
  cardsSeen: number;
  cardsPriced: number;
  error?: string;
}> {
  const { setId, apiKey, teamId, today } = opts;
  const pageSize = 100; // Scrydex caps the cards endpoint at 100/page
  const MAX_PAGES = 12;  // no real set exceeds ~1,200 cards
  let page = 1;
  let totalPages = 1;
  let cardsSeen = 0;
  let cardsPriced = 0;
  const rows: SnapshotRow[] = [];
  const gradedRows: GradedSnapshotRow[] = [];
  const seen = new Map<string, boolean>(); // per-set dedup (sets are disjoint)

  do {
    const endpoint =
      `/pokemon/v1/cards?q=${encodeURIComponent(`expansion.id:${setId}`)}` +
      `&page=${page}&page_size=${pageSize}&include=prices`;
    const result = await scrydexFetch(endpoint, apiKey, teamId);
    if (!result) {
      // Hard failure on any page ⇒ abort the WHOLE set, write NOTHING. The set
      // stays pending and the next 5-min tick retries it cleanly.
      return { ok: false, rows: [], gradedRows: [], pages: page, cardsSeen, cardsPriced, error: `page ${page} fetch failed after retries` };
    }
    if (page === 1) {
      const total = result.total_count ?? 0;
      totalPages = Math.max(1, Math.min(MAX_PAGES, Math.ceil(total / pageSize)));
    }
    const data = result.data ?? [];
    for (const card of data) {
      cardsSeen++;
      if (card.language_code && card.language_code !== "EN") continue;
      if (card.expansion?.language_code !== "EN") continue;
      if (card.expansion?.is_online_only) continue;
      const series = (card.expansion?.series ?? "").toLowerCase();
      if (series.includes("pocket")) continue;
      const variantPrices = extractAllVariantPrices(card);
      if (variantPrices.length === 0) continue;
      if (!claimCard(seen, card.id)) continue;
      cardsPriced++;
      for (const vp of variantPrices) {
        const suffix = vp.variant !== "normal" ? `::${vp.variant}` : "";
        rows.push({
          card_id: `${normalizeScrydexCardId(card.id)}${suffix}`,
          card_name: card.name ?? "",
          set_name: card.expansion?.name ?? "",
          price: vp.price,
          price_1d: vp.price_1d,
          price_7d: vp.price_7d,
          price_14d: vp.price_14d,
          price_30d: vp.price_30d,
          price_90d: vp.price_90d,
          price_180d: vp.price_180d,
          recorded_at: today,
        });
      }
      const g = extractGradedPrices(card, today);
      if (g.length > 0) gradedRows.push(...g);
    }
    if (data.length < pageSize) break; // true end of data
    page++;
    if (page <= totalPages) await new Promise((r) => setTimeout(r, DELAY_MS));
  } while (page <= totalPages);

  return { ok: true, rows, gradedRows, pages: page, cardsSeen, cardsPriced };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("SCRYDEX_API_KEY") ?? "";
  const teamId = Deno.env.get("SCRYDEX_TEAM_ID") ?? "";

  if (!apiKey || !teamId) {
    return new Response(
      JSON.stringify({ error: "Missing SCRYDEX_API_KEY or SCRYDEX_TEAM_ID env vars" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // ── Auth: require either CRON_SECRET header (scheduler) or admin JWT ──
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  let authorized = !!(cronSecret && providedSecret && providedSecret === cronSecret);
  if (!authorized) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: u } = await supabase.auth.getUser(token);
      if (u?.user) {
        const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
        authorized = !!isAdmin;
      }
    }
  }
  if (!authorized) {
    return new Response(
      JSON.stringify({ error: "Unauthorized — admin or cron secret required" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const mode: "daily" | "full" | "chunk" | "sets" | "crawl-batch" | "seed-sets" =
      body.mode === "full" ? "full"
      : body.mode === "chunk" ? "chunk"
      : body.mode === "sets" ? "sets"
      : body.mode === "crawl-batch" ? "crawl-batch"
      : body.mode === "seed-sets" ? "seed-sets"
      : "daily";
    const today = new Date().toISOString().split("T")[0];
    // Optional chunking: { mode:"chunk", startPage:1, pageLimit:50, orderBy:"-expansion.release_date" }
    const startPage: number = Math.max(1, Number(body.startPage) || 1);
    const chunkPageLimit: number = Math.max(1, Number(body.pageLimit) || 50);
    // crawl-batch: how many due sets to claim+process this tick (5-min cron).
    const batchLimit: number = Math.max(1, Math.min(40, Number(body.limit) || 15));
    const orderBy: string = typeof body.orderBy === "string" ? body.orderBy : "-expansion.release_date";
    const setIds: string[] = Array.isArray(body.setIds)
      ? body.setIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
      : [];

    console.log(`snapshot-prices [${mode}] starting — ${today} — ${FUNCTION_VERSION}`);

    // Idempotency guard. Counts today's existing card snapshots (excluding sealed).
    // A typical successful daily run writes ~12,000 rows; full mode writes ~22,000.
    // If we're already past those thresholds, the same-day caller is almost certainly
    // a duplicate (stuck cron, manual + cron, parallel resume) and should not spend
    // more Scrydex credits. Pass { force: true } in the body to override.
    const force = body?.force === true;
    if (!force) {
      const { count: existingToday } = await supabase
        .from("price_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("recorded_at", today)
        .not("card_id", "like", "sealed-%");
      const have = existingToday ?? 0;
      const threshold =
        mode === "full" ? 20000 :
        mode === "chunk" ? 0 :              // chunk is always intentional, never skip
        mode === "sets"  ? 0 :              // set backfill is targeted, never skip
        mode === "crawl-batch" ? 0 :        // self-limited by the due-queue, never skip
        mode === "seed-sets"   ? 0 :        // registry refresh, never skip
        10000;                              // daily
      if (threshold > 0 && have >= threshold) {
        console.log(`[skip] ${have} card rows already exist for ${today} — skipping ${mode} run (override with force:true)`);
        return new Response(
          JSON.stringify({
            success: true,
            skipped: true,
            reason: "already-snapshotted-today",
            mode,
            today_count: have,
            threshold,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Pre-flight credit check (free — /account/v1/usage costs nothing). A
    // credit-starved run 403s every page; abort cleanly with a specific reason
    // so the health check shows WHY nothing updated, instead of a vague partial.
    const estCost =
      mode === "full"  ? 235 :
      mode === "chunk" ? chunkPageLimit :
      mode === "sets"  ? Math.max(2, setIds.length * 2) :
      mode === "crawl-batch" ? batchLimit * 3 : // ~2-3 pages/set
      mode === "seed-sets"   ? 10 :
      120; // daily
    const creditsRemaining = await getScrydexCredits(apiKey, teamId);
    if (creditsRemaining != null && creditsRemaining < estCost) {
      console.warn(`[preflight] ${creditsRemaining} credits < est ${estCost} for ${mode} — aborting (insufficient_credits). ${FUNCTION_VERSION}`);
      return new Response(
        JSON.stringify({
          success: false,
          reason: "insufficient_credits",
          credits_remaining: creditsRemaining,
          estimated_cost: estCost,
          mode,
          version: FUNCTION_VERSION,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }

    // Shared completeness flag. Any hard page failure flips this; the prune +
    // cache refresh are then skipped so a partial run never corrupts the cache.
    const runState = { failed: false };
    const seenIds = new Map<string, boolean>();
    const buffer: SnapshotRow[] = [];
    const gradedBuffer: GradedSnapshotRow[] = [];
    const counters = { inserted: 0, skipped: 0 };
    const gradedCounters = { inserted: 0, skipped: 0 };
    let pagesProcessed = 0;

    const setSummaries: Array<{ setId: string; pages: number; priced: number }> = [];

    if (mode === "seed-sets") {
      // Populate/refresh the set registry from Scrydex expansions. EN physical
      // non-Pocket only. Upserts METADATA columns only (onConflict set_id), so
      // tracking columns (last_success_on, enabled, attempts...) are preserved.
      let pageE = 1, totalE = 1, kept = 0, dropped = 0;
      const pageSize = 100;
      const payload: Array<Record<string, unknown>> = [];
      do {
        const endpoint = `/pokemon/v1/expansions?page=${pageE}&page_size=${pageSize}`;
        const result = (await scrydexFetch(endpoint, apiKey, teamId)) as any;
        if (!result) { runState.failed = true; break; }
        if (pageE === 1) {
          const total = result.total_count ?? 0;
          totalE = Math.max(1, Math.ceil(total / pageSize));
        }
        const data = result.data ?? [];
        for (const e of data) {
          const lang = e.language_code ?? e.language;
          const series = String(e.series ?? "").toLowerCase();
          if (lang && lang !== "EN") { dropped++; continue; }
          if (e.is_online_only) { dropped++; continue; }
          if (series.includes("pocket")) { dropped++; continue; }
          payload.push({
            set_id: e.id,
            set_name: e.name ?? "",
            series: e.series ?? "",
            language_code: lang ?? "EN",
            is_online_only: !!e.is_online_only,
            card_total: typeof e.total === "number" ? e.total : null,
          });
          kept++;
        }
        if (data.length < pageSize) break;
        pageE++;
        await new Promise((r) => setTimeout(r, DELAY_MS));
      } while (pageE <= totalE);

      if (payload.length > 0) {
        const { error } = await supabase
          .from("scrydex_set_snapshot_state")
          .upsert(payload, { onConflict: "set_id" });
        if (error) {
          return new Response(
            JSON.stringify({ success: false, mode: "seed-sets", error: error.message }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
          );
        }
      }
      console.log(`[seed-sets] registry upserted ${kept} EN physical sets (dropped ${dropped} JP/online/pocket). ${FUNCTION_VERSION}`);
      return new Response(
        JSON.stringify({ success: true, mode: "seed-sets", sets_registered: kept, dropped, partial: runState.failed }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } else if (mode === "crawl-batch") {
      // THE permanent daily pipeline. Claim N due sets (FOR UPDATE SKIP LOCKED),
      // crawl each WHOLE set, write ATOMICALLY (only if the whole set succeeded),
      // stamp success. A 5-min cron cycles the catalog in small drift-free units.
      // Does NOT refresh the cache — the decoupled refresh cron surfaces landed
      // sets, so a crawl hiccup never blocks the read path.
      const runId = crypto.randomUUID();
      const work = (async () => {
        try {
          const { data: claimed, error: claimErr } = await supabase.rpc("claim_due_snapshot_sets", {
            p_limit: batchLimit, p_lock_minutes: 8, p_run_id: runId,
          });
          if (claimErr) { console.error("[crawl-batch] claim failed:", claimErr.message); return; }
          const sets = (claimed ?? []) as Array<{ set_id: string }>;
          if (sets.length === 0) { console.log(`[crawl-batch] no due sets — idle. ${FUNCTION_VERSION}`); return; }
          console.log(`[crawl-batch] run ${runId} claimed ${sets.length}: ${sets.map((s) => s.set_id).join(",")}`);
          for (const s of sets) {
            const r = await crawlSetAtomic({ setId: s.set_id, apiKey, teamId, today });
            if (!r.ok) {
              await supabase.rpc("mark_set_snapshot_error", { p_set_id: s.set_id, p_error: r.error ?? "unknown" });
              console.warn(`[crawl-batch] ${s.set_id} FAILED (${r.error}) — wrote nothing, left pending`);
              continue;
            }
            // Whole set succeeded → write its rows atomically now.
            const rawRes = await flushRows(supabase, r.rows);
            const gRes = await flushGradedRows(supabase, r.gradedRows);
            counters.inserted += rawRes.inserted; counters.skipped += rawRes.skipped;
            gradedCounters.inserted += gRes.inserted; gradedCounters.skipped += gRes.skipped;
            // flushRows returns inserted===0 / skipped===n on a DB error — treat
            // that as a set failure so it isn't stamped done with no rows written.
            if (r.rows.length > 0 && rawRes.inserted === 0) {
              await supabase.rpc("mark_set_snapshot_error", { p_set_id: s.set_id, p_error: "raw upsert failed" });
              console.warn(`[crawl-batch] ${s.set_id} upsert failed — left pending`);
              continue;
            }
            await supabase.rpc("mark_set_snapshot_success", {
              p_set_id: s.set_id, p_pages: r.pages, p_cards_seen: r.cardsSeen, p_cards_priced: r.cardsPriced,
            });
            setSummaries.push({ setId: s.set_id, pages: r.pages, priced: r.cardsPriced });
            await new Promise((res) => setTimeout(res, DELAY_MS));
          }
          console.log(`[crawl-batch] DONE — sets=${sets.length} rawInserted=${counters.inserted} graded=${gradedCounters.inserted}. ${FUNCTION_VERSION}`, setSummaries);
        } catch (e) {
          console.error("[crawl-batch] background error:", e);
        }
      })();
      // @ts-ignore — EdgeRuntime is available in the Supabase Edge runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(work);
      } else {
        work.catch((e) => console.error("[crawl-batch] background error", e));
      }
      return new Response(
        JSON.stringify({ success: true, mode: "crawl-batch", limit: batchLimit, note: "Running in background — see logs + scrydex_set_snapshot_state for results." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
      );
    } else if (mode === "sets") {
      if (setIds.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "mode=sets requires setIds: string[]" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
        );
      }
      // Run in background so proxy timeout doesn't kill the function mid-backfill.
      const work = (async () => {
        for (const setId of setIds) {
          const { pages, cardsWithPrice } = await runSetBackfill({
            setId, apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters, runState,
          });
          pagesProcessed += pages;
          setSummaries.push({ setId, pages, priced: cardsWithPrice });
          await new Promise((r) => setTimeout(r, DELAY_MS));
        }
        const { inserted, skipped } = await flushRows(supabase, buffer);
        counters.inserted += inserted;
        counters.skipped += skipped;
        const gradedResult = await flushGradedRows(supabase, gradedBuffer);
        gradedCounters.inserted += gradedResult.inserted;
        gradedCounters.skipped += gradedResult.skipped;
        // Only refresh the read cache if the backfill completed. A partial
        // backfill leaves last-good data intact (targeted backfills are cheap
        // to re-run, never worth risking the cache on incomplete data).
        if (!runState.failed) {
          await refreshLatestCardPrices(supabase);
          await refreshLatestGradedPrices(supabase);
          console.log(`[sets] BACKGROUND DONE (complete) — sets=${setIds.length} inserted=${counters.inserted} graded=${gradedCounters.inserted} — refreshed. ${FUNCTION_VERSION}`, setSummaries);
        } else {
          console.warn(`[sets] BACKGROUND DONE (PARTIAL) — a page hard-failed; skipped cache refresh to protect last-good data. ${FUNCTION_VERSION}`, setSummaries);
        }
      })();
      // @ts-ignore — EdgeRuntime is available in Supabase Edge runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(work);
      } else {
        work.catch((e) => console.error("[sets] background error", e));
      }
      return new Response(
        JSON.stringify({ success: true, mode: "sets", queued: setIds.length, setIds, note: "Running in background — see logs for completion." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
      );
    } else if (mode === "chunk") {
      // Chunk mode: fetch a specific page range (caller orchestrates pagination).
      //
      // CRITICAL FIX (2026-06-01): this MUST run in the background like daily/
      // full/sets. The six `snapshot-chunk-*` crons invoke this via pg_net,
      // whose connection timeout closes after a few seconds and — for a
      // SYNCHRONOUS handler — kills the worker mid-pass (~5s ≈ 10 of the 50
      // pages). That is the root cause of the wildly varying daily coverage
      // (5.7k–20k of ~22.6k). waitUntil lets all `chunkPageLimit` pages finish
      // regardless of how fast the caller hangs up. Rows already flush every
      // 500 inside runPass, so even a genuine crash keeps what it wrote.
      const work = (async () => {
        try {
          pagesProcessed += await runPass({
            label: `chunk@${startPage}+${chunkPageLimit}`,
            orderBy,
            pageLimit: chunkPageLimit,
            startPage,
            apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters, runState,
          });
          const { inserted, skipped } = await flushRows(supabase, buffer);
          counters.inserted += inserted;
          counters.skipped += skipped;
          const gradedResult = await flushGradedRows(supabase, gradedBuffer);
          gradedCounters.inserted += gradedResult.inserted;
          gradedCounters.skipped += gradedResult.skipped;
          // A chunk only covers a slice of pages, so it NEVER prunes. The
          // dedicated 07:00 refresh-latest-prices cron is the canonical cache
          // rebuild; refreshing here too just keeps it progressively current,
          // and only on a clean run so a hard page failure can't cache a gap.
          if (!runState.failed) {
            await refreshLatestCardPrices(supabase);
            await refreshLatestGradedPrices(supabase);
            console.log(`[chunk@${startPage}] BACKGROUND DONE (complete) — pages=${pagesProcessed} inserted=${counters.inserted} graded=${gradedCounters.inserted}. ${FUNCTION_VERSION}`);
          } else {
            console.warn(`[chunk@${startPage}] BACKGROUND DONE (PARTIAL) — a page hard-failed; skipped cache refresh to protect last-good data. ${FUNCTION_VERSION}`);
          }
          // Stamp the chunk-completion log so verify-and-heal can re-run ONLY
          // the chunks that came up short. complete=false on a hard page
          // failure; if this code is never reached (timeout/crash) no row is
          // written at all — the heal treats "no complete row today" as short.
          try {
            await supabase.from("snapshot_chunk_log").insert({
              start_page: startPage,
              page_limit: chunkPageLimit,
              pages_processed: pagesProcessed,
              complete: !runState.failed,
              version: FUNCTION_VERSION,
            });
          } catch (e) {
            console.error(`[chunk@${startPage}] chunk_log insert failed`, e);
          }
        } catch (e) {
          console.error(`[chunk@${startPage}] background error:`, e);
        }
      })();
      // @ts-ignore — EdgeRuntime is available in the Supabase Edge runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(work);
      } else {
        work.catch((e) => console.error(`[chunk@${startPage}] background error`, e));
      }
      return new Response(
        JSON.stringify({ success: true, mode: "chunk", startPage, pageLimit: chunkPageLimit, note: "Running in background — see logs for completion." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
      );
    } else if (mode === "full") {
      // Full mode: single pass newest-first through all pages (~235 credits).
      // Run in background so the proxy/client timeout (~150s) doesn't kill the worker
      // mid-pass. Caller can pass { mode:"full", startPage:N } to resume.
      const fullStartPage = startPage > 1 ? startPage : 1;
      const work = (async () => {
        try {
          pagesProcessed += await runPass({
            label: "full",
            orderBy: "-expansion.release_date",
            pageLimit: Infinity,
            startPage: fullStartPage,
            apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters, runState,
          });
          const { inserted, skipped } = await flushRows(supabase, buffer);
          counters.inserted += inserted;
          counters.skipped += skipped;
          const gradedResult = await flushGradedRows(supabase, gradedBuffer);
          gradedCounters.inserted += gradedResult.inserted;
          gradedCounters.skipped += gradedResult.skipped;
          // CRITICAL: the 90-day prune + cache refresh run ONLY on a verified-
          // complete pass. If any page hard-failed, skipping the prune is what
          // stops middle-numbered cards (only refreshed by the full run) from
          // aging out and vanishing — the recurring "prices disappeared" bug.
          if (!runState.failed) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 90);
            const cutoffStr = cutoff.toISOString().split("T")[0];
            await supabase.from("price_snapshots").delete().lt("recorded_at", cutoffStr);
            await supabase.from("graded_price_snapshots").delete().lt("recorded_at", cutoffStr);
            await refreshLatestCardPrices(supabase);
            await refreshLatestGradedPrices(supabase);
            console.log(`[full] BACKGROUND DONE (complete) — pages=${pagesProcessed} inserted=${counters.inserted} graded=${gradedCounters.inserted} — pruned + refreshed. ${FUNCTION_VERSION}`);
          } else {
            console.warn(`[full] BACKGROUND DONE (PARTIAL) — pages=${pagesProcessed} inserted=${counters.inserted}; a page hard-failed, so SKIPPED the 90-day prune + cache refresh to protect last-good data. Cron will retry. ${FUNCTION_VERSION}`);
          }
        } catch (e) {
          console.error("[full] background error:", e);
        }
      })();
      // @ts-ignore — EdgeRuntime is available in Supabase Edge runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(work);
      } else {
        work.catch((e) => console.error("[full] background error", e));
      }
      return new Response(
        JSON.stringify({ success: true, mode: "full", startPage: fullStartPage, note: "Running in background — see logs for completion." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
      );
    } else {
      // Daily mode — runs in the background so the ~150s edge-function request
      // timeout cannot kill it mid-pass. Two passes (~12,000 cards total) at
      // ~150ms/page typically takes 2–3 minutes wall-clock, which is OVER the
      // request timeout. Without waitUntil, slow days wrote partial data
      // (we saw 3,742 rows on 5/14 instead of the expected ~12k) and the
      // idempotency guard then blocked a retry for the rest of the day.
      const work = (async () => {
        try {
          // Pass 1 — newest 60 pages (~6,000 most-recent cards)
          pagesProcessed += await runPass({
            label: "newest",
            orderBy: "-expansion.release_date",
            pageLimit: DAILY_PAGE_LIMIT,
            startPage: 1,
            apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters, runState,
          });

          // Pass 2 — oldest 60 pages (~6,000 oldest cards), skip any already seen
          pagesProcessed += await runPass({
            label: "oldest",
            orderBy: "expansion.release_date",
            pageLimit: DAILY_PAGE_LIMIT,
            startPage: 1,
            apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters, runState,
          });

          const { inserted, skipped } = await flushRows(supabase, buffer);
          counters.inserted += inserted;
          counters.skipped += skipped;
          const gradedResult = await flushGradedRows(supabase, gradedBuffer);
          gradedCounters.inserted += gradedResult.inserted;
          gradedCounters.skipped += gradedResult.skipped;

          // NOTE: daily intentionally does NOT prune. Daily only covers the
          // newest+oldest pages, so pruning here could delete middle-numbered
          // cards daily never refreshes. ALL deletion now happens only in the
          // full run, and only when it completes — see the full-mode block.
          if (!runState.failed) {
            await refreshLatestCardPrices(supabase);
            await refreshLatestGradedPrices(supabase);
            console.log(`[daily] BACKGROUND DONE (complete) — pages=${pagesProcessed} inserted=${counters.inserted} graded=${gradedCounters.inserted} — refreshed. ${FUNCTION_VERSION}`);
          } else {
            console.warn(`[daily] BACKGROUND DONE (PARTIAL) — pages=${pagesProcessed} inserted=${counters.inserted}; a page hard-failed, so SKIPPED the cache refresh to keep last-good data. Cron will retry. ${FUNCTION_VERSION}`);
          }
        } catch (e) {
          console.error("[daily] background error:", e);
        }
      })();
      // @ts-ignore — EdgeRuntime is available in Supabase Edge runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(work);
      } else {
        work.catch((e) => console.error("[daily] background error", e));
      }
      return new Response(
        JSON.stringify({ success: true, mode: "daily", note: "Running in background — see logs for completion." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Snapshot error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
