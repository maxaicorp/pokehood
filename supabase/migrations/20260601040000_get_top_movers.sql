-- get_top_movers — server-side ranking of the FULL catalog by % price move,
-- for the merged "Movers" tab (replaces the old client-side sort over only the
-- top-~1000-by-price subset, which missed lower-priced cards that mooned).
--
-- Ranks by absolute % change over the chosen window (both directions), with a
-- price floor (default $2) to cut bulk noise. Reads flat from latest_card_prices
-- (which already holds price_1d/7d/30d), so it stays within the read contract.
-- Set filter predicate mirrors get_latest_price_page exactly.
CREATE OR REPLACE FUNCTION public.get_top_movers(
  p_window    TEXT      DEFAULT '24h',   -- '24h' | '7d' | '30d'
  p_min_price NUMERIC   DEFAULT 2,
  p_set_ids   TEXT[]    DEFAULT NULL,
  p_limit     INT       DEFAULT 250
)
RETURNS TABLE (
  card_id   TEXT,
  card_name TEXT,
  set_name  TEXT,
  price     NUMERIC,
  price_1d  NUMERIC,
  price_7d  NUMERIC,
  price_30d NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT lcp.card_id, lcp.card_name, lcp.set_name, lcp.price,
         lcp.price_1d, lcp.price_7d, lcp.price_30d
  FROM public.latest_card_prices lcp
  WHERE lcp.card_id NOT LIKE 'sealed-%'
    AND lcp.price >= p_min_price
    AND (
      p_set_ids IS NULL
      OR array_length(p_set_ids, 1) IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(p_set_ids) AS sid(set_id)
        WHERE lcp.card_id LIKE (split_part(sid.set_id, '::', 1) || '-%')
      )
    )
    -- prior-window price must exist and be positive (NULL > 0 is NULL → excluded)
    AND (CASE p_window WHEN '7d' THEN lcp.price_7d WHEN '30d' THEN lcp.price_30d ELSE lcp.price_1d END) > 0
  ORDER BY abs(
      (lcp.price - (CASE p_window WHEN '7d' THEN lcp.price_7d WHEN '30d' THEN lcp.price_30d ELSE lcp.price_1d END))
      / (CASE p_window WHEN '7d' THEN lcp.price_7d WHEN '30d' THEN lcp.price_30d ELSE lcp.price_1d END)
    ) DESC NULLS LAST
  LIMIT LEAST(GREATEST(p_limit, 1), 1000);
$$;

GRANT EXECUTE ON FUNCTION public.get_top_movers(TEXT, NUMERIC, TEXT[], INT) TO anon, authenticated;
