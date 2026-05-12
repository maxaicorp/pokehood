CREATE OR REPLACE FUNCTION public.get_latest_price_page(
  p_limit INT DEFAULT 10,
  p_offset INT DEFAULT 0,
  p_set_ids TEXT[] DEFAULT NULL,
  p_sort_dir TEXT DEFAULT 'desc',
  p_include_sealed BOOLEAN DEFAULT false
)
RETURNS TABLE (
  card_id     TEXT,
  card_name   TEXT,
  set_name    TEXT,
  price       NUMERIC,
  recorded_at DATE,
  price_1d    NUMERIC,
  price_7d    NUMERIC,
  price_30d   NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH latest AS MATERIALIZED (
    SELECT DISTINCT ON (ps.card_id)
      ps.card_id,
      ps.card_name,
      ps.set_name,
      ps.price,
      ps.recorded_at
    FROM public.price_snapshots ps
    WHERE (p_include_sealed OR ps.card_id NOT LIKE 'sealed-%')
      AND (
        p_set_ids IS NULL
        OR array_length(p_set_ids, 1) IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(p_set_ids) AS sid(set_id)
          WHERE ps.card_id LIKE (split_part(sid.set_id, '::', 1) || '-%')
        )
      )
    ORDER BY ps.card_id, ps.recorded_at DESC
  ), page_rows AS MATERIALIZED (
    SELECT *
    FROM latest
    ORDER BY
      CASE WHEN lower(p_sort_dir) = 'asc' THEN price END ASC NULLS LAST,
      CASE WHEN lower(p_sort_dir) <> 'asc' THEN price END DESC NULLS LAST,
      card_id ASC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  )
  SELECT
    l.card_id,
    l.card_name,
    l.set_name,
    l.price,
    l.recorded_at,
    p1.price AS price_1d,
    p7.price AS price_7d,
    p30.price AS price_30d
  FROM page_rows l
  LEFT JOIN LATERAL (
    SELECT ps.price
    FROM public.price_snapshots ps
    WHERE ps.card_id = l.card_id
      AND ps.recorded_at <= l.recorded_at - INTERVAL '1 day'
    ORDER BY ps.recorded_at DESC
    LIMIT 1
  ) p1 ON true
  LEFT JOIN LATERAL (
    SELECT ps.price
    FROM public.price_snapshots ps
    WHERE ps.card_id = l.card_id
      AND ps.recorded_at <= l.recorded_at - INTERVAL '7 days'
    ORDER BY ps.recorded_at DESC
    LIMIT 1
  ) p7 ON true
  LEFT JOIN LATERAL (
    SELECT ps.price
    FROM public.price_snapshots ps
    WHERE ps.card_id = l.card_id
      AND ps.recorded_at <= l.recorded_at - INTERVAL '30 days'
    ORDER BY ps.recorded_at DESC
    LIMIT 1
  ) p30 ON true
  ORDER BY
    CASE WHEN lower(p_sort_dir) = 'asc' THEN l.price END ASC NULLS LAST,
    CASE WHEN lower(p_sort_dir) <> 'asc' THEN l.price END DESC NULLS LAST,
    l.card_id ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_price_page(INT, INT, TEXT[], TEXT, BOOLEAN) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';