-- Read RPC for the Market "Graded" tab. Returns graded slabs for a given
-- company + grade, value-sorted, optionally scoped to sets — the graded analogue
-- of get_latest_price_page. Reads the precomputed latest_graded_prices cache
-- (joined to latest_card_prices for name/set). No deltas yet (v2). Free SQL.

CREATE OR REPLACE FUNCTION public.get_graded_page(
  p_company   TEXT    DEFAULT 'PSA',
  p_grade     NUMERIC DEFAULT 10,
  p_set_ids   TEXT[]  DEFAULT NULL,   -- set-id prefixes (e.g. ARRAY['sv8pt5','me1']); NULL = all
  p_min_price NUMERIC DEFAULT 0,
  p_limit     INT     DEFAULT 100,
  p_offset    INT     DEFAULT 0
)
RETURNS TABLE (
  card_id TEXT, card_name TEXT, set_name TEXT,
  company TEXT, grade NUMERIC, market NUMERIC, low NUMERIC, high NUMERIC
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT g.card_id,
         COALESCE(c.name, lcp.card_name, g.card_id)               AS card_name,
         COALESCE(NULLIF(c.set_name, ''), lcp.set_name, '')        AS set_name,
         g.company, g.grade, g.market, g.low, g.high
  FROM public.latest_graded_prices g
  LEFT JOIN public.cards c               ON c.id = g.card_id           -- catalog (incl. vintage) for names
  LEFT JOIN public.latest_card_prices lcp ON lcp.card_id = g.card_id   -- raw cache fallback
  WHERE g.company = p_company
    AND g.grade   = p_grade
    AND g.market IS NOT NULL
    AND g.market >= COALESCE(p_min_price, 0)
    AND (p_set_ids IS NULL OR regexp_replace(g.card_id, '-[^-]+$', '') = ANY (p_set_ids))
  ORDER BY g.market DESC NULLS LAST, g.card_id
  OFFSET GREATEST(p_offset, 0)
  LIMIT  LEAST(GREATEST(p_limit, 1), 500);
$$;
GRANT EXECUTE ON FUNCTION public.get_graded_page(TEXT, NUMERIC, TEXT[], NUMERIC, INT, INT) TO anon, authenticated;

-- Which (company, grade) combos actually exist + how many cards each — powers
-- the tab's company/grade dropdowns so we only offer grades that have data.
CREATE OR REPLACE FUNCTION public.get_graded_filter_options()
RETURNS TABLE (company TEXT, grade NUMERIC, card_count BIGINT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT company, grade, count(*)::BIGINT
  FROM public.latest_graded_prices
  WHERE market IS NOT NULL AND market > 0
  GROUP BY company, grade
  ORDER BY company, grade DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_graded_filter_options() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
