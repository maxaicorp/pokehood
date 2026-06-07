CREATE OR REPLACE FUNCTION public.get_pipeline_completeness()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_coverage_pct_min       numeric := 90;
  c_delta_pct_min          numeric := 75;
  c_cache_age_hrs_max      numeric := 26;
  c_source_age_days_max    int     := 1;
  c_live_catalog_min       int     := 17000;
  c_sparse_card_carry_days int     := 45;
  v_today                  date := current_date;
  v_source_date            date;
  v_source_coverage        int := 0;
  v_catalog                int := 0;
  v_fresh_cache_rows       int := 0;
  v_delta_coverage         int := 0;
  v_cache_updated          timestamptz;
  v_coverage_pct           numeric := 0;
  v_delta_pct              numeric := 0;
  v_cache_age_hrs          numeric;
  v_source_age_days        int;
  v_failures               text[] := '{}';
  v_pass                   boolean;
BEGIN
  SELECT ps.recorded_at, count(DISTINCT ps.card_id)::int
    INTO v_source_date, v_source_coverage
  FROM public.price_snapshots ps
  WHERE ps.card_id NOT LIKE 'sealed-%'
    AND ps.price IS NOT NULL
    AND ps.price > 0
  GROUP BY ps.recorded_at
  HAVING count(DISTINCT ps.card_id) >= c_live_catalog_min
  ORDER BY ps.recorded_at DESC
  LIMIT 1;

  SELECT count(*)::int INTO v_catalog
    FROM public.latest_card_prices
    WHERE card_id NOT LIKE 'sealed-%'
      AND price IS NOT NULL
      AND price > 0;

  SELECT count(*)::int INTO v_fresh_cache_rows
    FROM public.latest_card_prices
    WHERE card_id NOT LIKE 'sealed-%'
      AND price IS NOT NULL
      AND price > 0
      AND v_source_date IS NOT NULL
      AND recorded_at BETWEEN v_source_date - c_sparse_card_carry_days AND v_source_date;

  SELECT count(*)::int INTO v_delta_coverage
    FROM public.latest_card_prices
    WHERE card_id NOT LIKE 'sealed-%'
      AND price IS NOT NULL
      AND price > 0
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
    'sparse_card_carry_days', c_sparse_card_carry_days,
    'failures',             to_jsonb(v_failures),
    'thresholds',           jsonb_build_object(
                              'coverage_pct_min',     c_coverage_pct_min,
                              'delta_pct_min',        c_delta_pct_min,
                              'cache_age_hours_max',  c_cache_age_hrs_max,
                              'source_age_days_max',  c_source_age_days_max,
                              'live_catalog_min',     c_live_catalog_min,
                              'sparse_card_carry_days', c_sparse_card_carry_days
                            )
  );
END;
$function$;