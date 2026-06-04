-- Artist support for the Explore "filter by artist" feature.
-- Adds the column the sync will populate + a distinct-artists list for the
-- filter dropdown. (sync-cards-catalog must be redeployed with artist capture
-- and re-run to fill this — until then artist is null and the filter is empty.)

ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS artist text;
CREATE INDEX IF NOT EXISTS idx_cards_artist ON public.cards (artist);

-- Surface artist through the bulk catalog read (loadCatalogFromDb). Return-type
-- change → must DROP before re-CREATE.
DROP FUNCTION IF EXISTS public.get_card_catalog(int, int);
CREATE OR REPLACE FUNCTION public.get_card_catalog(p_limit int DEFAULT 1000, p_offset int DEFAULT 0)
RETURNS TABLE (
  id text, name text, set_id text, set_name text, number text,
  rarity text, supertype text, series text, artist text
)
LANGUAGE sql STABLE
AS $$
  SELECT id, name, set_id, set_name, number, rarity, supertype, series, artist
  FROM public.cards
  WHERE language = 'EN'
  ORDER BY id
  OFFSET p_offset
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_card_catalog(int, int) TO anon, authenticated;

-- Distinct artists (with how many cards each) for the Explore filter dropdown.
CREATE OR REPLACE FUNCTION public.get_card_artists()
RETURNS TABLE (artist text, card_count bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT artist, count(*)::bigint
  FROM public.cards
  WHERE artist IS NOT NULL AND artist <> ''
  GROUP BY artist
  ORDER BY artist;
$$;

GRANT EXECUTE ON FUNCTION public.get_card_artists() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
