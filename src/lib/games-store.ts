// Client wrappers for the Card Match game + leaderboard.

import { supabase } from "@/integrations/supabase/client";

export interface CardMatchSession {
  session_id: string;
  started_at: string;
  slots: number;
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

export async function startCardMatch(): Promise<CardMatchSession> {
  const { data, error } = await supabase.functions.invoke("game-card-match-start");
  if (error) {
    // Edge function returns 403 with { error: "..." } body; surface that
    const msg = (data as { error?: string } | null)?.error || error.message;
    throw new Error(msg);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as CardMatchSession;
}

export async function flipCard(sessionId: string, slotIndex: number): Promise<FlipResult> {
  const { data, error } = await supabase.functions.invoke("game-card-match-flip", {
    body: { session_id: sessionId, slot_index: slotIndex },
  });
  if (error) {
    const msg = (data as { error?: string } | null)?.error || error.message;
    throw new Error(msg);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as FlipResult;
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
  const { data, error } = await supabase.rpc("get_game_leaderboard", {
    p_game: game,
    p_start: start,
    p_end: end,
  });
  if (error) throw error;
  return (data ?? []) as LeaderboardRow[];
}
