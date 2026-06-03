-- Allow anonymous visitors to count as website traffic for public aggregate
-- stats such as Most Visited.
--
-- Keep direct table writes locked down. Anonymous users get EXECUTE on the
-- SECURITY DEFINER RPC only, and the function itself only accepts anonymous
-- increments for public browsing stats (view/search_hit). Auth-only product
-- actions such as collection_add and wishlist_add remain ignored for anon
-- callers, so the vanity counters cannot be inflated through those channels.

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
SET search_path = public
AS $$
BEGIN
  -- Unknown stat names are no-ops.
  IF p_stat NOT IN ('view', 'search_hit', 'collection_add', 'wishlist_add') THEN
    RETURN;
  END IF;

  -- Anonymous visitors are legitimate traffic, but not legitimate collection
  -- or wishlist actors. Those UI actions require auth anyway; this keeps the
  -- RPC contract aligned with the product surface.
  IF auth.role() = 'anon' AND p_stat NOT IN ('view', 'search_hit') THEN
    RETURN;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.increment_card_stat(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO anon, authenticated;
