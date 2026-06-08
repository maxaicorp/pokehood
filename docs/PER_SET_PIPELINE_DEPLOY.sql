-- ============================================================================
-- PER-SET SNAPSHOT PIPELINE — deploy runbook (run top-to-bottom in SQL editor)
-- ============================================================================
-- The permanent fix for the 3-month stale-price bug. Replaces the global
-- page-chunk crawl (which silently DROPS random chase cards via offset drift)
-- with per-EXPANSION crawling on a 5-minute self-cycling cron. Each set is
-- fetched WHOLE and written ATOMICALLY (all-or-nothing), so the cache can
-- surface latest-per-card safely.
--
-- PREREQS (do these FIRST):
--   1. Run migration 20260607090000_latest_per_card_refresh.sql   (set-aware refresh)
--   2. Run migration 20260607093000_set_snapshot_state.sql        (tracker + claim/stamp)
--   3. Run migration 20260607100000_trends_deltas.sql             (deltas from Scrydex trends)
--   4. Run migration 20260607110000_chart_anchors.sql             (6 chart anchors + get_card_price_chart RPC)
--   5. Run migration 20260608100000_set_index.sql                 (heatmap/index)
--   6. Run migration 20260608110000_marketing_content_signals.sql (content queue)
--   7. Deploy edge fn `snapshot-prices` (version 2026-06-08-trends-6window-anchors)
--   8. Deploy edge fn `generate-content-signals`
-- THEN run this file.
-- ============================================================================

-- ── 1. Seed the set registry ONCE (EN physical non-Pocket expansions) ────────
-- Populates scrydex_set_snapshot_state from Scrydex /expansions (~5 credits).
-- The daily seed cron (step 4) keeps it current as new sets release.
SELECT net.http_post(
  url     := 'https://cmthndfrvnlyfxgxqjkm.supabase.co/functions/v1/snapshot-prices',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','CharlieDemon333'),
  body    := '{"mode":"seed-sets"}'::jsonb
);
-- Wait ~15s, then confirm the registry filled (~180 sets expected):
-- SELECT count(*) FROM public.scrydex_set_snapshot_state WHERE enabled;

-- ── 2. Retire the OLD global page-chunk crawl + its chunk-based heal ─────────
-- These ran the drift-prone global paging. The per-set crawl replaces them, and
-- it SELF-HEALS (a failed set stays pending, gets a few retries, then health
-- views surface it without blocking healthy sets), so the old chunk-based
-- verify-and-heal cron is now vestigial. The new job names are also unscheduled
-- here so this runbook can be re-run cleanly after a failed deploy attempt.
-- (prune-snapshots-weekly and refresh-latest-prices-daily stay — untouched.)
DO $$
DECLARE j record;
BEGIN
  FOR j IN
    SELECT jobname FROM cron.job
    WHERE jobname LIKE 'snapshot-chunk-%'
       OR jobname LIKE 'verify-and-heal%'
       OR jobname IN (
         'daily-snapshot-prices',
         'weekly-snapshot-prices-full',
         'snapshot-crawl-batch-5m',
         'seed-snapshot-sets-daily',
         'refresh-latest-prices-intraday',
         'refresh-set-index-intraday',
         'generate-content-signals-daily'
       )
  LOOP
    PERFORM cron.unschedule(j.jobname);
    RAISE NOTICE 'unscheduled %', j.jobname;
  END LOOP;
END $$;

-- ── 3. Schedule the new per-set crawl (every 5 min, 15 sets/tick) ────────────
-- ~180 sets ÷ 15 = ~12 ticks ≈ 60 min to refresh the whole catalog each morning,
-- then idle no-ops (0 due sets) until the next UTC day. ~1 credit/page, drift-free.
SELECT cron.schedule(
  'snapshot-crawl-batch-5m', '*/5 * * * *',
  $$ SELECT net.http_post(
       url     := 'https://cmthndfrvnlyfxgxqjkm.supabase.co/functions/v1/snapshot-prices',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','CharlieDemon333'),
       body    := '{"mode":"crawl-batch","limit":15}'::jsonb); $$
);

-- ── 4. Daily registry refresh (picks up newly released sets) — 00:05 UTC ──────
SELECT cron.schedule(
  'seed-snapshot-sets-daily', '5 0 * * *',
  $$ SELECT net.http_post(
       url     := 'https://cmthndfrvnlyfxgxqjkm.supabase.co/functions/v1/snapshot-prices',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','CharlieDemon333'),
       body    := '{"mode":"seed-sets"}'::jsonb); $$
);

-- ── 5. Decoupled cache refresh, every 20 min (surfaces landed sets) ──────────
-- Pure SQL — never touches Scrydex. Runs independently of the crawl so a crawl
-- hiccup can't block the read path. (The 07:00 daily refresh can stay or be
-- dropped; this supersedes it.)
SELECT cron.schedule(
  'refresh-latest-prices-intraday', '*/20 * * * *',
  $$ SELECT public.refresh_latest_card_prices(); SELECT public.refresh_latest_graded_prices(); $$
);

-- ── 5B. Set heatmap + marketing signals (pure SQL, zero Scrydex credits) ────
-- The heatmap/index page reads get_set_index_overview(); this snapshots the
-- current set baskets after latest_card_prices refreshes. Content signals are
-- draft rows for the admin graphic generator, not auto-posts.
SELECT cron.schedule(
  'refresh-set-index-intraday', '7,27,47 * * * *',
  $$ SELECT public.refresh_set_index(); $$
);

SELECT cron.schedule(
  'generate-content-signals-daily', '20 14 * * *',
  $$ SELECT net.http_post(
       url     := 'https://cmthndfrvnlyfxgxqjkm.supabase.co/functions/v1/generate-content-signals',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','CharlieDemon333'),
       body    := '{}'::jsonb); $$
);

-- ── 6. Verify ────────────────────────────────────────────────────────────────
-- Active crons:
-- SELECT jobname, schedule FROM cron.job ORDER BY jobname;
-- Pipeline health (after the first crawl cycle, ~1h):
-- SELECT * FROM public.v_snapshot_set_health;
-- Per-set detail:
-- SELECT set_id, status, last_success_on, last_cards_priced, attempts_today, last_error
--   FROM public.scrydex_set_snapshot_state WHERE enabled ORDER BY last_success_on NULLS FIRST LIMIT 30;
-- Heatmap:
-- SELECT public.refresh_set_index();
-- SELECT * FROM public.get_set_index_overview() LIMIT 20;
-- Content signals:
-- SELECT public.generate_marketing_content_signals();
-- SELECT signal_type, status, title, score FROM public.marketing_content_signals
--   ORDER BY signal_date DESC, score DESC LIMIT 20;
