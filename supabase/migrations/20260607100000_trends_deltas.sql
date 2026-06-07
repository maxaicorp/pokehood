-- Deltas from Scrydex trends, not from diffing our own history.
--
-- Scrydex already ships price movement per window (trends.days_1/7/30,
-- price_change = current - prior). The crawl now writes each card's
-- trends-derived PRIOR prices onto its snapshot row (price_1d/7d/30d), and this
-- refresh just copies the latest row's values into the cache. That removes the
-- old dependency on accumulating many clean daily snapshots before deltas
-- populated (the reason Market showed "—" for 24h/7d/30d on fresh data).
--
-- Snapshots still exist — for the deep multi-month chart — but they are no
-- longer the SOURCE of the 1d/7d/30d deltas. Cards block changes; sealed keeps
-- its own lookback (sealed snapshots carry no trends), overrides unchanged.

ALTER TABLE public.price_snapshots
  ADD COLUMN IF NOT EXISTS price_1d  NUMERIC,
  ADD COLUMN IF NOT EXISTS price_7d  NUMERIC,
  ADD COLUMN IF NOT EXISTS price_30d NUMERIC;

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
  c_carry_days INT := 45;   -- a card not snapshotted within this window drops out (genuinely stale)
BEGIN
  TRUNCATE TABLE public.latest_card_prices;

  -- Cards: each card's latest snapshot within the window, deltas taken straight
  -- from the trends-derived columns on that same row. No source-date floor, no
  -- lookback subqueries — today's freshly-crawled sets surface immediately with
  -- correct movement.
  INSERT INTO public.latest_card_prices
    (card_id, card_name, set_name, price, recorded_at, price_1d, price_7d, price_30d, updated_at)
  SELECT DISTINCT ON (ps.card_id)
    ps.card_id, ps.card_name, ps.set_name, ps.price, ps.recorded_at,
    ps.price_1d, ps.price_7d, ps.price_30d, now()
  FROM public.price_snapshots ps
  WHERE ps.card_id NOT LIKE 'sealed-%'
    AND ps.price IS NOT NULL
    AND ps.price > 0
    AND ps.recorded_at >= CURRENT_DATE - c_carry_days
  ORDER BY ps.card_id, ps.recorded_at DESC;

  GET DIAGNOSTICS card_count = ROW_COUNT;

  -- Sealed: latest per product, deltas via lookback (sealed has no trends and
  -- its own snapshot cadence).
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

  -- Manual overrides win (durable pins; survive every refresh).
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
