-- Returns the most recent snapshot per card_id, regardless of how old.
-- Replaces the 3-day client-side merge window that was making chase cards
-- (Special Illustration Rares, etc.) show N/A whenever Scrydex had a 3-day
-- gap in market prices. The data was always there — the old query just
-- wasn't asking for it.
--
-- Historical 1d/7d/30d prices are anchored to each card's own latest
-- snapshot (not "today"), so chase cards with sparse data still get
-- meaningful % change comparisons instead of NULLs.
--
-- Pagination via p_limit/p_offset because PostgREST caps un-paginated
-- responses (default 1000 rows) and we have ~23k cards.

CREATE OR REPLACE FUNCTION public.get_all_latest_prices(
  p_limit  INT DEFAULT 5000,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  card_id     TEXT,
  card_name   TEXT,
  set_name    TEXT,
  price       NUMERIC,
  recorded_at DATE,
  price_1d    NUMERIC,
  price_7d    NUMERIC,
  price_30d   NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (card_id)
      card_id, card_name, set_name, price, recorded_at
    FROM public.price_snapshots
    WHERE card_id NOT LIKE 'sealed-%'
    ORDER BY card_id, recorded_at DESC
  )
  SELECT
    l.card_id,
    l.card_name,
    l.set_name,
    l.price,
    l.recorded_at,
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at <= l.recorded_at - INTERVAL '1 day'
       ORDER BY ps.recorded_at DESC LIMIT 1) AS price_1d,
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at <= l.recorded_at - INTERVAL '7 days'
       ORDER BY ps.recorded_at DESC LIMIT 1) AS price_7d,
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at <= l.recorded_at - INTERVAL '30 days'
       ORDER BY ps.recorded_at DESC LIMIT 1) AS price_30d
  FROM latest l
  ORDER BY l.card_id
  OFFSET p_offset
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_latest_prices(INT, INT) TO anon, authenticated;
