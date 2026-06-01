-- Onchain robustness: a health contract for the onchain subsystem, mirroring
-- get_pipeline_completeness for prices. Same idea — measure the user-visible
-- OUTCOME as numbers so breakage shows red on the one board, plus SANITY GUARDS
-- that catch the logic-bug class self-heal can't (the $90k display bug was a
-- shape mismatch; the guard here flags any price_info shape we don't recognize
-- BEFORE a user finds it).
--
-- Failure codes split into two kinds (the heal cron treats them differently):
--   recoverable (re-run an ingest):  activity_stale, listings_stale, listings_empty
--   logic/data bug (flag, never auto-spend): insane_price, unknown_price_shape
CREATE OR REPLACE FUNCTION public.get_onchain_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── tunable thresholds ──
  c_activity_max_age_hrs numeric := 6;        -- newest event older than this ⇒ ingest likely dead
  c_listings_max_age_hrs numeric := 6;        -- listings not re-seen this long ⇒ listing ingest dead
  c_price_usd_ceiling    numeric := 100000;   -- a sale above this ⇒ a parse bug, not a real trade
  -- ────────────────────────
  v_now           bigint := extract(epoch FROM now())::bigint;
  v_newest_act    bigint;
  v_act_age_hrs   numeric;
  v_newest_list   timestamptz;
  v_list_age_hrs  numeric;
  v_listings_me   int;
  v_listings_cc   int;
  v_insane        int;
  v_unknown_shape int;
  v_failures      text[] := '{}';
  v_pass          boolean;
BEGIN
  -- Freshness: newest activity (incl. bids — they stream near-constantly, so a
  -- frozen max(block_time) is a reliable "ingest stopped" signal).
  SELECT max(block_time) INTO v_newest_act FROM public.onchain_activities;
  v_act_age_hrs := CASE WHEN v_newest_act IS NOT NULL
                     THEN round((v_now - v_newest_act) / 3600.0, 1) END;

  -- Listings freshness: the marketplace ingests bump last_seen_at on every pass.
  SELECT max(last_seen_at) INTO v_newest_list
    FROM public.onchain_listings WHERE delisted_at IS NULL;
  v_list_age_hrs := CASE WHEN v_newest_list IS NOT NULL
                      THEN round(extract(epoch FROM (now() - v_newest_list)) / 3600.0, 1) END;

  SELECT count(*) INTO v_listings_me FROM public.onchain_listings
    WHERE collection = 'collector_crypt' AND delisted_at IS NULL;
  SELECT count(*) INTO v_listings_cc FROM public.onchain_listings
    WHERE collection = 'collector_crypt_cc' AND delisted_at IS NULL;

  -- Sanity guard 1: a sale priced above the ceiling is a parse bug (e.g. raw
  -- lamports / a USDC amount mistaken for SOL), not a real trade.
  SELECT count(*) INTO v_insane FROM public.onchain_activities
    WHERE type = 'buyNow' AND price_usd > c_price_usd_ceiling
      AND block_time >= v_now - 2592000;  -- last 30d

  -- Sanity guard 2: a price_info shape we don't recognize. Known shapes:
  -- ME nested ('splPrice'/'solPrice') or Collector Crypt flat ('amount'). A new
  -- source writing an unhandled shape is EXACTLY the class of the $90k bug —
  -- flag it the moment it appears instead of waiting for a user to notice.
  SELECT count(*) INTO v_unknown_shape FROM public.onchain_activities
    WHERE block_time >= v_now - 604800     -- last 7d
      AND price_info IS NOT NULL
      AND NOT (price_info ? 'splPrice' OR price_info ? 'solPrice' OR price_info ? 'amount');

  IF v_newest_act IS NULL OR v_act_age_hrs > c_activity_max_age_hrs THEN
    v_failures := array_append(v_failures, 'activity_stale');
  END IF;
  IF v_newest_list IS NULL OR v_list_age_hrs > c_listings_max_age_hrs THEN
    v_failures := array_append(v_failures, 'listings_stale');
  END IF;
  -- Only flag emptiness on TOTAL absence — one source legitimately being thin
  -- shouldn't page us.
  IF v_listings_me = 0 AND v_listings_cc = 0 THEN
    v_failures := array_append(v_failures, 'listings_empty');
  END IF;
  IF v_insane > 0 THEN
    v_failures := array_append(v_failures, 'insane_price');
  END IF;
  IF v_unknown_shape > 0 THEN
    v_failures := array_append(v_failures, 'unknown_price_shape');
  END IF;

  v_pass := array_length(v_failures, 1) IS NULL;

  RETURN jsonb_build_object(
    'pass',               v_pass,
    'checked_at',         now(),
    'activity_age_hours', v_act_age_hrs,
    'listing_age_hours',  v_list_age_hrs,
    'listings_me',        v_listings_me,
    'listings_cc',        v_listings_cc,
    'insane_price_count', v_insane,
    'unknown_shape_count', v_unknown_shape,
    'failures',           to_jsonb(v_failures),
    'thresholds',         jsonb_build_object(
                            'activity_max_age_hours', c_activity_max_age_hrs,
                            'listings_max_age_hours', c_listings_max_age_hrs,
                            'price_usd_ceiling',      c_price_usd_ceiling
                          )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_onchain_health() TO service_role, authenticated;

-- ── Generalize the heal log for multiple subsystems ──────────────────────────
-- Tag each heal row with its subsystem so prices + onchain share one log + one
-- board, and the retry cap counts per-subsystem.
ALTER TABLE public.pipeline_heal_log
  ADD COLUMN IF NOT EXISTS subsystem text NOT NULL DEFAULT 'prices';

-- Generic per-subsystem, per-action attempt counter (the price heal keeps using
-- its own heal_repair_attempts_today(); this serves onchain + future subsystems).
CREATE OR REPLACE FUNCTION public.heal_attempts_today(p_subsystem text, p_action text)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.pipeline_heal_log
  WHERE ran_at >= date_trunc('day', now())
    AND subsystem = p_subsystem
    AND p_action = ANY(actions);
$$;

GRANT EXECUTE ON FUNCTION public.heal_attempts_today(text, text) TO service_role;

-- Try it:
--   SELECT public.get_onchain_health();
--
-- ───────────────────────────────────────────────────────────────────────────
-- CRON REGISTRATION (run MANUALLY in the SQL editor AFTER heal-onchain is
-- deployed — embeds CRON_SECRET, so not auto-applied here). Fill in
-- <CRON_SECRET>. Runs every 30 min; the ingests it re-triggers are cheap and
-- the cap (3/day) bounds it.
--
--   select cron.schedule(
--     'heal-onchain-30m',
--     '*/30 * * * *',
--     $$
--     select net.http_post(
--       url := 'https://cmthndfrvnlyfxgxqjkm.supabase.co/functions/v1/heal-onchain',
--       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
--       body := '{}'::jsonb,
--       timeout_milliseconds := 120000
--     );
--     $$
--   );
--
-- To remove:  select cron.unschedule('heal-onchain-30m');
-- ───────────────────────────────────────────────────────────────────────────
