-- get_pipeline_completeness() — THE single "is the price pipeline actually
-- done?" contract. One definition of "complete", shared by the health-check
-- edge function, the admin health page, and (next) the verify-and-heal cron,
-- so "complete" can never mean three different things in three places.
--
-- Why this exists: every prior check answered "is it alive?" (any rows since
-- yesterday? >= 1,000 cards?) and went green during a 76%-coverage outage.
-- "succeeded" from pg_cron only means the job was dispatched, not that all
-- ~24k cards got priced. This measures completeness as a NUMBER against the
-- same tables the frontend reads, so a partial run shows red.
--
-- A run is COMPLETE only if ALL of:
--   1. coverage_pct  >= coverage_pct_min   — % of catalog snapshotted TODAY
--   2. delta_pct     >= delta_pct_min      — % of cache rows with a 24h delta
--                                            (this is literally "what % of the
--                                             market shows a 24h % change")
--   3. cache is fresh — latest_card_prices.updated_at is from today and
--      under cache_age_hours_max old (the refresh actually ran after the data)
--
-- Thresholds are constants below — tune them in one place.
CREATE OR REPLACE FUNCTION public.get_pipeline_completeness()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── tunable thresholds ──────────────────────────────────────────────
  c_coverage_pct_min   numeric := 90;   -- today's snapshot must cover >= 90% of catalog
  c_delta_pct_min      numeric := 75;   -- >= 75% of cards must have a 24h delta
  c_cache_age_hrs_max  numeric := 26;   -- cache refreshed within the last ~26h
  -- ────────────────────────────────────────────────────────────────────
  v_today             date := current_date;
  v_catalog           int;
  v_today_coverage    int;
  v_delta_coverage    int;
  v_cache_updated     timestamptz;
  v_coverage_pct      numeric;
  v_delta_pct         numeric;
  v_cache_age_hrs     numeric;
  v_cache_is_today    boolean;
  v_failures          text[] := '{}';
  v_pass              boolean;
BEGIN
  -- catalog = distinct non-sealed cards the site can display right now
  SELECT count(*) INTO v_catalog
    FROM public.latest_card_prices
    WHERE card_id NOT LIKE 'sealed-%';

  -- today's coverage = distinct non-sealed cards with a snapshot dated today
  SELECT count(DISTINCT card_id) INTO v_today_coverage
    FROM public.price_snapshots
    WHERE recorded_at = v_today
      AND card_id NOT LIKE 'sealed-%';

  -- delta coverage = cache rows that actually have a 24h comparison value
  SELECT count(*) INTO v_delta_coverage
    FROM public.latest_card_prices
    WHERE card_id NOT LIKE 'sealed-%'
      AND price_1d IS NOT NULL;

  SELECT max(updated_at) INTO v_cache_updated
    FROM public.latest_card_prices;

  v_coverage_pct  := CASE WHEN v_catalog > 0
                       THEN round(100.0 * v_today_coverage / v_catalog, 1) ELSE 0 END;
  v_delta_pct     := CASE WHEN v_catalog > 0
                       THEN round(100.0 * v_delta_coverage / v_catalog, 1) ELSE 0 END;
  v_cache_age_hrs := CASE WHEN v_cache_updated IS NOT NULL
                       THEN round(extract(epoch FROM (now() - v_cache_updated)) / 3600, 1) END;
  v_cache_is_today := v_cache_updated IS NOT NULL
                      AND (v_cache_updated AT TIME ZONE 'UTC')::date = v_today;

  -- NOTE: use array_append, not `|| 'literal'`. `text[] || 'low_coverage'`
  -- makes Postgres try to parse the string AS an array literal ({...}) and
  -- throws "malformed array literal". array_append(anyarray, anyelement) is
  -- unambiguous.
  IF v_coverage_pct < c_coverage_pct_min THEN
    v_failures := array_append(v_failures, 'low_coverage');
  END IF;
  IF v_delta_pct < c_delta_pct_min THEN
    v_failures := array_append(v_failures, 'low_delta_coverage');
  END IF;
  IF v_cache_updated IS NULL
     OR NOT v_cache_is_today
     OR v_cache_age_hrs > c_cache_age_hrs_max THEN
    v_failures := array_append(v_failures, 'stale_cache');
  END IF;

  v_pass := array_length(v_failures, 1) IS NULL;

  RETURN jsonb_build_object(
    'pass',             v_pass,
    'checked_at',       now(),
    'catalog',          v_catalog,
    'today_coverage',   v_today_coverage,
    'coverage_pct',     v_coverage_pct,
    'delta_coverage',   v_delta_coverage,
    'delta_pct',        v_delta_pct,
    'cache_updated_at', v_cache_updated,
    'cache_age_hours',  v_cache_age_hrs,
    'cache_is_today',   v_cache_is_today,
    'failures',         to_jsonb(v_failures),
    'thresholds',       jsonb_build_object(
                          'coverage_pct_min',    c_coverage_pct_min,
                          'delta_pct_min',       c_delta_pct_min,
                          'cache_age_hours_max', c_cache_age_hrs_max
                        )
  );
END;
$$;

-- service_role = edge functions (health-check, verify-and-heal cron);
-- authenticated = the admin health page calls it with the admin's JWT.
GRANT EXECUTE ON FUNCTION public.get_pipeline_completeness() TO service_role, authenticated;

-- Try it:
--   SELECT public.get_pipeline_completeness();
