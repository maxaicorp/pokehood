-- Marketing/content signal queue.
--
-- This turns the cached market data into draft content ideas for admin review:
-- daily movers, weekly movers, card-of-the-day candidates, and set heatmap
-- highlights. Nothing here calls Scrydex. It reads latest_card_prices and the
-- set index RPC, then stores draft signals for the admin content page.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.marketing_content_signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  dedupe_key    TEXT NOT NULL,
  signal_type   TEXT NOT NULL,
  "window"      TEXT,
  card_id       TEXT,
  card_name     TEXT NOT NULL DEFAULT '',
  set_id        TEXT,
  set_name      TEXT NOT NULL DEFAULT '',
  price         NUMERIC,
  prior_price   NUMERIC,
  pct_change    NUMERIC,
  total_value   NUMERIC,
  card_count    INT,
  score         NUMERIC NOT NULL DEFAULT 0,
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL,
  caption       TEXT NOT NULL,
  template_key  TEXT NOT NULL DEFAULT 'market_mover',
  target_path   TEXT NOT NULL DEFAULT '/',
  image_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'draft',
  scheduled_at  TIMESTAMPTZ,
  posted_at     TIMESTAMPTZ,
  posted_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT marketing_content_signals_status_check
    CHECK (status IN ('draft', 'approved', 'scheduled', 'posted', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_content_signals_dedupe
  ON public.marketing_content_signals (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_marketing_content_signals_status
  ON public.marketing_content_signals (status, signal_date DESC, score DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_content_signals_type
  ON public.marketing_content_signals (signal_type, signal_date DESC);

ALTER TABLE public.marketing_content_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "marketing_content_signals admin all" ON public.marketing_content_signals;
CREATE POLICY "marketing_content_signals admin all"
  ON public.marketing_content_signals
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_content_signals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_content_signals TO service_role;

CREATE OR REPLACE FUNCTION public.generate_marketing_content_signals(
  p_signal_date DATE DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_count INT := 0;
BEGIN
  -- Direct authenticated calls must be admin. Service-role edge jobs and SQL
  -- editor maintenance calls do not carry an authenticated user claim.
  IF auth.role() = 'authenticated'
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  WITH priced AS (
    SELECT
      l.card_id,
      split_part(l.card_id, '::', 1) AS base_card_id,
      regexp_replace(split_part(l.card_id, '::', 1), '-[^-]+$', '') AS set_id,
      l.card_name,
      l.set_name,
      l.price,
      l.price_1d,
      l.price_7d,
      l.price_30d,
      CASE WHEN l.price_1d  > 0 THEN round(100 * (l.price - l.price_1d)  / l.price_1d,  2) END AS pct_1d,
      CASE WHEN l.price_7d  > 0 THEN round(100 * (l.price - l.price_7d)  / l.price_7d,  2) END AS pct_7d,
      CASE WHEN l.price_30d > 0 THEN round(100 * (l.price - l.price_30d) / l.price_30d, 2) END AS pct_30d
    FROM public.latest_card_prices l
    WHERE l.card_id NOT LIKE 'sealed-%'
      AND l.card_id NOT LIKE '%::%'
      AND l.price IS NOT NULL
      AND l.price > 0
  ),
  set_names AS (
    SELECT set_id, max(set_name) AS set_name
    FROM priced
    GROUP BY set_id
  ),
  daily AS (
    SELECT
      'daily_mover'::TEXT AS signal_type,
      '24h'::TEXT AS "window",
      p.card_id,
      p.base_card_id,
      p.card_name,
      p.set_id,
      p.set_name,
      p.price,
      p.price_1d AS prior_price,
      p.pct_1d AS pct_change,
      NULL::NUMERIC AS total_value,
      NULL::INT AS card_count,
      abs(p.pct_1d) * ln(greatest(p.price, 1) + 1) AS score,
      p.card_name || ' moved ' || CASE WHEN p.pct_1d >= 0 THEN '+' ELSE '' END || p.pct_1d::TEXT || '% in 24h' AS title,
      p.set_name || ' changed sharply over the last day.' AS summary,
      p.card_name || ' is ' || CASE WHEN p.pct_1d >= 0 THEN 'up ' ELSE 'down ' END || abs(p.pct_1d)::TEXT || '% in 24h on Collectiblez.' AS caption,
      'market_mover'::TEXT AS template_key,
      '/card/' || p.base_card_id AS target_path
    FROM priced p
    WHERE p.pct_1d IS NOT NULL
      AND abs(p.pct_1d) >= 3
      AND p.price >= 2
    ORDER BY abs(p.pct_1d) DESC, p.price DESC
    LIMIT 10
  ),
  weekly AS (
    SELECT
      'weekly_mover'::TEXT AS signal_type,
      '7d'::TEXT AS "window",
      p.card_id,
      p.base_card_id,
      p.card_name,
      p.set_id,
      p.set_name,
      p.price,
      p.price_7d AS prior_price,
      p.pct_7d AS pct_change,
      NULL::NUMERIC AS total_value,
      NULL::INT AS card_count,
      abs(p.pct_7d) * ln(greatest(p.price, 1) + 1) AS score,
      p.card_name || ' moved ' || CASE WHEN p.pct_7d >= 0 THEN '+' ELSE '' END || p.pct_7d::TEXT || '% this week' AS title,
      p.set_name || ' is one of the strongest weekly movers.' AS summary,
      p.card_name || ' moved ' || CASE WHEN p.pct_7d >= 0 THEN '+' ELSE '' END || p.pct_7d::TEXT || '% over 7 days.' AS caption,
      'market_mover'::TEXT AS template_key,
      '/card/' || p.base_card_id AS target_path
    FROM priced p
    WHERE p.pct_7d IS NOT NULL
      AND abs(p.pct_7d) >= 5
      AND p.price >= 5
    ORDER BY abs(p.pct_7d) DESC, p.price DESC
    LIMIT 10
  ),
  card_day AS (
    SELECT
      'card_of_day'::TEXT AS signal_type,
      '30d'::TEXT AS "window",
      p.card_id,
      p.base_card_id,
      p.card_name,
      p.set_id,
      p.set_name,
      p.price,
      p.price_30d AS prior_price,
      p.pct_30d AS pct_change,
      NULL::NUMERIC AS total_value,
      NULL::INT AS card_count,
      (coalesce(p.pct_7d, 0) * 2) + coalesce(p.pct_30d, 0) + ln(greatest(p.price, 1) + 1) AS score,
      'Card of the day: ' || p.card_name AS title,
      p.set_name || ' at ' || to_char(p.price, 'FM$999,999,990.00') || ' NM market.' AS summary,
      'Card of the day: ' || p.card_name || ' from ' || p.set_name || ' at ' || to_char(p.price, 'FM$999,999,990.00') || '.' AS caption,
      'card_of_day'::TEXT AS template_key,
      '/card/' || p.base_card_id AS target_path
    FROM priced p
    WHERE p.price >= 25
    ORDER BY ((coalesce(p.pct_7d, 0) * 2) + coalesce(p.pct_30d, 0) + ln(greatest(p.price, 1) + 1)) DESC,
             p.price DESC
    LIMIT 1
  ),
  set_heat AS (
    SELECT
      'set_heat'::TEXT AS signal_type,
      '7d'::TEXT AS "window",
      NULL::TEXT AS card_id,
      NULL::TEXT AS base_card_id,
      ''::TEXT AS card_name,
      g.set_id,
      coalesce(sn.set_name, g.set_id) AS set_name,
      NULL::NUMERIC AS price,
      NULL::NUMERIC AS prior_price,
      g.pct_7d AS pct_change,
      g.total_value,
      g.card_count,
      abs(g.pct_7d) * ln(greatest(g.total_value, 1) + 1) AS score,
      coalesce(sn.set_name, g.set_id) || ' set heat: ' || CASE WHEN g.pct_7d >= 0 THEN '+' ELSE '' END || g.pct_7d::TEXT || '% 7d' AS title,
      'Aggregate set index at ' || to_char(g.total_value, 'FM$999,999,990.00') || '.' AS summary,
      coalesce(sn.set_name, g.set_id) || ' moved ' || CASE WHEN g.pct_7d >= 0 THEN '+' ELSE '' END || g.pct_7d::TEXT || '% over 7 days on the Collectiblez heatmap.' AS caption,
      'set_heat'::TEXT AS template_key,
      '/heatmap'::TEXT AS target_path
    FROM public.get_set_index_overview() g
    LEFT JOIN set_names sn ON sn.set_id = g.set_id
    WHERE g.pct_7d IS NOT NULL
    ORDER BY abs(g.pct_7d) DESC, g.total_value DESC
    LIMIT 8
  ),
  picks AS (
    SELECT * FROM daily
    UNION ALL SELECT * FROM weekly
    UNION ALL SELECT * FROM card_day
    UNION ALL SELECT * FROM set_heat
  ),
  upsert AS (
    INSERT INTO public.marketing_content_signals (
      signal_date, dedupe_key, signal_type, "window",
      card_id, card_name, set_id, set_name,
      price, prior_price, pct_change, total_value, card_count,
      score, title, summary, caption, template_key, target_path, image_payload,
      updated_at
    )
    SELECT
      p_signal_date,
      p_signal_date::TEXT || ':' || p.signal_type || ':' || coalesce(p.window, '') || ':' || coalesce(p.card_id, p.set_id, ''),
      p.signal_type,
      p."window",
      p.card_id,
      p.card_name,
      p.set_id,
      p.set_name,
      p.price,
      p.prior_price,
      p.pct_change,
      p.total_value,
      p.card_count,
      p.score,
      p.title,
      p.summary,
      p.caption,
      p.template_key,
      p.target_path,
      CASE
        WHEN p.base_card_id IS NOT NULL THEN jsonb_build_object(
          'kind', 'card',
          'image', 'https://images.scrydex.com/pokemon/' || p.base_card_id || '/large',
          'small', 'https://images.scrydex.com/pokemon/' || p.base_card_id || '/small'
        )
        ELSE jsonb_build_object(
          'kind', 'set',
          'set_logo', 'https://images.scrydex.com/pokemon/' || p.set_id || '-logo/logo'
        )
      END,
      now()
    FROM picks p
    ON CONFLICT (dedupe_key) DO UPDATE SET
      score = EXCLUDED.score,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      caption = EXCLUDED.caption,
      price = EXCLUDED.price,
      prior_price = EXCLUDED.prior_price,
      pct_change = EXCLUDED.pct_change,
      total_value = EXCLUDED.total_value,
      card_count = EXCLUDED.card_count,
      image_payload = EXCLUDED.image_payload,
      target_path = EXCLUDED.target_path,
      status = CASE
        WHEN marketing_content_signals.status IN ('approved', 'scheduled', 'posted')
          THEN marketing_content_signals.status
        ELSE 'draft'
      END,
      updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upsert;

  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_marketing_content_signals(DATE) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
