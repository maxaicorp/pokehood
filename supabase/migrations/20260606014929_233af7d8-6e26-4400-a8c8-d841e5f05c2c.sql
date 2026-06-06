CREATE OR REPLACE FUNCTION public.refresh_latest_card_prices()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INT := 0;
  card_count INT := 0;
  sealed_count INT := 0;
  v_source_date DATE;
  c_complete_floor INT := 17000;
BEGIN
  /*
    Rebuild the read cache from the latest COMPLETE priced card window only.

    The old implementation selected DISTINCT ON (card_id) across all history,
    which silently carried stale/fallback-era rows forward forever. After the
    NM-only snapshot change, that made latest_card_prices look healthy (~22k
    rows) while thousands of cards were actually old carry-forward prices. The
    frontend reads latest_card_prices, so stale rows here are stale UI prices.

    Cards: use the most recent non-sealed recorded_at with enough priced rows.
    Sealed: keep latest per sealed product independently; sealed has its own
    snapshot cadence and should not be tied to the card source date.
  */
  SELECT ps.recorded_at INTO v_source_date
  FROM public.price_snapshots ps
  WHERE ps.card_id NOT LIKE 'sealed-%'
  GROUP BY ps.recorded_at
  HAVING count(DISTINCT ps.card_id) >= c_complete_floor
  ORDER BY ps.recorded_at DESC
  LIMIT 1;

  TRUNCATE TABLE public.latest_card_prices;

  IF v_source_date IS NOT NULL THEN
    INSERT INTO public.latest_card_prices
      (card_id, card_name, set_name, price, recorded_at, price_1d, price_7d, price_30d, updated_at)
    SELECT
      l.card_id, l.card_name, l.set_name, l.price, l.recorded_at,
      (SELECT ps.price FROM public.price_snapshots ps
         WHERE ps.card_id = l.card_id
           AND ps.recorded_at BETWEEN l.recorded_at - 3 AND l.recorded_at - 1
         ORDER BY abs(ps.recorded_at - (l.recorded_at - 1)) ASC
         LIMIT 1) AS price_1d,
      (SELECT ps.price FROM public.price_snapshots ps
         WHERE ps.card_id = l.card_id
           AND ps.recorded_at BETWEEN l.recorded_at - 11 AND l.recorded_at - 4
         ORDER BY abs(ps.recorded_at - (l.recorded_at - 7)) ASC
         LIMIT 1) AS price_7d,
      (SELECT ps.price FROM public.price_snapshots ps
         WHERE ps.card_id = l.card_id
           AND ps.recorded_at BETWEEN l.recorded_at - 45 AND l.recorded_at - 20
         ORDER BY abs(ps.recorded_at - (l.recorded_at - 30)) ASC
         LIMIT 1) AS price_30d,
      now()
    FROM public.price_snapshots l
    WHERE l.card_id NOT LIKE 'sealed-%'
      AND l.recorded_at = v_source_date;

    GET DIAGNOSTICS card_count = ROW_COUNT;
  END IF;

  INSERT INTO public.latest_card_prices
    (card_id, card_name, set_name, price, recorded_at, price_1d, price_7d, price_30d, updated_at)
  WITH latest_sealed AS (
    SELECT DISTINCT ON (card_id)
      card_id, card_name, set_name, price, recorded_at
    FROM public.price_snapshots
    WHERE card_id LIKE 'sealed-%'
    ORDER BY card_id, recorded_at DESC
  )
  SELECT
    l.card_id, l.card_name, l.set_name, l.price, l.recorded_at,
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at BETWEEN l.recorded_at - 3 AND l.recorded_at - 1
       ORDER BY abs(ps.recorded_at - (l.recorded_at - 1)) ASC
       LIMIT 1) AS price_1d,
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at BETWEEN l.recorded_at - 11 AND l.recorded_at - 4
       ORDER BY abs(ps.recorded_at - (l.recorded_at - 7)) ASC
       LIMIT 1) AS price_7d,
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at BETWEEN l.recorded_at - 45 AND l.recorded_at - 20
       ORDER BY abs(ps.recorded_at - (l.recorded_at - 30)) ASC
       LIMIT 1) AS price_30d,
    now()
  FROM latest_sealed l;

  GET DIAGNOSTICS sealed_count = ROW_COUNT;

  INSERT INTO public.latest_card_prices
    (card_id, card_name, set_name, price, recorded_at, price_1d, price_7d, price_30d, updated_at)
  SELECT
    o.card_id,
    COALESCE(NULLIF(o.card_name, ''), ''),
    COALESCE(NULLIF(o.set_name, ''), ''),
    o.price, CURRENT_DATE, o.price_1d, o.price_7d, o.price_30d, now()
  FROM public.card_price_overrides o
  ON CONFLICT (card_id) DO UPDATE SET
    card_name   = COALESCE(NULLIF(EXCLUDED.card_name, ''), latest_card_prices.card_name),
    set_name    = COALESCE(NULLIF(EXCLUDED.set_name, ''),  latest_card_prices.set_name),
    price       = EXCLUDED.price,
    price_1d    = EXCLUDED.price_1d,
    price_7d    = EXCLUDED.price_7d,
    price_30d   = EXCLUDED.price_30d,
    recorded_at = EXCLUDED.recorded_at,
    updated_at  = now();

  inserted_count := card_count + sealed_count;
  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_latest_card_prices() TO service_role;

