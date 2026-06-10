-- ============================================================================
-- NEW SUPABASE — one-time FULL POPULATE (run AFTER migrations + edge fns +
-- 01_crons.sql, and AFTER the SCRYDEX_* / CRON_SECRET edge secrets are set)
-- ============================================================================
-- Gets the whole site populated in one sitting instead of waiting days for the
-- daily cron to trickle. Find/replace __PROJECT_REF__ and __CRON_SECRET__ first.
--
-- net.http_post is FIRE-AND-FORGET in the SQL editor (it returns a request id,
-- it does NOT wait for the function to finish). So the pattern is: fire a step,
-- wait the noted time, then run the verify query before moving on.
-- ============================================================================

-- ── STEP 1: Seed the set registry (~5 Scrydex credits) ───────────────────────
select net.http_post(
  url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/snapshot-prices',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__'),
  body    := '{"mode":"seed-sets"}'::jsonb
);
-- Wait ~20s, then confirm ~180 sets registered:
--   SELECT count(*) FROM public.scrydex_set_snapshot_state WHERE enabled;

-- ── STEP 2: Crawl EVERY set (the "full populate") ────────────────────────────
-- Each crawl-batch call prices up to `limit` sets that are still DUE today, then
-- stamps them done. ~180 sets total. Fire the call below, wait ~90s, run the
-- progress query, and REPEAT until pending = 0. (limit:25 ≈ 8 rounds.)
--
-- Repeatable call:
select net.http_post(
  url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/snapshot-prices',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__'),
  body    := '{"mode":"crawl-batch","limit":25}'::jsonb
);
-- Progress (repeat after each fire; stop when pending = 0):
--   SELECT
--     count(*) FILTER (WHERE last_success_on = (now() at time zone 'utc')::date) AS done_today,
--     count(*) FILTER (WHERE last_success_on IS DISTINCT FROM (now() at time zone 'utc')::date) AS pending,
--     count(*) AS total
--   FROM public.scrydex_set_snapshot_state WHERE enabled;
--
-- (You can also just leave the snapshot-crawl-batch-5m cron running and the
--  catalog fills itself within ~1 hour — manual firing is only to go faster.)

-- ── STEP 3: Build the read caches (pure SQL, no credits) ─────────────────────
-- Run AFTER step 2 shows pending = 0.
select public.refresh_latest_card_prices();
select public.refresh_latest_graded_prices();
select public.refresh_set_index();

-- ── STEP 4: Sealed products (one snapshot) ───────────────────────────────────
select net.http_post(
  url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/snapshot-sealed',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__'),
  body    := '{}'::jsonb
);

-- ── STEP 5: Cards catalog (so live search / completeness gate has data) ──────
-- Populates the self-updating `cards` table from Scrydex.
select net.http_post(
  url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/sync-cards-catalog',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__'),
  body    := '{}'::jsonb
);

-- ── STEP 6: Kickstart onchain feeds (so /onchain isn't empty) ────────────────
select net.http_post(
  url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/ingest-onchain-activity',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__'),
  body    := '{}'::jsonb
);
select net.http_post(
  url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/ingest-onchain-listings',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__CRON_SECRET__'),
  body    := '{}'::jsonb
);

-- ── STEP 7: Final verification (expect the same PASS table as production) ─────
-- Run the existing read-only smoke test:
--   docs/LAUNCH_READINESS.sql
-- Expected: prices fresh, ~20k+ cards priced, deltas present, onchain rows > 0,
-- all 9 crons present.
