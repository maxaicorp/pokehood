-- get_graded_tiles_for_card: return ALL grades for PSA/BGS/CGC, not just 10 & 9.
-- The frontend redesign shows one card per company with a grade dropdown, so it
-- needs every grade we have — the old `grade IN (10,9)` filter hid data (a card
-- with only PSA 8 / BGS 9.5 looked empty). market>0 keeps out null-priced rows.
CREATE OR REPLACE FUNCTION public.get_graded_tiles_for_card(p_card_id TEXT)
RETURNS TABLE (
  company  TEXT,
  grade    NUMERIC,
  market   NUMERIC,
  low      NUMERIC,
  mid      NUMERIC,
  high     NUMERIC,
  currency TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT company, grade, market, low, mid, high, currency
  FROM public.latest_graded_prices
  WHERE card_id = p_card_id
    AND company IN ('PSA','BGS','CGC')
    AND market IS NOT NULL AND market > 0
  ORDER BY company, grade DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_graded_tiles_for_card(TEXT) TO anon, authenticated;
