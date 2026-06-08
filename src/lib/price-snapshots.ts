// Price snapshot helpers — fetch 24h / 7d / 30d % changes from Supabase
// Also provides historical chart data from the price_snapshots table.

import { supabase } from "@/integrations/supabase/client";
import { PRICE_CACHE_TTL_MS, registerCacheResetter } from "@/lib/cache-invalidation";

export interface PriceChange {
  cardId: string;
  currentPrice: number | null;
  pct24h: number | null;
  pct7d: number | null;
  pct30d: number | null;
}

function pctChange(current: number | null, prev: number | null): number | null {
  if (current == null || prev == null || prev === 0) return null;
  return ((current - prev) / prev) * 100;
}

/**
 * Fetch price change data for a batch of card IDs.
 * Returns a Map keyed by card_id for O(1) lookups.
 */
export async function getPriceChanges(
  cardIds: string[]
): Promise<Map<string, PriceChange>> {
  const map = new Map<string, PriceChange>();
  if (cardIds.length === 0) return map;

  const { data, error } = await (supabase.rpc as any)("get_price_changes", {
    p_card_ids: cardIds,
  });

  if (error || !data) return map;

  for (const row of (data as unknown as Array<{
    card_id: string;
    current_price: number | null;
    price_1d_ago: number | null;
    price_7d_ago: number | null;
    price_30d_ago: number | null;
  }>)) {
    map.set(row.card_id, {
      cardId: row.card_id,
      currentPrice: row.current_price,
      pct24h: pctChange(row.current_price, row.price_1d_ago),
      pct7d: pctChange(row.current_price, row.price_7d_ago),
      pct30d: pctChange(row.current_price, row.price_30d_ago),
    });
  }

  return map;
}

/** Format a percentage with sign and color-appropriate CSS class.
 *  Guards against NaN, Infinity, and absurd values (>1000%) that indicate
 *  upstream data corruption — renders them as "—" rather than leaking garbage to the UI. */
const PCT_SANITY_LIMIT = 1000;
export function formatPct(pct: number | null): { text: string; className: string } {
  if (pct == null || !Number.isFinite(pct) || Math.abs(pct) > PCT_SANITY_LIMIT) {
    return { text: "—", className: "text-muted-foreground" };
  }
  const sign = pct >= 0 ? "+" : "";
  const text = `${sign}${pct.toFixed(2)}%`;
  if (pct > 0) return { text, className: "text-green-500" };
  if (pct < 0) return { text, className: "text-red-500" };
  return { text, className: "text-muted-foreground" };
}

// ── Historical chart data ─────────────────────────────────────────────────────

export interface PriceHistoryPoint {
  date: string;   // YYYY-MM-DD
  price: number;
}

/**
 * Fetch daily price history for a single card from the snapshots table.
 * Returns oldest→newest. Empty array if no snapshots exist yet.
 */
export async function getCardPriceHistory(
  cardId: string,
  days = 90
): Promise<PriceHistoryPoint[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const { data, error } = await (supabase.from as any)("price_snapshots")
    .select("recorded_at, price")
    .eq("card_id", cardId)
    .gte("recorded_at", cutoffStr)
    .order("recorded_at", { ascending: true });

  if (error || !data) return [];
  return (data as Array<{ recorded_at: string; price: number }>).map((row) => ({ date: row.recorded_at, price: Number(row.price) }));
}

export interface CardChartData {
  /** Dense daily series from real snapshots (oldest→newest). */
  points: PriceHistoryPoint[];
  /** Latest recorded price. */
  current: number | null;
  /** Trend-derived prior prices for the deep 6-month shape (null when uncrawled). */
  anchors: {
    d1: number | null; d7: number | null; d14: number | null;
    d30: number | null; d90: number | null; d180: number | null;
  } | null;
}

/**
 * Everything the card chart needs, from the DB ONLY (no Scrydex). Backed by the
 * get_card_price_chart RPC (SECURITY DEFINER, granted to anon) so the chart works
 * for logged-out visitors and costs zero credits. The deep 6-month shape comes
 * from the latest snapshot row's trend anchors; dense recent detail from the
 * daily series.
 */
export async function getCardPriceChart(cardId: string, days = 365): Promise<CardChartData> {
  const { data, error } = await (supabase.rpc as any)("get_card_price_chart", {
    p_card_id: cardId,
    p_days: days,
  });
  if (error || !data) return { points: [], current: null, anchors: null };
  const d = data as {
    points?: Array<{ date: string; price: number }>;
    current?: number | null;
    anchors?: CardChartData["anchors"];
  };
  return {
    points: (d.points ?? []).map((p) => ({ date: p.date, price: Number(p.price) })),
    current: d.current ?? null,
    anchors: d.anchors ?? null,
  };
}

// ── Bulk latest prices for instant Market page loading ────────────────────────

export interface LatestPrice {
  cardId: string;
  cardName: string;
  setName: string;
  price: number;
  // Raw prior-day snapshot prices. % change is computed at display time from these,
  // NOT stored as pct and reverse-engineered later (that caused runaway error amplification).
  price1d: number | null;
  price7d: number | null;
  price30d: number | null;
}

