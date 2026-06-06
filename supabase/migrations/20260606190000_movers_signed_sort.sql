-- Movers: rank by SIGNED % move DESC (biggest gainers → losers) instead of
-- absolute magnitude, so the default view reads cleanly high→low %. Only the
-- ORDER BY changed vs 20260601040000 (abs(...) → signed).

CREATE OR REPLACE FUNCTION public.get_top_movers(
  p_window    TEXT      DEFAULT '24h',
  p_min_price NUMERIC   DEFAULT 2,
  p_set_ids   TEXT[]    DEFAULT NULL,
  p_limit     INT       DEFAULT 250
)
RETURNS TABLE (
  card_id   TEXT, card_name TEXT, set_name TEXT, price NUMERIC,
  price_1d  NUMERIC, price_7d NUMERIC, price_30d NUMERIC
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
    AND (CASE p_window WHEN '7d' THEN lcp.price_7d WHEN '30d' THEN lcp.price_30d ELSE lcp.price_1d END) > 0
  ORDER BY (
      (lcp.price - (CASE p_window WHEN '7d' THEN lcp.price_7d WHEN '30d' THEN lcp.price_30d ELSE lcp.price_1d END))
      / (CASE p_window WHEN '7d' THEN lcp.price_7d WHEN '30d' THEN lcp.price_30d ELSE lcp.price_1d END)
    ) DESC NULLS LAST
  LIMIT LEAST(GREATEST(p_limit, 1), 1000);
$$;

GRANT EXECUTE ON FUNCTION public.get_top_movers(TEXT, NUMERIC, TEXT[], INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
