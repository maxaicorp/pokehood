-- pipeline_heal_log — an audit trail for the verify-and-heal cron.
--
-- Every heal run writes one row: what the contract said before, what the heal
-- did about it, what it cost, and the result. Two reasons this table exists:
--   1. The retry CAP reads it — "how many re-snapshot repairs have I already
--      attempted today?" — so a persistently-broken pipeline can't loop and
--      burn Scrydex credits all day. Without a durable log there's nothing to
--      count against (edge functions are stateless between invocations).
--   2. It turns "is the self-heal actually working?" into a query you can read,
--      instead of digging through edge logs.
CREATE TABLE IF NOT EXISTS public.pipeline_heal_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at             timestamptz NOT NULL DEFAULT now(),
  -- contract failure codes that triggered this run, e.g. {low_coverage}
  trigger_failures   text[]      NOT NULL DEFAULT '{}',
  -- what the heal did, e.g. {refresh, resnapshot_chunks}
  actions            text[]      NOT NULL DEFAULT '{}',
  -- 'pass_noop' | 'healed' | 'partial' | 'still_failing'
  --   | 'skipped_locked' | 'skipped_budget' | 'flagged_history_gap' | 'error'
  result             text        NOT NULL,
  coverage_pct_before numeric,
  coverage_pct_after  numeric,
  delta_pct_before    numeric,
  delta_pct_after     numeric,
  credits_before      int,
  credits_after       int,
  credits_used        int,
  notes              text
);

-- The cap query filters by day + action, so index those reads.
CREATE INDEX IF NOT EXISTS pipeline_heal_log_ran_at_idx
  ON public.pipeline_heal_log (ran_at DESC);

-- Only service_role (the edge function) writes/reads it; admins read via the
-- function's service-role context. No public/anon access.
ALTER TABLE public.pipeline_heal_log ENABLE ROW LEVEL SECURITY;
-- UPDATE is needed too: the heal writes a 'running' lock row, then updates it
-- in place with the final result (which both records the outcome and releases
-- the lock). SELECT for the lock check + the retry-cap count.
GRANT SELECT, INSERT, UPDATE ON public.pipeline_heal_log TO service_role;

-- Convenience: today's repair-attempt count, used by the heal cron's retry cap.
-- A "repair attempt" = a run that actually re-ran snapshot chunks (the only
-- action that spends credits). Refresh-only runs are free and don't count.
CREATE OR REPLACE FUNCTION public.heal_repair_attempts_today()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.pipeline_heal_log
  WHERE ran_at >= date_trunc('day', now())
    AND 'resnapshot_chunks' = ANY(actions);
$$;

GRANT EXECUTE ON FUNCTION public.heal_repair_attempts_today() TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- CRON REGISTRATION (run MANUALLY in the SQL editor — NOT auto-applied here,
-- because it embeds the CRON_SECRET and project URL, which must not live in a
-- committed migration). Fill in <CRON_SECRET>, then run once.
--
-- Schedule: 08:00 UTC — AFTER the 06:00–06:40 snapshot chunks and the 07:00
-- refresh-latest-prices-daily, so it verifies the finished state and repairs
-- only what's still short.
--
--   select cron.schedule(
--     'verify-and-heal-daily',
--     '0 8 * * *',
--     $$
--     select net.http_post(
--       url := 'https://cmthndfrvnlyfxgxqjkm.supabase.co/functions/v1/verify-and-heal',
--       headers := jsonb_build_object(
--         'Content-Type','application/json',
--         'x-cron-secret','<CRON_SECRET>'
--       ),
--       body := '{}'::jsonb,
--       timeout_milliseconds := 120000
--     );
--     $$
--   );
--
-- To remove:  select cron.unschedule('verify-and-heal-daily');
-- ───────────────────────────────────────────────────────────────────────────