export interface LatestSnapshotPageOptions {
  limit?: number;
  offset?: number;
  setIds?: Set<string>;
  sortDir?: "asc" | "desc";
}

/**
 * Fetch the most recent snapshot price + historical % changes for every card.
 *
 * Backed by the `get_all_latest_prices` RPC (DISTINCT ON card_id ORDER BY recorded_at DESC).
 * Returns each card's latest snapshot regardless of age — so chase cards with
 * sparse Scrydex pricing don't drop out just because the last 3 days had no row.
 */
type LatestRow = {
  card_id: string;
  card_name: string;
  set_name: string;
  price: number | string;
  recorded_at: string;
  price_1d: number | string | null;
  price_7d: number | string | null;
  price_30d: number | string | null;
};

const EARLY_VARIANT_SET_IDS = new Set([
  "base1", "base2", "base3", "base4", "base5", "base6",
  "gym1", "gym2",
  "neo1", "neo2", "neo3", "neo4",
]);

// Modern card variants (e.g. `me2pt5-225::reverseHolofoil`) get collapsed to
// the bare card_id by the snapshot pipeline. If a stray ::variant row sneaks
// in for a non-vintage set, drop it so it doesn't double-count or override
// the canonical bare row.
function keepRow(cardId: string): boolean {
  if (!cardId.includes("::")) return true;
  const baseId = cardId.split("::")[0];
  const setId = baseId.split("-").slice(0, -1).join("-") || baseId;
  return EARLY_VARIANT_SET_IDS.has(setId);
}

const numOrNull = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function rowToLatestPrice(row: LatestRow): LatestPrice {
  return {
    cardId: row.card_id,
    cardName: row.card_name,
    setName: row.set_name,
    price: Number(row.price),
    price1d: numOrNull(row.price_1d),
    price7d: numOrNull(row.price_7d),
    price30d: numOrNull(row.price_30d),
  };
}

/** Fetch every card's latest snapshot via the get_all_latest_prices RPC, paginating
 *  through the function's p_limit/p_offset arguments past PostgREST's default cap. */
