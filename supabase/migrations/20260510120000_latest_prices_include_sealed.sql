-- Restore sealed rows to get_all_latest_prices.
--
-- The original `get_all_latest_prices` excluded sealed-% rows so the Market
-- Top tab would not show sealed products mixed with cards. But sealed-store
-- also calls this RPC to populate the sealed-price map (it filters sealed-*
-- rows IN at the call site). Excluding them in the SQL broke the sealed
-- Trending/% change columns.
--
-- Fix: return everything from the RPC. The client filters sealed rows out
-- where they need to be (Market Top list), and keeps them where they don't
-- (sealed-store, Explore hydration).

CREATE OR REPLACE FUNCTION public.get_all_latest_prices(
  p_limit  INT DEFAULT 1000,
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

-- Refresh PostgREST's schema cache so the new function body is picked up.
NOTIFY pgrst, 'reload schema';
