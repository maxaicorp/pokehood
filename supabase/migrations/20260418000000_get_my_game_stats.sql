-- Personal game stats RPC for the /stats page
-- Returns aggregates + last 20 runs for the calling user, in a single round-trip.

CREATE OR REPLACE FUNCTION public.get_my_game_stats(p_game TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  result JSONB;
  week_start_d DATE := public.current_week_start();
  week_end_d DATE := week_start_d + 6;
  my_best_week INT;
  my_rank INT;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Best score this week (for rank calculation)
  SELECT MAX(score) INTO my_best_week
  FROM public.game_sessions
  WHERE user_id = uid
    AND game = p_game
    AND status = 'completed'
    AND period_key BETWEEN week_start_d AND week_end_d;

  -- Rank = (count of distinct users with a higher weekly best) + 1
  IF my_best_week IS NOT NULL THEN
    SELECT COUNT(*) + 1 INTO my_rank
    FROM (
      SELECT user_id, MAX(score) AS best
      FROM public.game_sessions
      WHERE game = p_game
        AND status = 'completed'
        AND period_key BETWEEN week_start_d AND week_end_d
        AND user_id <> uid
      GROUP BY user_id
      HAVING MAX(score) > my_best_week
    ) higher;
  END IF;

  SELECT jsonb_build_object(
    'best_score', (
      SELECT MAX(score) FROM public.game_sessions
      WHERE user_id = uid AND game = p_game AND status = 'completed'
    ),
    'total_games', (
      SELECT COUNT(*) FROM public.game_sessions
      WHERE user_id = uid AND game = p_game AND status = 'completed'
    ),
    'total_time_ms', (
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::BIGINT, 0)
      FROM public.game_sessions
      WHERE user_id = uid AND game = p_game AND status = 'completed'
    ),
    'weekly_best', my_best_week,
    'weekly_rank', my_rank,
    'recent_runs', COALESCE((
      SELECT jsonb_agg(r ORDER BY r.completed_at DESC)
      FROM (
        SELECT
          score,
          completed_at,
          wrong_flips,
          (EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::BIGINT AS duration_ms
        FROM public.game_sessions
        WHERE user_id = uid AND game = p_game AND status = 'completed'
        ORDER BY completed_at DESC
        LIMIT 20
      ) r
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_game_stats(TEXT) TO authenticated;