async function fetchAllLatestRows(): Promise<LatestRow[]> {
  // PostgREST caps RPC result sets at 1,000 rows even when p_limit is higher.
  // Keep the page size aligned with that cap so we do not stop after the first
  // alphabetic chunk (base sets only), which hides newer sets like Ascended Heroes.
  const PAGE = 1000;
  const rows: LatestRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await (supabase.rpc as any)("get_all_latest_prices", {
      p_limit: PAGE,
      p_offset: offset,
    });
    if (error || !data) break;
    rows.push(...(data as LatestRow[]));
    if ((data as LatestRow[]).length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

let allLatestRowsPromise: Promise<LatestRow[]> | null = null;
let allLatestRowsAt = 0;
function getAllLatestRows(): Promise<LatestRow[]> {
  // TTL so a long-open tab eventually pulls fresh prices on its own; the
  // explicit reset (force-refresh / realtime push) clears it immediately.
  if (allLatestRowsPromise && Date.now() - allLatestRowsAt < PRICE_CACHE_TTL_MS) {
    return allLatestRowsPromise;
  }
  allLatestRowsAt = Date.now();
  allLatestRowsPromise = fetchAllLatestRows();
  return allLatestRowsPromise;
}
/** Drop the cached latest-rows so the next read refetches from the DB. */
export function resetLatestPricesCache(): void {
  allLatestRowsPromise = null;
  allLatestRowsAt = 0;
}
registerCacheResetter(resetLatestPricesCache);

/** Fetch one visible Market page from the latest-per-card RPC, sorted by price.
 *  Excludes sealed-* rows — sealed products have their own tab and shouldn't
 *  mix into the card list. */
export async function getLatestSnapshotPage({
  limit = 10,
  offset = 0,
  setIds,
  sortDir = "desc",
}: LatestSnapshotPageOptions = {}): Promise<LatestPrice[]> {
  const { data, error } = await (supabase.rpc as any)("get_latest_price_page", {
    p_limit: limit,
    p_offset: offset,
    p_set_ids: setIds?.size ? [...setIds] : null,
    p_sort_dir: sortDir,
    p_include_sealed: false,
  });

  if (error || !data) return [];
  return (data as LatestRow[])
    .filter((r) => !r.card_id.startsWith("sealed-") && keepRow(r.card_id))
    .map(rowToLatestPrice);
}

/** Fetch the FULL filtered card set (capped) in one call, for client-side
 *  sorting + the Trending/Gainers/Losers tabs. The cap keeps multi-set / "All"
 *  filters bounded to the same top-N the header summary uses, and sorting by
 *  price desc means the cap selects the most valuable cards. Without this the
 *  Market only ever had the handful of rows scrolled into view, so a column
 *  sort or a mover tab could only reorder that tiny subset. */
export async function getLatestSnapshotAll({
  setIds,
  limit = 500,
}: { setIds?: Set<string>; limit?: number } = {}): Promise<LatestPrice[]> {
  return getLatestSnapshotPage({ setIds, limit, offset: 0, sortDir: "desc" });
}

/** Top movers across the WHOLE catalog (price >= minPrice), ranked server-side
 *  by absolute % move over the window — not a client sort over a price-capped
 *  page, so a $3 card that mooned still surfaces. Powers the merged Movers tab. */
export async function getTopMovers({
  window = "24h",
  minPrice = 2,
  setIds,
  limit = 250,
}: { window?: "24h" | "7d" | "30d"; minPrice?: number; setIds?: Set<string>; limit?: number } = {}): Promise<LatestPrice[]> {
  const { data, error } = await (supabase.rpc as any)("get_top_movers", {
    p_window: window,
    p_min_price: minPrice,
    p_set_ids: setIds?.size ? [...setIds] : null,
    p_limit: limit,
  });
  if (error || !data) return [];
  return (data as LatestRow[])
    .filter((r) => !r.card_id.startsWith("sealed-") && keepRow(r.card_id))
    .map(rowToLatestPrice);
}

// ─── Graded market data (the /market "Graded" tab) ────────────────────────────
export interface GradedRow {
  cardId: string;
  cardName: string;
  setName: string;
  company: string;
  grade: number;
  market: number;
  low: number | null;
  high: number | null;
}

/** Value-sorted graded slabs for one company + grade, optionally set-scoped.
 *  Backed by get_graded_page over latest_graded_prices. */
export async function getGradedPage(opts: {
  company: string;
  grade: number;
  setIds?: string[] | null;
  minPrice?: number;
  limit?: number;
  offset?: number;
}): Promise<GradedRow[]> {
  const { data, error } = await (supabase.rpc as any)("get_graded_page", {
    p_company: opts.company,
    p_grade: opts.grade,
    p_set_ids: opts.setIds && opts.setIds.length ? opts.setIds : null,
    p_min_price: opts.minPrice ?? 0,
    p_limit: opts.limit ?? 250,
    p_offset: opts.offset ?? 0,
  });
  if (error || !Array.isArray(data)) return [];
  return (data as any[]).map((r) => ({
    cardId: r.card_id,
    cardName: r.card_name,
    setName: r.set_name,
    company: r.company,
    grade: Number(r.grade),
    market: Number(r.market),
    low: r.low != null ? Number(r.low) : null,
    high: r.high != null ? Number(r.high) : null,
  }));
}

/** Which (company, grade) combos exist + counts — powers the tab's dropdowns. */
export async function getGradedFilterOptions(): Promise<{ company: string; grade: number; count: number }[]> {
  const { data, error } = await (supabase.rpc as any)("get_graded_filter_options");
  if (error || !Array.isArray(data)) return [];
  return (data as any[]).map((r) => ({ company: r.company, grade: Number(r.grade), count: Number(r.card_count) }));
}

/** Fetch latest price + 1d/7d/30d for a specific set of card ids (chunked to
 *  stay under PostgREST URL limits). Used to hydrate small lists like
 *  Most-Visited without pulling the whole latest-prices set. */
export async function getLatestPricesByIds(ids: string[]): Promise<Map<string, LatestPrice>> {
  const map = new Map<string, LatestPrice>();
  const unique = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await (supabase.from as any)("latest_card_prices")
      .select("card_id, card_name, set_name, price, price_1d, price_7d, price_30d")
      .in("card_id", unique.slice(i, i + 200));
    for (const row of (data ?? []) as LatestRow[]) {
      map.set(row.card_id, rowToLatestPrice(row));
    }
  }
  return map;
}

/**
 * Latest prices for a SINGLE set (base + variant rows) in one indexed prefix
 * query. The targeted alternative to getLatestSnapshotPrices() for single-card
 * / single-set pages, which otherwise blocked on the full ~22k-row table just
 * to price one card. The `-%` prefix is safe because the set/number delimiter
 * is a literal "-" (e.g. "sv1-%" matches "sv1-1" / "sv1-1::reverseHolofoil"
 * but never "sv10-1").
 */
export async function getLatestPricesForSet(setId: string): Promise<Map<string, LatestPrice>> {
  const map = new Map<string, LatestPrice>();
  const { data } = await (supabase.from as any)("latest_card_prices")
    .select("card_id, card_name, set_name, price, price_1d, price_7d, price_30d")
    .like("card_id", `${setId}-%`);
  for (const row of (data ?? []) as LatestRow[]) {
    map.set(row.card_id, rowToLatestPrice(row));
  }
  return map;
}

export async function getLatestSnapshotPrices(): Promise<Map<string, LatestPrice>> {
  const map = new Map<string, LatestPrice>();
  const rows = await getAllLatestRows();
  for (const row of rows) {
    if (!keepRow(row.card_id)) continue;
    map.set(row.card_id, rowToLatestPrice(row));
  }
  return map;
}
