CREATE TABLE public.card_stats (
  tcg_api_id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  set_name text NOT NULL DEFAULT '',
  image_small text NOT NULL DEFAULT '',
  view_count integer NOT NULL DEFAULT 0,
  search_hit_count integer NOT NULL DEFAULT 0,
  collection_add_count integer NOT NULL DEFAULT 0,
  wishlist_add_count integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.card_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Card stats are publicly readable"
  ON public.card_stats FOR SELECT TO public USING (true);

CREATE POLICY "Anyone can upsert card stats"
  ON public.card_stats FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Anyone can update card stats"
  ON public.card_stats FOR UPDATE TO public USING (true);

CREATE OR REPLACE FUNCTION public.increment_card_stat(
  p_tcg_api_id text,
  p_name text,
  p_set_name text,
  p_image_small text,
  p_stat text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.card_stats (tcg_api_id, name, set_name, image_small, view_count, search_hit_count, collection_add_count, wishlist_add_count)
  VALUES (
    p_tcg_api_id, p_name, p_set_name, p_image_small,
    CASE WHEN p_stat = 'view' THEN 1 ELSE 0 END,
    CASE WHEN p_stat = 'search_hit' THEN 1 ELSE 0 END,
    CASE WHEN p_stat = 'collection_add' THEN 1 ELSE 0 END,
    CASE WHEN p_stat = 'wishlist_add' THEN 1 ELSE 0 END
  )
  ON CONFLICT (tcg_api_id) DO UPDATE SET
    name = EXCLUDED.name,
    set_name = EXCLUDED.set_name,
    image_small = CASE WHEN EXCLUDED.image_small != '' THEN EXCLUDED.image_small ELSE card_stats.image_small END,
    view_count = card_stats.view_count + CASE WHEN p_stat = 'view' THEN 1 ELSE 0 END,
    search_hit_count = card_stats.search_hit_count + CASE WHEN p_stat = 'search_hit' THEN 1 ELSE 0 END,
    collection_add_count = card_stats.collection_add_count + CASE WHEN p_stat = 'collection_add' THEN 1 ELSE 0 END,
    wishlist_add_count = card_stats.wishlist_add_count + CASE WHEN p_stat = 'wishlist_add' THEN 1 ELSE 0 END,
    updated_at = now();
END;
$$;