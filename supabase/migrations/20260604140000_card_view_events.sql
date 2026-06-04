-- Per-view event log so Most Visited can window by 24h / 7d / 30d.
--
-- card_stats holds a CUMULATIVE counter (all-time) — it can't be windowed.
-- This adds an append-only event row per card view, plus a windowed read RPC.
-- increment_card_stat is extended to log an event on each 'view' (same single
-- RPC call the frontend already makes — no client change to recording).
--
-- NOTE: windows only contain data from when this ships forward; "All time" still
-- uses the cumulative card_stats counter. Old events can be pruned (>90d) later.

CREATE TABLE IF NOT EXISTS public.card_view_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tcg_api_id  TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  set_name    TEXT NOT NULL DEFAULT '',
  image_small TEXT NOT NULL DEFAULT '',
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cve_viewed ON public.card_view_events (viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cve_card_viewed ON public.card_view_events (tcg_api_id, viewed_at DESC);

ALTER TABLE public.card_view_events ENABLE ROW LEVEL SECURITY;
-- Writes happen only inside the SECURITY DEFINER increment_card_stat; reads only
-- via the SECURITY DEFINER RPC below. No direct client policies needed.

-- ─── Extend the counter RPC to also log a view event ──────────────────────────
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
  IF p_stat NOT IN ('view', 'search_hit', 'collection_add', 'wishlist_add') THEN
    RETURN;
  END IF;
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

  -- Append a windowable event for views (skip the health-check sentinel).
  IF p_stat = 'view' AND p_tcg_api_id <> '__health_check__' THEN
    INSERT INTO public.card_view_events (tcg_api_id, name, set_name, image_small)
    VALUES (p_tcg_api_id, p_name, p_set_name, p_image_small);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_card_stat(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO anon, authenticated;

-- ─── Windowed Most-Visited read ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_most_viewed_windowed(
  p_window TEXT DEFAULT '7d',
  p_limit  INT  DEFAULT 100
)
RETURNS TABLE (tcg_api_id TEXT, name TEXT, set_name TEXT, image_small TEXT, view_count BIGINT)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tcg_api_id, max(name), max(set_name), max(image_small), count(*)::BIGINT
  FROM public.card_view_events
  WHERE tcg_api_id <> '__health_check__'
    AND viewed_at >= now() - (CASE p_window
        WHEN '24h' THEN INTERVAL '1 day'
        WHEN '30d' THEN INTERVAL '30 days'
        ELSE INTERVAL '7 days' END)
  GROUP BY tcg_api_id
  ORDER BY count(*) DESC, max(name) ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$;

GRANT EXECUTE ON FUNCTION public.get_most_viewed_windowed(TEXT, INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
