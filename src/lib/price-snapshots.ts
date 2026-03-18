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
  }>) {
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
