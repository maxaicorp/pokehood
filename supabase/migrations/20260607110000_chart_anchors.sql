-- Chart anchors served from the CACHE, never a live per-view Scrydex call.
--
-- The card page used to live-fetch Scrydex (scrydex-proxy) for the chart's
-- 6-month shape — which (a) required auth so anonymous visitors got no chart and
-- (b) burned ~1 credit per logged-in view. Wrong layer. Scrydex must only be hit
-- by backend jobs.
--
-- Fix: the per-set crawl already has trends in-hand (include=prices). It now
-- stores all 6 trend-derived prior prices on the snapshot row, and this RPC
-- serves the chart entirely from the DB — readable by anon, zero credits.

ALTER TABLE public.price_snapshots
  ADD COLUMN IF NOT EXISTS price_14d  NUMERIC,
  ADD COLUMN IF NOT EXISTS price_90d  NUMERIC,
  ADD COLUMN IF NOT EXISTS price_180d NUMERIC;

-- One call returns everything the chart needs: the dense daily series (real
-- snapshots) + the latest row's 6 trend anchors (deep shape) + current price.
-- SECURITY DEFINER + granted to anon so public card pages work with no auth and
-- no Scrydex contact.
CREATE OR REPLACE FUNCTION public.get_card_price_chart(
  p_card_id TEXT,
  p_days    INT DEFAULT 365
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT price, price_1d, price_7d, price_14d, price_30d, price_90d, price_180d
    FROM public.price_snapshots
    WHERE card_id = p_card_id AND price IS NOT NULL AND price > 0
    ORDER BY recorded_at DESC
    LIMIT 1
  ),
  series AS (
    SELECT recorded_at::text AS date, price
    FROM public.price_snapshots
    WHERE card_id = p_card_id AND price IS NOT NULL AND price > 0
      AND recorded_at >= CURRENT_DATE - GREATEST(p_days, 1)
    ORDER BY recorded_at
  )
  SELECT jsonb_build_object(
    'current', (SELECT price FROM latest),
    'points',  COALESCE((SELECT jsonb_agg(jsonb_build_object('date', date, 'price', price)) FROM series), '[]'::jsonb),
    'anchors', (SELECT jsonb_build_object(
      'd1',   price_1d,
      'd7',   price_7d,
      'd14',  price_14d,
      'd30',  price_30d,
      'd90',  price_90d,
      'd180', price_180d
    ) FROM latest)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_card_price_chart(TEXT, INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
