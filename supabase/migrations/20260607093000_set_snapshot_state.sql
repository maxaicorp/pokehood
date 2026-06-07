-- Per-set snapshot tracker — the "truth contract" for the new crawl-batch pipeline.
--
-- The daily price crawl moves from global page-paging (which silently DROPS
-- random cards each run due to offset drift on live data) to per-EXPANSION
-- crawling (each set fetched whole = no drift). This table is the work queue
-- AND the completeness ledger: a set's snapshot rows count as "current" only
-- after the set is stamped success here. Combined with ATOMIC per-set writes
-- (the edge fn buffers all pages of a set and upserts only if the whole set
-- succeeded), this guarantees price_snapshots never holds a partial set — which
-- is what makes the latest-per-card refresh safe.
--
-- Claiming uses FOR UPDATE SKIP LOCKED so a 5-minute cron can never double-work
-- a set even if a prior slow run overlaps.

CREATE TABLE IF NOT EXISTS public.scrydex_set_snapshot_state (
  set_id            TEXT PRIMARY KEY,
  set_name          TEXT,
  series            TEXT,
  language_code     TEXT,
  is_online_only    BOOLEAN NOT NULL DEFAULT false,
  card_total        INT,                                -- expansion's total card count (from Scrydex /expansions)
  enabled           BOOLEAN NOT NULL DEFAULT true,
  status            TEXT NOT NULL DEFAULT 'pending',   -- pending | claimed | success | error
  last_success_on   DATE,                              -- the UTC date this set last fully succeeded
  last_success_at   TIMESTAMPTZ,
  last_attempt_at   TIMESTAMPTZ,
  locked_until      TIMESTAMPTZ,                        -- claim lease; NULL/expired = claimable
  run_id            TEXT,                               -- which run currently holds the lease
  attempts_today    INT NOT NULL DEFAULT 0,
  attempts_on       DATE,                               -- date attempts_today is counted against
  last_error        TEXT,
  last_pages        INT,
  last_cards_seen   INT,
  last_cards_priced INT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Claim query hits: enabled + due (not done today) + unlocked, oldest-first.
CREATE INDEX IF NOT EXISTS idx_set_snapshot_due
  ON public.scrydex_set_snapshot_state (enabled, last_success_on NULLS FIRST, locked_until);

ALTER TABLE public.scrydex_set_snapshot_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "set_snapshot_state admin read" ON public.scrydex_set_snapshot_state;
CREATE POLICY "set_snapshot_state admin read" ON public.scrydex_set_snapshot_state
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT, INSERT, UPDATE ON public.scrydex_set_snapshot_state TO service_role;

-- ─── Claim N due sets atomically ────────────────────────────────────────────
-- Returns the claimed rows (leased for p_lock_minutes). SKIP LOCKED means
-- concurrent runs grab disjoint sets and never block each other.
CREATE OR REPLACE FUNCTION public.claim_due_snapshot_sets(
  p_limit       INT,
  p_lock_minutes INT DEFAULT 8,
  p_run_id      TEXT DEFAULT NULL
)
RETURNS SETOF public.scrydex_set_snapshot_state
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH due AS (
    SELECT set_id
    FROM public.scrydex_set_snapshot_state
    WHERE enabled
      AND (last_success_on IS NULL OR last_success_on < CURRENT_DATE)
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY last_success_on NULLS FIRST, set_id
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scrydex_set_snapshot_state s
  SET status         = 'claimed',
      locked_until   = now() + make_interval(mins => GREATEST(p_lock_minutes, 1)),
      run_id         = p_run_id,
      last_attempt_at = now(),
      attempts_today = CASE WHEN s.attempts_on = CURRENT_DATE THEN s.attempts_today + 1 ELSE 1 END,
      attempts_on    = CURRENT_DATE,
      updated_at     = now()
  FROM due
  WHERE s.set_id = due.set_id
  RETURNING s.*;
$$;

-- ─── Stamp a set's outcome ───────────────────────────────────────────────────
-- success: marks it done for today (drops out of the due queue until tomorrow).
CREATE OR REPLACE FUNCTION public.mark_set_snapshot_success(
  p_set_id       TEXT,
  p_pages        INT DEFAULT NULL,
  p_cards_seen   INT DEFAULT NULL,
  p_cards_priced INT DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.scrydex_set_snapshot_state
  SET status          = 'success',
      last_success_on  = CURRENT_DATE,
      last_success_at  = now(),
      locked_until     = NULL,
      run_id           = NULL,
      last_error       = NULL,
      last_pages       = COALESCE(p_pages, last_pages),
      last_cards_seen  = COALESCE(p_cards_seen, last_cards_seen),
      last_cards_priced = COALESCE(p_cards_priced, last_cards_priced),
      updated_at       = now()
  WHERE set_id = p_set_id;
$$;

-- error: clears the lease so the set is immediately retryable next tick. We do
-- NOT touch last_success_on, so it stays in the due queue.
CREATE OR REPLACE FUNCTION public.mark_set_snapshot_error(
  p_set_id TEXT,
  p_error  TEXT
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.scrydex_set_snapshot_state
  SET status       = 'error',
      locked_until = NULL,
      run_id       = NULL,
      last_error   = left(p_error, 1000),
      updated_at   = now()
  WHERE set_id = p_set_id;
$$;

-- ─── Watchdog view — sets that are behind or repeatedly failing today ────────
CREATE OR REPLACE VIEW public.v_snapshot_set_health AS
  SELECT
    count(*)                                                               AS total_sets,
    count(*) FILTER (WHERE last_success_on = CURRENT_DATE)                 AS fresh_today,
    count(*) FILTER (WHERE last_success_on IS DISTINCT FROM CURRENT_DATE)  AS stale_today,
    count(*) FILTER (WHERE status = 'error')                              AS in_error,
    count(*) FILTER (WHERE attempts_on = CURRENT_DATE AND attempts_today >= 3
                       AND last_success_on IS DISTINCT FROM CURRENT_DATE) AS failing_repeatedly,
    COALESCE(sum(card_total) FILTER (WHERE last_success_on = CURRENT_DATE), 0)        AS cards_total_fresh,
    COALESCE(sum(last_cards_priced) FILTER (WHERE last_success_on = CURRENT_DATE), 0) AS cards_priced_fresh,
    min(last_success_at)                                                   AS oldest_success_at,
    max(last_success_at)                                                   AS newest_success_at
  FROM public.scrydex_set_snapshot_state
  WHERE enabled;

GRANT SELECT ON public.v_snapshot_set_health TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_due_snapshot_sets(INT, INT, TEXT)            TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_set_snapshot_success(TEXT, INT, INT, INT)     TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_set_snapshot_error(TEXT, TEXT)                TO service_role;

NOTIFY pgrst, 'reload schema';
