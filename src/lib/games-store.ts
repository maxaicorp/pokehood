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

// supabase-js doesn't expose the response body on non-2xx by default, so we
// reach into the FunctionsHttpError context (which holds the Response) and
// read the body to surface the real { error: "..." } message.
async function extractEdgeError(error: unknown, data: unknown): Promise<string> {
  const fromData = (data as { error?: string } | null)?.error;
  if (fromData) return fromData;
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    } catch { /* fall through */ }
  }
  return (error as Error)?.message || "Edge function failed";
}

export async function startCardMatch(): Promise<CardMatchSession> {
  const { data, error } = await supabase.functions.invoke("game-card-match-start");
  if (error) throw new Error(await extractEdgeError(error, data));
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as CardMatchSession;
}

export async function flipCard(sessionId: string, slotIndex: number): Promise<FlipResult> {
  const { data, error } = await supabase.functions.invoke("game-card-match-flip", {
    body: { session_id: sessionId, slot_index: slotIndex },
  });
  if (error) throw new Error(await extractEdgeError(error, data));
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
