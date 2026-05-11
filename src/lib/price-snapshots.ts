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
function getAllLatestRows(): Promise<LatestRow[]> {
  if (!allLatestRowsPromise) allLatestRowsPromise = fetchAllLatestRows();
  return allLatestRowsPromise;
}

/** Fetch one visible Market page from the latest-per-card RPC, sorted by price.
 *  Excludes sealed-* rows — sealed products have their own tab and shouldn't
 *  mix into the card list. */
export async function getLatestSnapshotPage({
  limit = 10,
  offset = 0,
  setIds,
  sortDir = "desc",
}: LatestSnapshotPageOptions = {}): Promise<LatestPrice[]> {
  const all = await getAllLatestRows();
  if (!all.length) return [];

  let rows = all.filter((r) => !r.card_id.startsWith("sealed-") && keepRow(r.card_id));

  if (setIds?.size) {
    const prefixes = [...setIds].map((id) => `${id.split("::")[0]}-`).filter(Boolean);
    rows = rows.filter((r) => prefixes.some((p) => r.card_id.startsWith(p)));
  }

  rows.sort((a, b) => {
    const ap = Number(a.price);
    const bp = Number(b.price);
    return sortDir === "asc" ? ap - bp : bp - ap;
  });

  return rows.slice(offset, offset + limit).map(rowToLatestPrice);
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
