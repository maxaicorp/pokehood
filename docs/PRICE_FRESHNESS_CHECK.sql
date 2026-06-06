-- WHY ARE PRICES STALE? — run top to bottom in the Supabase SQL editor.
-- Read-only diagnosis (no Scrydex credits). The Market/Explore tables read from
-- latest_card_prices (a precomputed cache), which is rebuilt from price_snapshots
-- by the daily refresh. Staleness is almost always "the refresh didn't run", NOT
-- missing data — so a backfill is rarely the fix. Find the broken layer first.

-- ── A) What the site actually shows: the read cache ──────────────────────────
SELECT
  max(updated_at)  AS cache_last_refreshed,   -- when the cache was last rebuilt
  max(recorded_at) AS cache_data_date,        -- the DATE of prices it holds
  count(*)         AS cached_cards
FROM public.latest_card_prices;

-- ── B) The source the cache is built from: raw snapshots ─────────────────────
SELECT
  max(recorded_at) AS newest_snapshot_date,
  count(*) FILTER (
    WHERE recorded_at = (SELECT max(recorded_at) FROM public.price_snapshots
                         WHERE card_id NOT LIKE 'sealed-%')
  ) AS cards_on_newest_date
FROM public.price_snapshots
WHERE card_id NOT LIKE 'sealed-%';

-- ── C) Did the crons fire? (snapshot chunks + the daily refresh) ─────────────
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;

SELECT j.jobname, r.status, r.start_time, left(r.return_message, 90) AS msg
FROM cron.job_run_details r JOIN cron.job j USING (jobid)
WHERE r.start_time > now() - interval '4 days'
ORDER BY r.start_time DESC
LIMIT 30;

-- ── HOW TO READ IT ───────────────────────────────────────────────────────────
-- • B newest_snapshot_date = TODAY  but  A cache_data_date = 3 days ago
--     -> the REFRESH didn't run. This is the common case. Run the FIX below.
-- • B newest_snapshot_date is ALSO 3 days old
--     -> the SNAPSHOT chunks failed (no new raw data). Check C's run_details for
--        the snapshot-chunk-* jobs (status=failed / errors). Fixing the refresh
--        won't help here — the chunks need to run.
-- • C shows the refresh/chunk job missing, active=false, or status='failed'
--     -> that's the smoking gun.

-- ── THE FIX (when cache is stale but snapshots are fresh — the usual case) ────
-- Rebuilds the read cache from the latest snapshots. Pure SQL, no credits.
SELECT public.refresh_latest_card_prices();
SELECT public.refresh_latest_graded_prices();

-- Re-run section A: cache_data_date should now be TODAY. Reload the site (the
-- read path is server-side; there is NO browser cache to bust).
