import { supabase } from "@/integrations/supabase/client";

export interface GameRun {
  score: number;
  completed_at: string;
  wrong_flips: number;
  duration_ms: number;
}

export interface MyGameStats {
  best_score: number | null;
  total_games: number;
  total_time_ms: number;
  weekly_best: number | null;
  weekly_rank: number | null;
  recent_runs: GameRun[];
}

export async function getMyGameStats(game: string): Promise<MyGameStats> {
  // RPC name not yet in generated types until Lovable regenerates after migration.
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>)("get_my_game_stats", { p_game: game });
  if (error) throw error as Error;
  return data as MyGameStats;
}
