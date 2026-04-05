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

/** Format a percentage with sign and color-appropriate CSS class */
export function formatPct(pct: number | null): { text: string; className: string } {
  if (pct == null) return { text: "—", className: "text-muted-foreground" };
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
  pricePct24h: number | null;
  pricePct7d: number | null;
  pricePct30d: number | null;
}

/**
 * Fetch the most recent snapshot price + historical % changes for every card.
 * Uses at most 4 small DB queries. Returns a Map keyed by card_id.
 */
export async function getLatestSnapshotPrices(): Promise<Map<string, LatestPrice>> {
  const map = new Map<string, LatestPrice>();

  // 1. Get distinct dates in descending order
  const { data: dateRows } = await (supabase.from as any)("price_snapshots")
    .select("recorded_at")
    .order("recorded_at", { ascending: false })
    .limit(1);

  if (!dateRows?.length) return map;
  const latestDate = dateRows[0].recorded_at;

  // 2. Compute target dates for 1d, 7d, 30d ago
  const latest = new Date(latestDate);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const d1 = new Date(latest); d1.setDate(d1.getDate() - 1);
  const d7 = new Date(latest); d7.setDate(d7.getDate() - 7);
  const d30 = new Date(latest); d30.setDate(d30.getDate() - 30);

  // 3. Fetch current prices + historical prices in parallel
  const [currentRes, d1Res, d7Res, d30Res] = await Promise.all([
    (supabase.from as any)("price_snapshots")
      .select("card_id, card_name, set_name, price")
      .eq("recorded_at", latestDate),
    (supabase.from as any)("price_snapshots")
      .select("card_id, price")
      .eq("recorded_at", fmt(d1)),
    (supabase.from as any)("price_snapshots")
      .select("card_id, price")
      .eq("recorded_at", fmt(d7)),
    (supabase.from as any)("price_snapshots")
      .select("card_id, price")
      .eq("recorded_at", fmt(d30)),
  ]);

  if (!currentRes.data) return map;

  // Build lookup maps for historical prices
  const priceMap1d = new Map<string, number>();
  const priceMap7d = new Map<string, number>();
  const priceMap30d = new Map<string, number>();
  for (const r of (d1Res.data || []) as Array<{ card_id: string; price: number }>) priceMap1d.set(r.card_id, Number(r.price));
  for (const r of (d7Res.data || []) as Array<{ card_id: string; price: number }>) priceMap7d.set(r.card_id, Number(r.price));
  for (const r of (d30Res.data || []) as Array<{ card_id: string; price: number }>) priceMap30d.set(r.card_id, Number(r.price));

  for (const row of currentRes.data as Array<{ card_id: string; card_name: string; set_name: string; price: number }>) {
    const price = Number(row.price);
    const p1 = priceMap1d.get(row.card_id);
    const p7 = priceMap7d.get(row.card_id);
    const p30 = priceMap30d.get(row.card_id);

    map.set(row.card_id, {
      cardId: row.card_id,
      cardName: row.card_name,
      setName: row.set_name,
      price,
      pricePct24h: p1 != null && p1 !== 0 ? ((price - p1) / p1) * 100 : null,
      pricePct7d: p7 != null && p7 !== 0 ? ((price - p7) / p7) * 100 : null,
      pricePct30d: p30 != null && p30 !== 0 ? ((price - p30) / p30) * 100 : null,
    });
  }

  return map;
}
