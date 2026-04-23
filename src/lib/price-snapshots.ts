// Price snapshot helpers — fetch 24h / 7d / 30d % changes from Supabase
// Also provides historical chart data from the price_snapshots table.

import { supabase } from "@/integrations/supabase/client";

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

/**
 * Fetch the most recent snapshot price + historical % changes for every card.
 *
 * Historical matching strategy:
 * 1. Try exact card_id match (works when both dates use same ID format)
 * 2. Fall back to card_name + set_name match (bridges TCGdex->Scrydex ID migration)
 *    - When multiple variants share a name, pick the one with the closest price to current
 */
type Row = { card_id: string; card_name: string; set_name: string; price: number };

/** Fetch all rows for a given snapshot date, paginating past the 1,000-row default limit. */
async function fetchSnapshotDate(date: string): Promise<Row[]> {
  const PAGE = 1000;
  const rows: Row[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (supabase.from as any)("price_snapshots")
      .select("card_id, card_name, set_name, price")
      .eq("recorded_at", date)
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

export async function getLatestSnapshotPrices(): Promise<Map<string, LatestPrice>> {
  const map = new Map<string, LatestPrice>();

  // 1. Get the latest snapshot date
  const { data: dateRows } = await (supabase.from as any)("price_snapshots")
    .select("recorded_at")
    .order("recorded_at", { ascending: false })
    .limit(1);

  if (!dateRows?.length) return map;
  const latestDate = dateRows[0].recorded_at;

  // 2. Compute target dates for 1d, 7d, 30d ago + 2 fallback days.
  //    The daily cron sometimes skips middle pages, so we fetch the last 3 days
  //    and merge them (today wins, then yesterday, then 2-days-ago) so cards
  //    that weren't priced today still surface a recent price instead of N/A.
  // 2. Compute fallback dates (fill gaps in today's data) and historical comparison dates.
  //    Fallback: merge latest + yesterday + 2-days-ago so missing cards still get a price.
  //    Historical: compare effective-current vs 1d/7d/30d ago for % change columns.
  const latest = new Date(latestDate);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const dPrev1 = new Date(latest); dPrev1.setDate(dPrev1.getDate() - 1);
  const dPrev2 = new Date(latest); dPrev2.setDate(dPrev2.getDate() - 2);
  // Historical comparison dates (relative to latestDate, NOT the merge window)
  const d1 = new Date(latest); d1.setDate(d1.getDate() - 1);
  const d7 = new Date(latest); d7.setDate(d7.getDate() - 7);
  const d30 = new Date(latest); d30.setDate(d30.getDate() - 30);

  // 3. Fetch current + fallback days + historical comparison days in parallel.
  //    d1 overlaps with dPrev1 intentionally — we reuse the same fetch to avoid waste.
  const [currentRows, prev1Rows, prev2Rows, d7Rows, d30Rows] = await Promise.all([
    fetchSnapshotDate(latestDate),
    fetchSnapshotDate(fmt(dPrev1)),
    fetchSnapshotDate(fmt(dPrev2)),
    fetchSnapshotDate(fmt(d7)),
    fetchSnapshotDate(fmt(d30)),
  ]);

  // Merge by card_id: today wins, then yesterday fills gaps, then 2-days-ago fills the rest.
  // Same merge by name+set so name-fallback also benefits from the rolling window.
  const mergedById = new Map<string, Row>();
  for (const r of prev2Rows) mergedById.set(r.card_id, r);
  for (const r of prev1Rows) mergedById.set(r.card_id, r);
  for (const r of currentRows) mergedById.set(r.card_id, r);
  const effectiveCurrent: Row[] = Array.from(mergedById.values());

  if (!effectiveCurrent.length) return map;

  // Extract variant suffix (after "::") from a card_id, or "" for no variant.
  // Used to scope the name-based fallback so "Charizard 1st Edition" doesn't
  // get matched against "Charizard Unlimited" via name collision.
  const variantOf = (id: string) => {
    const i = id.indexOf("::");
    return i === -1 ? "" : id.slice(i + 2);
  };

  // Build lookup maps — first by card_id, then by name+set+variant for fallback
  function buildLookups(rows: Row[]) {
    const byId = new Map<string, number>();
    const byName = new Map<string, number[]>();
    for (const r of rows) {
      const price = Number(r.price);
      byId.set(r.card_id, price);
      const key = `${r.card_name}|${r.set_name}|${variantOf(r.card_id)}`.toLowerCase();
      const arr = byName.get(key);
      if (arr) arr.push(price);
      else byName.set(key, [price]);
    }
    return { byId, byName };
  }

  const lookup1d = buildLookups(prev1Rows);
  const lookup7d = buildLookups(d7Rows);
  const lookup30d = buildLookups(d30Rows);

  // Find the best historical price: exact ID match first, then name+set+variant with closest price,
  // then fall back to the base card's historical price (for brand-new variant rows that have no
  // history yet — gives them an immediate baseline that's close enough for same-priced variants;
  // wildly-off approximations are caught by the >1000% sanity guard in formatPct).
  function findHistoricalPrice(
    lookup: ReturnType<typeof buildLookups>,
    cardId: string,
    cardName: string,
    setName: string,
    currentPrice: number
  ): number | undefined {
    const byId = lookup.byId.get(cardId);
    if (byId !== undefined) return byId;

    const key = `${cardName}|${setName}|${variantOf(cardId)}`.toLowerCase();
    const candidates = lookup.byName.get(key);
    if (candidates?.length) {
      if (candidates.length === 1) return candidates[0];
      let best = candidates[0];
      let bestDiff = Math.abs(currentPrice - best);
      for (let i = 1; i < candidates.length; i++) {
        const diff = Math.abs(currentPrice - candidates[i]);
        if (diff < bestDiff) { best = candidates[i]; bestDiff = diff; }
      }
      return best;
    }

    // Base-card fallback: a variant-suffixed id ("base1-4::holofoil") falls back
    // to the base id ("base1-4") if it exists in history.
    const sep = cardId.indexOf("::");
    if (sep !== -1) {
      const baseId = cardId.slice(0, sep);
      const base = lookup.byId.get(baseId);
      if (base !== undefined) return base;
    }

    return undefined;
  }

  for (const row of effectiveCurrent) {
    const price = Number(row.price);
    const p1 = findHistoricalPrice(lookup1d, row.card_id, row.card_name, row.set_name, price);
    const p7 = findHistoricalPrice(lookup7d, row.card_id, row.card_name, row.set_name, price);
    const p30 = findHistoricalPrice(lookup30d, row.card_id, row.card_name, row.set_name, price);

    map.set(row.card_id, {
      cardId: row.card_id,
      cardName: row.card_name,
      setName: row.set_name,
      price,
      price1d: p1 ?? null,
      price7d: p7 ?? null,
      price30d: p30 ?? null,
    });
  }

  return map;
}
