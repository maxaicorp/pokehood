-- Card stats: internal counters for views, searches, collection adds, wishlist adds
-- Used to power future features like "most viewed", "trending", "most searched", etc.

CREATE TABLE IF NOT EXISTS public.card_stats (
  tcg_api_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  set_name TEXT NOT NULL DEFAULT '',
  image_small TEXT NOT NULL DEFAULT '',
  view_count BIGINT NOT NULL DEFAULT 0,
  search_hit_count BIGINT NOT NULL DEFAULT 0,
  collection_add_count BIGINT NOT NULL DEFAULT 0,
  wishlist_add_count BIGINT NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  last_searched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.card_stats ENABLE ROW LEVEL SECURITY;

-- Anyone can insert/update stats (anonymous + authed), but read is open too
-- since this is aggregate data with no user-specific info
CREATE POLICY "Anyone can read card stats"
  ON public.card_stats FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can upsert card stats"
  ON public.card_stats FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update card stats"
  ON public.card_stats FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Indexes for common queries (most viewed, most searched, trending)
CREATE INDEX idx_card_stats_view_count ON public.card_stats (view_count DESC);
CREATE INDEX idx_card_stats_search_hit_count ON public.card_stats (search_hit_count DESC);
CREATE INDEX idx_card_stats_collection_add_count ON public.card_stats (collection_add_count DESC);
CREATE INDEX idx_card_stats_last_viewed ON public.card_stats (last_viewed_at DESC);

-- RPC to atomically increment a stat counter (avoids race conditions)
CREATE OR REPLACE FUNCTION public.increment_card_stat(
  p_tcg_api_id TEXT,
  p_name TEXT,
  p_set_name TEXT,
  p_image_small TEXT,
  p_stat TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.card_stats (tcg_api_id, name, set_name, image_small,
    view_count, search_hit_count, collection_add_count, wishlist_add_count,
    last_viewed_at, last_searched_at)
  VALUES (
    p_tcg_api_id, p_name, p_set_name, p_image_small,
    CASE WHEN p_stat = 'view' THEN 1 ELSE 0 END,
    CASE WHEN p_stat = 'search_hit' THEN 1 ELSE 0 END,
    CASE WHEN p_stat = 'collection_add' THEN 1 ELSE 0 END,
    CASE WHEN p_stat = 'wishlist_add' THEN 1 ELSE 0 END,
    CASE WHEN p_stat = 'view' THEN now() ELSE NULL END,
    CASE WHEN p_stat = 'search_hit' THEN now() ELSE NULL END
  )
  ON CONFLICT (tcg_api_id) DO UPDATE SET
    name = EXCLUDED.name,
    set_name = EXCLUDED.set_name,
    image_small = COALESCE(NULLIF(EXCLUDED.image_small, ''), card_stats.image_small),
    view_count = card_stats.view_count + CASE WHEN p_stat = 'view' THEN 1 ELSE 0 END,
    search_hit_count = card_stats.search_hit_count + CASE WHEN p_stat = 'search_hit' THEN 1 ELSE 0 END,
    collection_add_count = card_stats.collection_add_count + CASE WHEN p_stat = 'collection_add' THEN 1 ELSE 0 END,
    wishlist_add_count = card_stats.wishlist_add_count + CASE WHEN p_stat = 'wishlist_add' THEN 1 ELSE 0 END,
    last_viewed_at = CASE WHEN p_stat = 'view' THEN now() ELSE card_stats.last_viewed_at END,
    last_searched_at = CASE WHEN p_stat = 'search_hit' THEN now() ELSE card_stats.last_searched_at END,
    updated_at = now();
END;
$$;
