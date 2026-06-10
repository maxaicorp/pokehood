-- ============================================================================
-- NEW SUPABASE — pg_cron schedule (run AFTER all migrations + edge fns deploy)
-- ============================================================================
-- WHY THIS FILE EXISTS: on the old (Lovable-managed) project the cron jobs were
-- created ad-hoc in the SQL editor and never committed, so they are NOT covered
-- by the 77 migrations. This file is the version-controlled source of truth for
-- every scheduled job, so the new project is fully reproducible.
--
-- BEFORE RUNNING:
--   1. Find/replace  __PROJECT_REF__   -> your new project ref (e.g. abcd1234...)
--   2. Find/replace  __CRON_SECRET__   -> a NEW random secret (then set the SAME
--      value as the CRON_SECRET edge-function secret). DO NOT reuse the old
--      'CharlieDemon333' literal that leaked into the repo — rotate it.
--   3. Ensure extensions pg_cron + pg_net are enabled:
--        create extension if not exists pg_cron;
--        create extension if not exists pg_net;
--
-- Re-runnable: every job is unscheduled first, so you can run this top-to-bottom
-- again after a failed attempt without "job already exists" errors.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── Clean slate (unschedule anything we are about to (re)create) ─────────────
do $$
declare j record;
begin
  for j in
    select jobname from cron.job
    where jobname in (
      'snapshot-crawl-batch-5m',
      'seed-snapshot-sets-daily',
      'refresh-latest-prices-intraday',
      'refresh-set-index-intraday',
      'generate-content-signals-daily',
      'cleanup-old-snapshots',
      'snapshot-sealed-daily',
      'ingest-onchain-activity-60s',
      'ingest-onchain-listings-2m'
    )
  loop
    perform cron.unschedule(j.jobname);
    raise notice 'unscheduled %', j.jobname;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- PRICE PIPELINE (per-set crawl — the current, drift-free design)
-- ════════════════════════════════════════════════════════════════════════════

-- Per-set crawl, 15 sets/tick. ~180 sets ÷ 15 = ~12 ticks ≈ 60 min/day, then
-- idle no-ops until the next UTC day. ~1 credit/page, atomic per expansion.
select cron.schedule(
  'snapshot-crawl-batch-5m', '*/5 * * * *',
  $$ select net.http_post(
       url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/snapshot-prices',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__'),
       body    := '{"mode":"crawl-batch","limit":15}'::jsonb); $$
);

-- Daily registry refresh — picks up newly released sets. 00:05 UTC.
select cron.schedule(
  'seed-snapshot-sets-daily', '5 0 * * *',
  $$ select net.http_post(
       url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/snapshot-prices',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__'),
       body    := '{"mode":"seed-sets"}'::jsonb); $$
);

-- Decoupled read-cache refresh (pure SQL, zero Scrydex credits), every 20 min.
-- Surfaces newly-landed sets independently of the crawl so a crawl hiccup can't
-- freeze the read path. Refreshes BOTH the raw and graded latest-price caches.
select cron.schedule(
  'refresh-latest-prices-intraday', '*/20 * * * *',
  $$ select public.refresh_latest_card_prices(); select public.refresh_latest_graded_prices(); $$
);

-- Set heatmap / index snapshot (pure SQL), a few minutes after each cache refresh.
select cron.schedule(
  'refresh-set-index-intraday', '7,27,47 * * * *',
  $$ select public.refresh_set_index(); $$
);

-- Marketing content-signal draft rows for the admin graphic generator. 14:20 UTC.
select cron.schedule(
  'generate-content-signals-daily', '20 14 * * *',
  $$ select net.http_post(
       url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/generate-content-signals',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__'),
       body    := '{}'::jsonb); $$
);

-- Prune old raw snapshots (retention). 03:00 UTC.
-- NOTE: migration 20260311000001_price_snapshots.sql also defines this; it is
-- repeated here only so this file is a complete picture. Harmless (unscheduled
-- above first).
select cron.schedule(
  'cleanup-old-snapshots', '0 3 * * *',
  $$ delete from public.price_snapshots where recorded_at < (now() - interval '120 days'); $$
);

-- Sealed-product price snapshot. Daily 06:50 UTC (just before the card crawl).
-- VERIFY body/mode against the deployed snapshot-sealed fn before relying on it.
select cron.schedule(
  'snapshot-sealed-daily', '50 6 * * *',
  $$ select net.http_post(
       url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/snapshot-sealed',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__'),
       body    := '{}'::jsonb); $$
);

-- ════════════════════════════════════════════════════════════════════════════
-- ONCHAIN INGEST (Collector Crypt / Magic Eden → DB)
-- ════════════════════════════════════════════════════════════════════════════

-- Activity feed ingest — every minute.
select cron.schedule(
  'ingest-onchain-activity-60s', '* * * * *',
  $$ select net.http_post(
       url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/ingest-onchain-activity',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__'),
       body    := '{}'::jsonb); $$
);

-- Marketplace listings ingest — every 2 minutes.
select cron.schedule(
  'ingest-onchain-listings-2m', '*/2 * * * *',
  $$ select net.http_post(
       url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/ingest-onchain-listings',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__'),
       body    := '{}'::jsonb); $$
);

-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️  RECONCILE AGAINST PRODUCTION — these MAY also run on the old project but
-- their exact schedule/body is NOT in the repo. Before go-live, run this on the
-- OLD (production) project's SQL editor and paste me the result so I can fill in
-- anything missing here:
--
--     SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
--
-- Candidates to confirm (edge fns that exist in supabase/functions/):
--   • ingest-cc-marketplace      (Collector Crypt native listings)
--   • ingest-cc-native           (Collector Crypt native USDC sales)
--   • cc-discovery-run / cc-price-check   (undervalued discovery)
--   • onchain-top-sales          (likely on-demand RPC, not a cron — verify)
--   • sol-price                  (likely on-demand — verify)
--   • scrydex-new-sets-check     (new-set watcher — schedule?)
--   • heal-onchain               (*/30 self-heal — optional, was commented out)
--   • verify-and-heal            (pipeline self-heal — optional)
--   • prune-snapshots-weekly / refresh-latest-prices-daily (older jobs the
--     per-set pipeline supersedes — confirm whether still scheduled)
-- ════════════════════════════════════════════════════════════════════════════

-- Verify what got scheduled:
-- SELECT jobname, schedule FROM cron.job ORDER BY jobname;
