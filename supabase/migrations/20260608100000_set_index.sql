-- Set Index — each expansion's aggregate value ("master set" cost = sum of every
-- card's NM price), tracked daily. Powers the /indexes page AND the marketing bot.
-- Reuses the price data we just made complete; nothing here hits Scrydex.
--
-- A card's set id = its id minus any ::variant suffix and the trailing -<number>
-- (sv8pt5-161 -> sv8pt5, me2pt5-284::normal -> me2pt5, base1-4 -> base1).

CREATE TABLE IF NOT EXISTS public.set_index_snapshots (
  set_id       TEXT NOT NULL,
  recorded_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  total_value  NUMERIC NOT NULL,
  card_count   INT NOT NULL,
  PRIMARY KEY (set_id, recorded_at)
);

GRANT SELECT ON public.set_index_snapshots TO anon, authenticated;

-- Daily: snapshot today's index per set from the live read cache (complete +
-- carry-forward, so it's the current value of one-of-each). Idempotent per day.
CREATE OR REPLACE FUNCTION public.refresh_set_index()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH upsert AS (
    INSERT INTO public.set_index_snapshots (set_id, recorded_at, total_value, card_count)
    SELECT
      regexp_replace(split_part(card_id, '::', 1), '-[^-]+$', '') AS set_id,
      CURRENT_DATE,
      round(sum(price), 2),
      count(*)::int
    FROM public.latest_card_prices
    WHERE card_id NOT LIKE 'sealed-%' AND price > 0
    GROUP BY 1
    ON CONFLICT (set_id, recorded_at) DO UPDATE
      SET total_value = EXCLUDED.total_value, card_count = EXCLUDED.card_count
    RETURNING 1
  )
  SELECT count(*)::int FROM upsert;
$$;

-- Overview for the /indexes page: every set's current value + 1d/7d/30d movement
-- (from the cards' trend-derived prior prices, comparable basket) + a sparkline
-- of the last 90 daily index points. One call, anon-readable.
CREATE OR REPLACE FUNCTION public.get_set_index_overview()
RETURNS TABLE (
  set_id TEXT, total_value NUMERIC, card_count INT,
  pct_1d NUMERIC, pct_7d NUMERIC, pct_30d NUMERIC, sparkline JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH agg AS (
    SELECT
      regexp_replace(split_part(card_id, '::', 1), '-[^-]+$', '') AS sid,
      sum(price)                                            AS total,
      count(*)::int                                         AS cnt,
      sum(price_1d)  FILTER (WHERE price_1d  IS NOT NULL)   AS p1,
      sum(price)     FILTER (WHERE price_1d  IS NOT NULL)   AS c1,
      sum(price_7d)  FILTER (WHERE price_7d  IS NOT NULL)   AS p7,
      sum(price)     FILTER (WHERE price_7d  IS NOT NULL)   AS c7,
      sum(price_30d) FILTER (WHERE price_30d IS NOT NULL)   AS p30,
      sum(price)     FILTER (WHERE price_30d IS NOT NULL)   AS c30
    FROM public.latest_card_prices
    WHERE card_id NOT LIKE 'sealed-%' AND price > 0
    GROUP BY 1
  ),
  spark AS (
    SELECT set_id AS sid,
           jsonb_agg(jsonb_build_object('date', recorded_at, 'value', total_value) ORDER BY recorded_at) AS pts
    FROM public.set_index_snapshots
    WHERE recorded_at >= CURRENT_DATE - 90
    GROUP BY set_id
  )
  SELECT
    a.sid, round(a.total, 2), a.cnt,
    CASE WHEN a.p1  > 0 THEN round(100 * (a.c1  - a.p1)  / a.p1,  2) END,
    CASE WHEN a.p7  > 0 THEN round(100 * (a.c7  - a.p7)  / a.p7,  2) END,
    CASE WHEN a.p30 > 0 THEN round(100 * (a.c30 - a.p30) / a.p30, 2) END,
    COALESCE(s.pts, '[]'::jsonb)
  FROM agg a
  LEFT JOIN spark s ON s.sid = a.sid
  WHERE a.total > 0
  ORDER BY a.total DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_set_index_overview() TO anon, authenticated;

-- Full daily history for one set (the detail chart).
CREATE OR REPLACE FUNCTION public.get_set_index_history(p_set_id TEXT, p_days INT DEFAULT 365)
RETURNS TABLE (recorded_at DATE, total_value NUMERIC, card_count INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT recorded_at, total_value, card_count
  FROM public.set_index_snapshots
  WHERE set_id = p_set_id AND recorded_at >= CURRENT_DATE - GREATEST(p_days, 1)
  ORDER BY recorded_at;
$$;
GRANT EXECUTE ON FUNCTION public.get_set_index_history(TEXT, INT) TO anon, authenticated;

-- Seed today's point so the page has data immediately (sparklines grow daily).
SELECT public.refresh_set_index();

NOTIFY pgrst, 'reload schema';
