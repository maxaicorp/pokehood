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

const PAGE_SIZE = 100;
const DAILY_PAGE_LIMIT = 60; // 60 pages newest + 60 pages oldest = 120 credits/day
const DELAY_MS = 150;        // ~6-7 req/sec, well under 100/sec limit
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
}

interface ScrydexVariant {
  name: string;
  prices?: ScrydexPrice[];
}

interface ScrydexCard {
  id: string;
  name: string;
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

function extractAllVariantPrices(card: ScrydexCard): { variant: string; price: number }[] {
  const all: { variant: string; price: number }[] = [];
  const variants = card.variants ?? [];

  for (const v of variants) {
    let price = v.prices?.find((x) => x.condition === "NM" && x.type === "raw" && x.currency === "USD" && x.market > 0)?.market;
    if (!price) price = v.prices?.find((x) => x.condition === "NM" && x.type === "raw" && x.market > 0)?.market;
    if (!price) price = v.prices?.find((x) => x.type === "raw" && x.currency === "USD" && x.market > 0)?.market;
    if (!price) price = v.prices?.find((x) => x.type === "raw" && x.market > 0)?.market;

    if (price && price > 0) {
      all.push({ variant: v.name, price });
    }
  }

  if (all.length === 0) return [];

  // If any vintage marker is present on an allowed early set, keep every variant — the card has
  // multiple real printings (1st Edition, Shadowless, Unlimited Holo, etc.).
  const isVintage = isEarlyVariantSet(card) && all.some((vp) => isVintageVariantName(vp.variant));
  if (isVintage) return all;

  // Modern card: collapse to a single bare-id row using the best available
  // price. Emitting as "normal" means the downstream code writes no ::suffix.
  const best =
    MODERN_PRIORITY.map((p) => all.find((vp) => vp.variant === p)).find(Boolean) ??
    all[0];
  return [{ variant: "normal", price: best!.price }];
}

// ─── Scrydex fetch helper ─────────────────────────────────────────────────────

async function scrydexFetch(
  endpoint: string,
  apiKey: string,
  teamId: string,
): Promise<{ data: ScrydexCard[]; total_count: number } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(`https://api.scrydex.com${endpoint}`, {
      headers: { "X-Api-Key": apiKey, "X-Team-ID": teamId },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`Scrydex ${res.status} for ${endpoint}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error("Scrydex fetch error:", e);
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
  seenIds: Set<string>;
  buffer: SnapshotRow[];
  // Graded data is harvested from the same Scrydex response as raw data
  // (zero extra API credits). Passed through opts so caller controls the
  // buffer's lifecycle and final flush alongside the raw buffer.
  gradedBuffer: GradedSnapshotRow[];
  counters: { inserted: number; skipped: number };
  gradedCounters: { inserted: number; skipped: number };
}): Promise<number> {
  const { label, orderBy, pageLimit, apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters } = opts;
  const startPage = Math.max(1, opts.startPage ?? 1);
  let page = startPage;
  let totalPages = 1;
  let pagesProcessed = 0;
  const endPage = startPage + pageLimit - 1;

  do {
    const endpoint = `/pokemon/v1/en/cards?page=${page}&page_size=${PAGE_SIZE}&include=prices&orderBy=${orderBy}`;
    const result = await scrydexFetch(endpoint, apiKey, teamId);

    if (!result) {
      console.error(`[${label}] Page ${page}: fetch failed, stopping pass`);
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
      if (card.expansion?.language_code !== "EN") continue;
      if (card.expansion?.is_online_only) continue; // skip TCG Pocket
      const series = (card.expansion?.series ?? "").toLowerCase();
      if (series === "pokémon tcg pocket") continue;
      const variantPrices = extractAllVariantPrices(card);
      if (variantPrices.length === 0) continue;

      // We only deduplicate based on base card.id
      if (seenIds.has(card.id)) continue;
      seenIds.add(card.id);

      for (const vp of variantPrices) {
        // We append the variant name to make it unique in the DB
        const suffix = vp.variant !== "normal" ? `::${vp.variant}` : "";
        buffer.push({
          card_id: `${normalizeScrydexCardId(card.id)}${suffix}`,
          card_name: card.name ?? "",
          set_name: card.expansion?.name ?? "",
          price: vp.price,
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
  seenIds: Set<string>;
  buffer: SnapshotRow[];
  gradedBuffer: GradedSnapshotRow[];
  counters: { inserted: number; skipped: number };
  gradedCounters: { inserted: number; skipped: number };
}): Promise<{ pages: number; cardsWithPrice: number }> {
  const { setId, apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters } = opts;
  // Scrydex caps page_size at 100 for the cards endpoint; asking for 250 silently truncates
  // and reports total_count == returned, leading to "page 1/1" with missing cards.
  const pageSize = 100;
  let page = 1;
  let totalPages = 1;
  let cardsWithPrice = 0;
  const MAX_PAGES = 10; // hard ceiling — no real set has 1000+ cards

  do {
    const endpoint =
      `/pokemon/v1/en/cards?q=${encodeURIComponent(`expansion.id:${setId}`)}` +
      `&page=${page}&page_size=${pageSize}&include=prices`;
    const result = await scrydexFetch(endpoint, apiKey, teamId);
    if (!result) {
      console.error(`[set:${setId}] Page ${page}: fetch failed, stopping`);
      break;
    }
    if (page === 1) {
      const total = result.total_count ?? 0;
      totalPages = Math.max(1, Math.min(MAX_PAGES, Math.ceil(total / pageSize)));
      console.log(`[set:${setId}] Total cards: ${total} — ${totalPages} pages`);
    }

    const rows = result.data ?? [];
    for (const card of rows) {
      const variantPrices = extractAllVariantPrices(card);
      if (variantPrices.length === 0) continue;
      if (seenIds.has(card.id)) continue;
      seenIds.add(card.id);
      cardsWithPrice++;

      for (const vp of variantPrices) {
        const suffix = vp.variant !== "normal" ? `::${vp.variant}` : "";
        buffer.push({
          card_id: `${normalizeScrydexCardId(card.id)}${suffix}`,
          card_name: card.name ?? "",
          set_name: card.expansion?.name ?? "",
          price: vp.price,
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
    const mode: "daily" | "full" | "chunk" | "sets" =
      body.mode === "full" ? "full"
      : body.mode === "chunk" ? "chunk"
      : body.mode === "sets" ? "sets"
      : "daily" as "daily" | "full" | "chunk" | "sets";
    const today = new Date().toISOString().split("T")[0];
    // Optional chunking: { mode:"chunk", startPage:1, pageLimit:50, orderBy:"-expansion.release_date" }
    const startPage: number = Math.max(1, Number(body.startPage) || 1);
    const chunkPageLimit: number = Math.max(1, Number(body.pageLimit) || 50);
    const orderBy: string = typeof body.orderBy === "string" ? body.orderBy : "-expansion.release_date";
    const setIds: string[] = Array.isArray(body.setIds)
      ? body.setIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
      : [];

    console.log(`snapshot-prices [${mode}] starting — ${today}`);

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

    const seenIds = new Set<string>();
    const buffer: SnapshotRow[] = [];
    const gradedBuffer: GradedSnapshotRow[] = [];
    const counters = { inserted: 0, skipped: 0 };
    const gradedCounters = { inserted: 0, skipped: 0 };
    let pagesProcessed = 0;

    const setSummaries: Array<{ setId: string; pages: number; priced: number }> = [];

    if (mode === "sets") {
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
            setId, apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters,
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
        console.log(`[sets] BACKGROUND DONE — sets=${setIds.length} inserted=${counters.inserted} skipped=${counters.skipped} graded=${gradedCounters.inserted}`, setSummaries);
        await refreshLatestCardPrices(supabase);
        await refreshLatestGradedPrices(supabase);
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
      // Chunk mode: fetch a specific page range (caller orchestrates pagination)
      pagesProcessed += await runPass({
        label: `chunk@${startPage}+${chunkPageLimit}`,
        orderBy,
        pageLimit: chunkPageLimit,
        startPage,
        apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters,
      });
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
            apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters,
          });
          const { inserted, skipped } = await flushRows(supabase, buffer);
          counters.inserted += inserted;
          counters.skipped += skipped;
          const gradedResult = await flushGradedRows(supabase, gradedBuffer);
          gradedCounters.inserted += gradedResult.inserted;
          gradedCounters.skipped += gradedResult.skipped;
          // 90-day cleanup (raw + graded)
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 90);
          const cutoffStr = cutoff.toISOString().split("T")[0];
          await supabase.from("price_snapshots").delete().lt("recorded_at", cutoffStr);
          await supabase.from("graded_price_snapshots").delete().lt("recorded_at", cutoffStr);
          console.log(`[full] BACKGROUND DONE — pages=${pagesProcessed} inserted=${counters.inserted} skipped=${counters.skipped} graded=${gradedCounters.inserted}`);
          await refreshLatestCardPrices(supabase);
          await refreshLatestGradedPrices(supabase);
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
            apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters,
          });

          // Pass 2 — oldest 60 pages (~6,000 oldest cards), skip any already seen
          pagesProcessed += await runPass({
            label: "oldest",
            orderBy: "expansion.release_date",
            pageLimit: DAILY_PAGE_LIMIT,
            startPage: 1,
            apiKey, teamId, supabase, today, seenIds, buffer, gradedBuffer, counters, gradedCounters,
          });

          const { inserted, skipped } = await flushRows(supabase, buffer);
          counters.inserted += inserted;
          counters.skipped += skipped;
          const gradedResult = await flushGradedRows(supabase, gradedBuffer);
          gradedCounters.inserted += gradedResult.inserted;
          gradedCounters.skipped += gradedResult.skipped;

          // 90-day retention sweep (raw + graded)
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 90);
          const cutoffStr = cutoff.toISOString().split("T")[0];
          await supabase.from("price_snapshots").delete().lt("recorded_at", cutoffStr);
          await supabase.from("graded_price_snapshots").delete().lt("recorded_at", cutoffStr);

          console.log(`[daily] BACKGROUND DONE — pages=${pagesProcessed} inserted=${counters.inserted} skipped=${counters.skipped} graded=${gradedCounters.inserted}`);
          await refreshLatestCardPrices(supabase);
          await refreshLatestGradedPrices(supabase);
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

    // ─ Reached only by sets/chunk modes that don't early-return above ─
    const { inserted, skipped } = await flushRows(supabase, buffer);
    counters.inserted += inserted;
    counters.skipped += skipped;
    const gradedResult = await flushGradedRows(supabase, gradedBuffer);
    gradedCounters.inserted += gradedResult.inserted;
    gradedCounters.skipped += gradedResult.skipped;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    await supabase.from("price_snapshots").delete().lt("recorded_at", cutoffStr);
    await supabase.from("graded_price_snapshots").delete().lt("recorded_at", cutoffStr);

    // Refresh both precomputed caches after chunk/sets sync paths too.
    await refreshLatestCardPrices(supabase);
    await refreshLatestGradedPrices(supabase);

    const summary: Record<string, unknown> = {
      success: true,
      mode,
      date: today,
      pages_processed: pagesProcessed,
      prices_saved: counters.inserted,
      prices_skipped: counters.skipped,
      graded_saved: gradedCounters.inserted,
      graded_skipped: gradedCounters.skipped,
    };
    console.log("Done:", summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Snapshot error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