CREATE OR REPLACE FUNCTION public.get_pipeline_completeness()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_coverage_pct_min    numeric := 90;
  c_delta_pct_min       numeric := 75;
  c_cache_age_hrs_max   numeric := 26;
  c_source_age_days_max int     := 1;
  c_live_catalog_min    int     := 17000;
  v_today               date := current_date;
  v_source_date         date;
  v_source_coverage     int := 0;
  v_catalog             int := 0;
  v_fresh_cache_rows    int := 0;
  v_delta_coverage      int := 0;
  v_cache_updated       timestamptz;
  v_coverage_pct        numeric := 0;
  v_delta_pct           numeric := 0;
  v_cache_age_hrs       numeric;
  v_source_age_days     int;
  v_failures            text[] := '{}';
  v_pass                boolean;
BEGIN
  SELECT ps.recorded_at, count(DISTINCT ps.card_id)::int
    INTO v_source_date, v_source_coverage
  FROM public.price_snapshots ps
  WHERE ps.card_id NOT LIKE 'sealed-%'
  GROUP BY ps.recorded_at
  HAVING count(DISTINCT ps.card_id) >= c_live_catalog_min
  ORDER BY ps.recorded_at DESC
  LIMIT 1;

  SELECT count(*)::int INTO v_catalog
    FROM public.latest_card_prices
    WHERE card_id NOT LIKE 'sealed-%';

  SELECT count(*)::int INTO v_fresh_cache_rows
    FROM public.latest_card_prices
    WHERE card_id NOT LIKE 'sealed-%'
      AND v_source_date IS NOT NULL
      AND recorded_at = v_source_date;

  SELECT count(*)::int INTO v_delta_coverage
    FROM public.latest_card_prices
    WHERE card_id NOT LIKE 'sealed-%'
      AND price_1d IS NOT NULL;

  SELECT max(updated_at) INTO v_cache_updated
    FROM public.latest_card_prices;

  v_source_age_days := CASE WHEN v_source_date IS NULL THEN NULL ELSE (v_today - v_source_date) END;
  v_coverage_pct := CASE WHEN v_catalog > 0 THEN round(100.0 * v_fresh_cache_rows / v_catalog, 1) ELSE 0 END;
  v_delta_pct := CASE WHEN v_catalog > 0 THEN round(100.0 * v_delta_coverage / v_catalog, 1) ELSE 0 END;
  v_cache_age_hrs := CASE WHEN v_cache_updated IS NOT NULL THEN round(extract(epoch FROM (now() - v_cache_updated)) / 3600, 1) END;

  IF v_source_date IS NULL THEN
    v_failures := array_append(v_failures, 'no_complete_snapshot');
  END IF;
  IF v_catalog < c_live_catalog_min THEN
    v_failures := array_append(v_failures, 'low_live_catalog');
  END IF;
  IF v_coverage_pct < c_coverage_pct_min THEN
    v_failures := array_append(v_failures, 'low_coverage');
  END IF;
  IF v_delta_pct < c_delta_pct_min THEN
    v_failures := array_append(v_failures, 'low_delta_coverage');
  END IF;
  IF v_source_age_days IS NULL OR v_source_age_days > c_source_age_days_max THEN
    v_failures := array_append(v_failures, 'source_stale');
  END IF;
  IF v_cache_updated IS NULL OR v_cache_age_hrs > c_cache_age_hrs_max THEN
    v_failures := array_append(v_failures, 'stale_cache');
  END IF;

  v_pass := array_length(v_failures, 1) IS NULL;

  RETURN jsonb_build_object(
    'pass',                 v_pass,
    'checked_at',           now(),
    'catalog',              v_catalog,
    'source_snapshot_date', v_source_date,
    'source_coverage',      v_source_coverage,
    'today_coverage',       (SELECT count(DISTINCT card_id)::int FROM public.price_snapshots WHERE recorded_at = v_today AND card_id NOT LIKE 'sealed-%'),
    'coverage_pct',         v_coverage_pct,
    'delta_coverage',       v_delta_coverage,
    'delta_pct',            v_delta_pct,
    'cache_updated_at',     v_cache_updated,
    'cache_age_hours',      v_cache_age_hrs,
    'cache_is_today',       v_cache_updated IS NOT NULL AND (v_cache_updated AT TIME ZONE 'UTC')::date = v_today,
    'source_age_days',      v_source_age_days,
    'failures',             to_jsonb(v_failures),
    'thresholds',           jsonb_build_object(
                              'coverage_pct_min',     c_coverage_pct_min,
                              'delta_pct_min',        c_delta_pct_min,
                              'cache_age_hours_max',  c_cache_age_hrs_max,
                              'source_age_days_max',  c_source_age_days_max,
                              'live_catalog_min',     c_live_catalog_min
                            )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pipeline_completeness() TO service_role, authenticated;

SELECT public.refresh_latest_card_prices();
NOTIFY pgrst, 'reload schema';