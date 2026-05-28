// Internal card stats tracking — powers future "most viewed", "trending", etc.
// All fire-and-forget: never blocks UI, never surfaces errors to users.

import { supabase } from "@/integrations/supabase/client";

type StatType = "view" | "search_hit" | "collection_add" | "wishlist_add";

interface CardIdentifier {
  id: string;        // tcg_api_id
  name: string;
  setName?: string;
  imageSmall?: string;
}

// Dedupe rapid-fire identical events (e.g. React strict-mode double-mount)
const recentEvents = new Map<string, number>();
const DEDUPE_MS = 5_000; // ignore same card+stat within 5 s

function isDuplicate(cardId: string, stat: StatType): boolean {
  const key = `${cardId}:${stat}`;
  const last = recentEvents.get(key);
  const now = Date.now();
  if (last && now - last < DEDUPE_MS) return true;
  recentEvents.set(key, now);
  // keep map from growing forever
  if (recentEvents.size > 200) {
    const cutoff = now - DEDUPE_MS;
    for (const [k, v] of recentEvents) {
      if (v < cutoff) recentEvents.delete(k);
    }
  }
  return false;
}

async function recordStat(card: CardIdentifier, stat: StatType) {
  if (isDuplicate(card.id, stat)) return;
  try {
    await (supabase.rpc as any)("increment_card_stat", {
      p_tcg_api_id: card.id,
      p_name: card.name,
      p_set_name: card.setName ?? "",
      p_image_small: card.imageSmall ?? "",
      p_stat: stat,
    });
  } catch {
    // silently ignore — analytics should never break the app
  }
}

/** Record a card detail page view */
export function recordCardView(card: CardIdentifier) {
  recordStat(card, "view");
}

/** Record that a card appeared in search results */
export function recordSearchHits(cards: CardIdentifier[]) {
  // only bump the top results to avoid flooding
  for (const card of cards.slice(0, 20)) {
    recordStat(card, "search_hit");
  }
}

/** Record a collection add */
export function recordCollectionAdd(card: CardIdentifier) {
  recordStat(card, "collection_add");
}

/** Record a wishlist add */
export function recordWishlistAdd(card: CardIdentifier) {
  recordStat(card, "wishlist_add");
}

// ── Read helpers (for future UI) ──────────────────────────────────────────────

export interface CardStatRow {
  tcg_api_id: string;
  name: string;
  set_name: string;
  image_small: string;
  view_count: number;
  search_hit_count: number;
  collection_add_count: number;
  wishlist_add_count: number;
}

// The health-check edge function probes increment_card_stat with a sentinel
// card (__health_check__ / "Health Check" / "System") on every run, which
// otherwise floods the top of Most Visited. Exclude it from every stats read.
const STATS_SELECT = "tcg_api_id, name, set_name, image_small, view_count, search_hit_count, collection_add_count, wishlist_add_count";
const HEALTH_CHECK_SENTINEL = "__health_check__";

export async function getMostViewed(limit = 20): Promise<CardStatRow[]> {
  const { data } = await (supabase.from as any)("card_stats")
    .select(STATS_SELECT)
    .neq("tcg_api_id", HEALTH_CHECK_SENTINEL)
    .order("view_count", { ascending: false })
    .limit(limit);
  return (data as CardStatRow[] | null) ?? [];
}

export async function getMostSearched(limit = 20): Promise<CardStatRow[]> {
  const { data } = await (supabase.from as any)("card_stats")
    .select(STATS_SELECT)
    .neq("tcg_api_id", HEALTH_CHECK_SENTINEL)
    .order("search_hit_count", { ascending: false })
    .limit(limit);
  return (data as CardStatRow[] | null) ?? [];
}

export async function getMostCollected(limit = 20): Promise<CardStatRow[]> {
  const { data } = await (supabase.from as any)("card_stats")
    .select(STATS_SELECT)
    .neq("tcg_api_id", HEALTH_CHECK_SENTINEL)
    .order("collection_add_count", { ascending: false })
    .limit(limit);
  return (data as CardStatRow[] | null) ?? [];
}

export async function getMostWishlisted(limit = 20): Promise<CardStatRow[]> {
  const { data } = await (supabase.from as any)("card_stats")
    .select(STATS_SELECT)
    .neq("tcg_api_id", HEALTH_CHECK_SENTINEL)
    .order("wishlist_add_count", { ascending: false })
    .limit(limit);
  return (data as CardStatRow[] | null) ?? [];
}
