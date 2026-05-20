-- get_filter_summary — total value + count for a Market filter, computed
-- in one round-trip against the precomputed latest_card_prices table.
--
-- Problem: the "Top N Value" badge in the Market header sums prices client-side
-- from cards-in-state. With infinite scroll, cards trickle in 25 at a time, so
-- the total ratchets upward as the user scrolls. That makes the number
-- meaningless ("Top 30 Value" when 30 of 500 cards are loaded) and confusing.
--
-- Fix: compute the true total server-side from the full filtered+capped set,
-- not from whatever happens to be in the React state at the moment.

CREATE OR REPLACE FUNCTION public.get_filter_summary(
  p_set_ids TEXT[] DEFAULT NULL,
  p_top_n   INT    DEFAULT 500
)
RETURNS TABLE (
  card_count   INT,
  total_value  NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH eligible AS (
    SELECT lcp.price
    FROM public.latest_card_prices lcp
    WHERE lcp.card_id NOT LIKE 'sealed-%'
      AND (
        p_set_ids IS NULL
        OR array_length(p_set_ids, 1) IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(p_set_ids) AS sid(set_id)
          WHERE lcp.card_id LIKE (split_part(sid.set_id, '::', 1) || '-%')
        )
      )
    ORDER BY lcp.price DESC NULLS LAST
    LIMIT LEAST(GREATEST(p_top_n, 1), 5000)
  )
  SELECT
    COUNT(*)::INT       AS card_count,
    COALESCE(SUM(price), 0)::NUMERIC AS total_value
  FROM eligible;
$$;

GRANT EXECUTE ON FUNCTION public.get_filter_summary(TEXT[], INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
