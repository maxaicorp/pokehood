-- Precomputed latest-prices table.
--
-- Before this migration, every Market page render called get_latest_price_page,
-- which computed three LATERAL JOINs per row to fetch the prior 1d/7d/30d
-- prices. That cost was paid on every scroll and every filter switch for
-- every user.
--
-- This migration moves that work to WRITE time: the snapshot-prices cron
-- now calls refresh_latest_card_prices() at the end of every successful run.
-- That single call materializes the latest per-card snapshot + its three
-- prior-window prices into a flat table. The Market RPCs then become trivial
-- indexed reads with no joins, so per-user reads drop from ~200-600ms to ~30ms.
--
-- Architecture intent: zero new infrastructure (no CDN, no storage buckets,
-- no separate cron jobs). One table, refreshed by the existing daily cron.

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.latest_card_prices (
  card_id     TEXT PRIMARY KEY,
  card_name   TEXT NOT NULL,
  set_name    TEXT NOT NULL,
  price       NUMERIC NOT NULL,
  recorded_at DATE NOT NULL,
  price_1d    NUMERIC,
  price_7d    NUMERIC,
  price_30d   NUMERIC,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sort-by-price is the dominant query on the Market homepage.
CREATE INDEX IF NOT EXISTS latest_card_prices_price_desc_idx
  ON public.latest_card_prices (price DESC);

-- text_pattern_ops lets the set-prefix LIKE filter ('me2pt5-%') use an index.
CREATE INDEX IF NOT EXISTS latest_card_prices_card_id_pattern_idx
  ON public.latest_card_prices (card_id text_pattern_ops);

ALTER TABLE public.latest_card_prices ENABLE ROW LEVEL SECURITY;

-- Public read: this is the homepage data, no PII. Writes are via the SECURITY
-- DEFINER refresh function (called by the service-role cron), never directly
-- by clients.
DROP POLICY IF EXISTS "latest_card_prices read for everyone" ON public.latest_card_prices;
CREATE POLICY "latest_card_prices read for everyone"
  ON public.latest_card_prices FOR SELECT
  USING (true);

-- ─── Refresh function ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_latest_card_prices()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INT;
BEGIN
  -- TRUNCATE rebuild keeps the table tight and avoids stale rows for cards
  -- that no longer have a snapshot. Wrapped with INSERT in a single statement
  -- so a partial failure rolls back and leaves the previous data intact.
  TRUNCATE TABLE public.latest_card_prices;

  INSERT INTO public.latest_card_prices
    (card_id, card_name, set_name, price, recorded_at, price_1d, price_7d, price_30d, updated_at)
  WITH latest AS (
    SELECT DISTINCT ON (card_id)
      card_id, card_name, set_name, price, recorded_at
    FROM public.price_snapshots
    ORDER BY card_id, recorded_at DESC
  )
  SELECT
    l.card_id, l.card_name, l.set_name, l.price, l.recorded_at,
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at <= l.recorded_at - INTERVAL '1 day'
       ORDER BY ps.recorded_at DESC LIMIT 1)  AS price_1d,
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at <= l.recorded_at - INTERVAL '7 days'
       ORDER BY ps.recorded_at DESC LIMIT 1)  AS price_7d,
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at <= l.recorded_at - INTERVAL '30 days'
       ORDER BY ps.recorded_at DESC LIMIT 1)  AS price_30d,
    NOW()
  FROM latest l;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_latest_card_prices() TO service_role;

-- ─── Replace the read RPCs to use the precomputed table ───────────────────────
--
-- Same signatures as before so the frontend needs no changes. The bodies
-- become trivial paginated SELECTs with no joins.

CREATE OR REPLACE FUNCTION public.get_latest_price_page(
  p_limit          INT DEFAULT 10,
  p_offset         INT DEFAULT 0,
  p_set_ids        TEXT[] DEFAULT NULL,
  p_sort_dir       TEXT DEFAULT 'desc',
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
  SELECT
    lcp.card_id, lcp.card_name, lcp.set_name, lcp.price, lcp.recorded_at,
    lcp.price_1d, lcp.price_7d, lcp.price_30d
  FROM public.latest_card_prices lcp
  WHERE (p_include_sealed OR lcp.card_id NOT LIKE 'sealed-%')
    AND (
      p_set_ids IS NULL
      OR array_length(p_set_ids, 1) IS NULL
      OR EXISTS (
        SELECT 1
        FROM unnest(p_set_ids) AS sid(set_id)
        WHERE lcp.card_id LIKE (split_part(sid.set_id, '::', 1) || '-%')
      )
    )
  ORDER BY
    CASE WHEN lower(p_sort_dir) = 'asc' THEN lcp.price END ASC NULLS LAST,
    CASE WHEN lower(p_sort_dir) <> 'asc' THEN lcp.price END DESC NULLS LAST,
    lcp.card_id ASC
  OFFSET GREATEST(p_offset, 0)
  LIMIT LEAST(GREATEST(p_limit, 1), 1000);
$$;

CREATE OR REPLACE FUNCTION public.get_all_latest_prices(
  p_limit  INT DEFAULT 5000,
  p_offset INT DEFAULT 0
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
  SELECT
    card_id, card_name, set_name, price, recorded_at,
    price_1d, price_7d, price_30d
  FROM public.latest_card_prices
  WHERE card_id NOT LIKE 'sealed-%'
  ORDER BY card_id
  OFFSET GREATEST(p_offset, 0)
  LIMIT LEAST(GREATEST(p_limit, 1), 10000);
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_price_page(INT, INT, TEXT[], TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_latest_prices(INT, INT) TO anon, authenticated;

-- ─── Initial population ───────────────────────────────────────────────────────
-- Run once so the table is non-empty the moment this migration finishes,
-- even before the next snapshot cron fires.

SELECT public.refresh_latest_card_prices();

NOTIFY pgrst, 'reload schema';
