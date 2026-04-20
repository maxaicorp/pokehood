// Client wrappers for the Card Match game + leaderboard.

import { supabase } from "@/integrations/supabase/client";

export interface CardMatchSession {
  session_id: string;
  started_at: string;
  slots: number;
  // Independently shuffled list of unique image URLs (one per pair) so the
  // client can preload images before play starts. Order conveys no slot info.
  image_urls?: string[];
}

export interface SlotCard {
  card_id: string;
  name: string;
  image_small: string;
}

export interface FlipResult {
  slot: number;
  card: SlotCard;
  match?: boolean;
  otherSlot?: number;
  otherCard?: SlotCard;
  completed?: { score: number; duration_ms: number; wrong_flips: number };
}

export interface LeaderboardRow {
  rank: number;
  user_id: string;
  username: string;
  score: number;
  completed_at: string;
}

export type LeaderboardPeriod = "daily" | "weekly" | "alltime";

// Edge functions return { ok: true, ...payload } or { ok: false, error }.
// Always 200 status so the body reaches us reliably.
async function unwrap<T>(
  invoke: Promise<{ data: unknown; error: unknown }>,
  fallback: string,
): Promise<T> {
  const { data, error } = await invoke;
  // Network/transport-level error.
  if (error) {
    const ctx = (error as { context?: Response })?.context;
    if (ctx && typeof ctx.clone === "function") {
      try {
        const body = await ctx.clone().json();
        if (body?.error) throw new Error(String(body.error));
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
      }
    }
    throw new Error((error as Error)?.message || fallback);
  }
  const env = data as { ok?: boolean; error?: string } | null;
  if (!env || env.ok === false) throw new Error(env?.error || fallback);
  return env as unknown as T;
}

export async function startCardMatch(): Promise<CardMatchSession> {
  return unwrap<CardMatchSession>(
    supabase.functions.invoke("game-card-match-start"),
    "Failed to start game",
  );
}

export async function flipCard(sessionId: string, slotIndex: number): Promise<FlipResult> {
  return unwrap<FlipResult>(
    supabase.functions.invoke("game-card-match-flip", {
      body: { session_id: sessionId, slot_index: slotIndex },
    }),
    "Flip failed",
  );
}

function periodRange(period: LeaderboardPeriod): { start: string; end: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (period === "daily") return { start: today, end: today };
  if (period === "weekly") {
    // Monday → Sunday in UTC
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dow = d.getUTCDay() || 7; // 1..7, Mon=1
    d.setUTCDate(d.getUTCDate() - (dow - 1));
    const monday = d.toISOString().slice(0, 10);
    const sunday = new Date(d);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    return { start: monday, end: sunday.toISOString().slice(0, 10) };
  }
  // alltime
  return { start: "1970-01-01", end: "2999-12-31" };
}

export async function getLeaderboard(
  game: string,
  period: LeaderboardPeriod,
): Promise<LeaderboardRow[]> {
  const { start, end } = periodRange(period);
  // Cast RPC name — types.ts regenerates after migration deploys
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: Error | null }>)("get_game_leaderboard", {
    p_game: game,
    p_start: start,
    p_end: end,
  });
  if (error) throw error;
  return (data ?? []) as LeaderboardRow[];
}
