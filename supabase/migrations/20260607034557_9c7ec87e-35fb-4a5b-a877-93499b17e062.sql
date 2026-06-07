CREATE OR REPLACE FUNCTION public.refresh_latest_card_prices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  inserted_count INT := 0;
  card_count INT := 0;
  sealed_count INT := 0;
  v_source_date DATE;
  c_complete_floor INT := 17000;
  c_sparse_card_carry_days INT := 45;
BEGIN
  /*
    Rebuild the read cache from the latest complete card snapshot window, plus
    recent sparse-priced cards whose latest Scrydex snapshot did not land on
    that complete-window date.

    Some chase cards/variants are not emitted in every daily snapshot. Anchoring
    strictly to v_source_date made valid recent snapshot prices disappear from
    latest_card_prices and therefore from the frontend. Selecting each card's
    latest snapshot within a bounded recency window preserves those prices while
    avoiding the old bug where ancient fallback-era rows were carried forever.

    Cards: latest snapshot per card between (v_source_date - 45 days) and
    v_source_date. Each row keeps its true recorded_at date so deltas are
    calculated around the actual source snapshot.

    Sealed: keep latest per sealed product independently; sealed has its own
    snapshot cadence and should not be tied to the card source date.
  */
  SELECT ps.recorded_at INTO v_source_date
  FROM public.price_snapshots ps
  WHERE ps.card_id NOT LIKE 'sealed-%'
    AND ps.price IS NOT NULL
    AND ps.price > 0
  GROUP BY ps.recorded_at
  HAVING count(DISTINCT ps.card_id) >= c_complete_floor
  ORDER BY ps.recorded_at DESC
  LIMIT 1;

  TRUNCATE TABLE public.latest_card_prices;

  IF v_source_date IS NOT NULL THEN
    INSERT INTO public.latest_card_prices
      (card_id, card_name, set_name, price, recorded_at, price_1d, price_7d, price_30d, updated_at)
    WITH latest_cards AS (
      SELECT DISTINCT ON (ps.card_id)
        ps.card_id, ps.card_name, ps.set_name, ps.price, ps.recorded_at
      FROM public.price_snapshots ps
      WHERE ps.card_id NOT LIKE 'sealed-%'
        AND ps.price IS NOT NULL
        AND ps.price > 0
        AND ps.recorded_at BETWEEN v_source_date - c_sparse_card_carry_days AND v_source_date
      ORDER BY ps.card_id, ps.recorded_at DESC
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
    FROM latest_cards l;

    GET DIAGNOSTICS card_count = ROW_COUNT;
  END IF;

  INSERT INTO public.latest_card_prices
    (card_id, card_name, set_name, price, recorded_at, price_1d, price_7d, price_30d, updated_at)
  WITH latest_sealed AS (
    SELECT DISTINCT ON (card_id)
      card_id, card_name, set_name, price, recorded_at
    FROM public.price_snapshots
    WHERE card_id LIKE 'sealed-%'
      AND price IS NOT NULL
      AND price > 0
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
$function$;