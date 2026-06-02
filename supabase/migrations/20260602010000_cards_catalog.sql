-- cards catalog table — the live, self-updating card metadata source that
-- REPLACES the frozen static public/data/all-cards.json.
--
-- The recurring "set X is missing its chase cards" bug (me4 Chaos Rising had
-- 122 cards but our index stopped at 100) happens because all-cards.json is
-- built once and has no way to pick up cards Scrydex adds to a set later.
-- sync-cards-catalog (already written) pulls the FULL current Scrydex catalog
-- into this table weekly; loadCardIndex reads it (falling back to the static
-- JSON if it's empty). Once populated, new cards in any set appear with no
-- code change, no rebuild, no commit.
--
-- Schema mirrors exactly what sync-cards-catalog upserts (onConflict: id).
CREATE TABLE IF NOT EXISTS public.cards (
  id          text PRIMARY KEY,
  name        text NOT NULL DEFAULT '',
  set_id      text NOT NULL,
  set_name    text NOT NULL DEFAULT '',
  number      text NOT NULL DEFAULT '',
  rarity      text,
  supertype   text,
  subtypes    jsonb,
  types       jsonb,
  hp          text,
  series      text,
  language    text NOT NULL DEFAULT 'EN',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cards_set_id_idx ON public.cards (set_id);

-- Public read-only catalog data (same trust level as the static JSON it
-- replaces). Writes are service-role only (sync-cards-catalog).
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cards public read" ON public.cards;
CREATE POLICY "cards public read" ON public.cards FOR SELECT USING (true);
GRANT SELECT ON public.cards TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cards TO service_role;

-- Paginated bulk read for loadCardIndex (PostgREST caps direct selects at 1000
-- rows; the frontend pages through this with p_limit/p_offset the same way the
-- price cache does). Ordered by id for a stable page sequence.
CREATE OR REPLACE FUNCTION public.get_card_catalog(p_limit int DEFAULT 1000, p_offset int DEFAULT 0)
RETURNS TABLE (
  id text, name text, set_id text, set_name text, number text,
  rarity text, supertype text, series text
)
LANGUAGE sql STABLE
AS $$
  SELECT id, name, set_id, set_name, number, rarity, supertype, series
  FROM public.cards
  WHERE language = 'EN'
  ORDER BY id
  OFFSET p_offset
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_card_catalog(int, int) TO anon, authenticated;

-- Catalog-vs-prices coverage guard — the robustness check that would have
-- caught me4: for each set, how many cards are in the catalog vs how many have
-- prices. A big gap = chase cards missing from the price pipeline. Surfaced on
-- the admin health board (once the catalog table is populated).
CREATE OR REPLACE FUNCTION public.get_catalog_coverage(p_min_gap int DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_catalog_total int;
  v_gaps jsonb;
BEGIN
  SELECT count(*) INTO v_catalog_total FROM public.cards WHERE language = 'EN';

  -- If the catalog table isn't populated yet, this check can't run meaningfully.
  IF v_catalog_total < 1000 THEN
    RETURN jsonb_build_object('pass', true, 'catalog_total', v_catalog_total,
      'note', 'catalog table not populated yet — using static index; coverage check inactive');
  END IF;

  WITH catalog AS (
    SELECT set_id, count(*) AS catalog_cards
    FROM public.cards WHERE language = 'EN' GROUP BY set_id
  ),
  priced AS (
    SELECT split_part(card_id, '-', 1) AS prefix,  -- not used; see below
           regexp_replace(split_part(card_id, '::', 1), '-[^-]+$', '') AS set_id,
           count(DISTINCT split_part(card_id, '::', 1)) AS priced_cards
    FROM public.price_snapshots
    WHERE card_id NOT LIKE 'sealed-%'
    GROUP BY 2
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'set_id', c.set_id, 'catalog', c.catalog_cards,
           'priced', coalesce(p.priced_cards, 0),
           'missing', c.catalog_cards - coalesce(p.priced_cards, 0)
         ) ORDER BY (c.catalog_cards - coalesce(p.priced_cards, 0)) DESC), '[]'::jsonb)
    INTO v_gaps
  FROM catalog c
  LEFT JOIN priced p ON p.set_id = c.set_id
  WHERE c.catalog_cards - coalesce(p.priced_cards, 0) >= p_min_gap;

  RETURN jsonb_build_object(
    'pass', v_gaps = '[]'::jsonb,
    'catalog_total', v_catalog_total,
    'sets_with_gaps', jsonb_array_length(v_gaps),
    'gaps', v_gaps
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_catalog_coverage(int) TO service_role, authenticated;

-- Try it (after sync-cards-catalog has run):
--   SELECT public.get_catalog_coverage();
