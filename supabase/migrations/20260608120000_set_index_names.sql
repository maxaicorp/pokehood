-- Set-index overview with human-readable set names.
--
-- Keep the original get_set_index_overview() RPC intact because the existing
-- marketing function calls it. This companion RPC adds set_name for the heatmap
-- UI and lets the frontend fall back to the old RPC until this migration lands.

CREATE OR REPLACE FUNCTION public.get_set_index_overview_with_names()
RETURNS TABLE (
  set_id TEXT,
  set_name TEXT,
  total_value NUMERIC,
  card_count INT,
  pct_1d NUMERIC,
  pct_7d NUMERIC,
  pct_30d NUMERIC,
  sparkline JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH agg AS (
    SELECT
      regexp_replace(split_part(card_id, '::', 1), '-[^-]+$', '') AS sid,
      max(set_name)                                          AS sname,
      sum(price)                                             AS total,
      count(*)::int                                          AS cnt,
      sum(price_1d)  FILTER (WHERE price_1d  IS NOT NULL)    AS p1,
      sum(price)     FILTER (WHERE price_1d  IS NOT NULL)    AS c1,
      sum(price_7d)  FILTER (WHERE price_7d  IS NOT NULL)    AS p7,
      sum(price)     FILTER (WHERE price_7d  IS NOT NULL)    AS c7,
      sum(price_30d) FILTER (WHERE price_30d IS NOT NULL)    AS p30,
      sum(price)     FILTER (WHERE price_30d IS NOT NULL)    AS c30
    FROM public.latest_card_prices
    WHERE card_id NOT LIKE 'sealed-%' AND price > 0
    GROUP BY 1
  ),
  spark AS (
    SELECT
      set_id AS sid,
      jsonb_agg(jsonb_build_object('date', recorded_at, 'value', total_value) ORDER BY recorded_at) AS pts
    FROM public.set_index_snapshots
    WHERE recorded_at >= CURRENT_DATE - 90
    GROUP BY set_id
  )
  SELECT
    a.sid,
    coalesce(nullif(a.sname, ''), a.sid),
    round(a.total, 2),
    a.cnt,
    CASE WHEN a.p1  > 0 THEN round(100 * (a.c1  - a.p1)  / a.p1,  2) END,
    CASE WHEN a.p7  > 0 THEN round(100 * (a.c7  - a.p7)  / a.p7,  2) END,
    CASE WHEN a.p30 > 0 THEN round(100 * (a.c30 - a.p30) / a.p30, 2) END,
    COALESCE(s.pts, '[]'::jsonb)
  FROM agg a
  LEFT JOIN spark s ON s.sid = a.sid
  WHERE a.total > 0
  ORDER BY a.total DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_set_index_overview_with_names() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
