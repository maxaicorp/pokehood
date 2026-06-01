-- refresh_latest_card_prices — BOUNDED delta windows.
--
-- Bug: price_1d/7d/30d used "most recent snapshot <= latest - N days" with NO
-- lower bound. On gappy history the nearest such snapshot could be far older
-- than N days, so a "7d" change was really a 20-30d change (inflated %). Fix:
-- restrict each lookup to a tolerance band around the target age and pick the
-- snapshot NEAREST the target; if none exists in the band, the delta is NULL
-- (honest blank, not a wrong number). As the chunked daily snapshots fill in,
-- the bands populate and 7d/30d become accurate.
CREATE OR REPLACE FUNCTION public.refresh_latest_card_prices()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INT;
BEGIN
  TRUNCATE public.latest_card_prices;

  INSERT INTO public.latest_card_prices
    (card_id, card_name, set_name, price, recorded_at, price_1d, price_7d, price_30d, updated_at)
  WITH latest AS (
    SELECT DISTINCT ON (card_id)
      card_id, card_name, set_name, price, recorded_at
    FROM public.price_snapshots
    ORDER BY card_id, recorded_at DESC
  )
  SELECT
    l.card_id, l.card_name, l.set_name, l.price, l.recorded_at,
    -- 1d: a snapshot ~1 day before the latest (tolerate 1-3 days back)
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at BETWEEN l.recorded_at - 3 AND l.recorded_at - 1
       ORDER BY abs(ps.recorded_at - (l.recorded_at - 1)) ASC
       LIMIT 1)  AS price_1d,
    -- 7d: nearest snapshot to 7 days ago, within a 4-11 day band
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at BETWEEN l.recorded_at - 11 AND l.recorded_at - 4
       ORDER BY abs(ps.recorded_at - (l.recorded_at - 7)) ASC
       LIMIT 1)  AS price_7d,
    -- 30d: nearest snapshot to 30 days ago, within a 20-45 day band
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at BETWEEN l.recorded_at - 45 AND l.recorded_at - 20
       ORDER BY abs(ps.recorded_at - (l.recorded_at - 30)) ASC
       LIMIT 1)  AS price_30d,
    NOW()
  FROM latest l;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_latest_card_prices() TO service_role;

-- Apply immediately:
-- SELECT public.refresh_latest_card_prices();
