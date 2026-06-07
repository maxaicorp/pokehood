-- Set-aware refresh: rebuild latest_card_prices from each card's OWN latest
-- snapshot within a 45-day window — NOT from a single "complete" source date.
--
-- WHY: the old logic picked v_source_date = the most recent date having >=17,000
-- distinct cards, then surfaced prices only up to that date. Two failure modes:
--   1. A partial fill (e.g. a per-set/batch crawl, or a manual ~10k backfill)
--      never reaches 17k for "today", so today's fresh prices NEVER surface —
--      the cache stays anchored to yesterday. (This silently hid backfills.)
--   2. If NO date ever hits 17k, v_source_date is NULL → TRUNCATE leaves the
--      card cache empty.
-- Switching to latest-per-card (DISTINCT ON card_id, newest within 45 days)
-- fixes both: a card updated today wins immediately; cards not updated today
-- keep their most recent prior price; nothing is gated on whole-catalog
-- completeness. This is the refresh the set-batch pipeline requires.
--
-- Deltas are still computed around each row's true recorded_at, so 1d/7d/30d
-- movement stays accurate. Sealed + manual overrides are unchanged.

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

  -- Cards: each card's latest snapshot within the recency window. No source-date
  -- floor — today's freshly-written sets surface the moment they land.
  INSERT INTO public.latest_card_prices
    (card_id, card_name, set_name, price, recorded_at, price_1d, price_7d, price_30d, updated_at)
  WITH latest_cards AS (
    SELECT DISTINCT ON (ps.card_id)
      ps.card_id, ps.card_name, ps.set_name, ps.price, ps.recorded_at
    FROM public.price_snapshots ps
    WHERE ps.card_id NOT LIKE 'sealed-%'
      AND ps.price IS NOT NULL
      AND ps.price > 0
      AND ps.recorded_at >= CURRENT_DATE - c_carry_days
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

  -- Sealed: latest per product (independent cadence).
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
