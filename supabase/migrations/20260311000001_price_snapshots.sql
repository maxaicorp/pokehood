-- Price snapshots: daily price recordings for 24h / 7d / 30d % change
-- Populated by a scheduled edge function; read by the Market page.

CREATE TABLE IF NOT EXISTS public.price_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id TEXT NOT NULL,            -- tcg_api_id
  card_name TEXT NOT NULL DEFAULT '',
  set_name TEXT NOT NULL DEFAULT '',
  price NUMERIC NOT NULL,           -- market price in USD at snapshot time
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,

  -- prevent duplicates: one snapshot per card per day
  UNIQUE (card_id, recorded_at)
);

ALTER TABLE public.price_snapshots ENABLE ROW LEVEL SECURITY;

-- Snapshots are public read (aggregate data, no user info)
CREATE POLICY "Anyone can read price snapshots"
  ON public.price_snapshots FOR SELECT
  USING (true);

-- Only service role (edge function) inserts, but we allow authenticated too
-- in case you want to trigger manual snapshots from admin
CREATE POLICY "Service or auth can insert snapshots"
  ON public.price_snapshots FOR INSERT
  WITH CHECK (true);

-- Indexes for lookup patterns used by the Market page
CREATE INDEX idx_snapshots_card_recorded ON public.price_snapshots (card_id, recorded_at DESC);
CREATE INDEX idx_snapshots_recorded_at ON public.price_snapshots (recorded_at DESC);

-- Helper RPC: fetch the latest snapshot + historical prices for % calculation
-- Returns one row per card_id with current, 1d-ago, 7d-ago, 30d-ago prices.
CREATE OR REPLACE FUNCTION public.get_price_changes(p_card_ids TEXT[])
RETURNS TABLE (
  card_id TEXT,
  current_price NUMERIC,
  price_1d_ago NUMERIC,
  price_7d_ago NUMERIC,
  price_30d_ago NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    s.card_id,
    -- current = most recent snapshot
    (SELECT price FROM public.price_snapshots
     WHERE card_id = s.card_id ORDER BY recorded_at DESC LIMIT 1) AS current_price,
    -- 1 day ago
    (SELECT price FROM public.price_snapshots
     WHERE card_id = s.card_id AND recorded_at <= CURRENT_DATE - INTERVAL '1 day'
     ORDER BY recorded_at DESC LIMIT 1) AS price_1d_ago,
    -- 7 days ago
    (SELECT price FROM public.price_snapshots
     WHERE card_id = s.card_id AND recorded_at <= CURRENT_DATE - INTERVAL '7 days'
     ORDER BY recorded_at DESC LIMIT 1) AS price_7d_ago,
    -- 30 days ago
    (SELECT price FROM public.price_snapshots
     WHERE card_id = s.card_id AND recorded_at <= CURRENT_DATE - INTERVAL '30 days'
     ORDER BY recorded_at DESC LIMIT 1) AS price_30d_ago
  FROM unnest(p_card_ids) AS s(card_id);
$$;

-- Cleanup: keep only last 90 days of snapshots to bound storage
-- Run via pg_cron or manual cleanup; edge function can also prune after insert.
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('cleanup-old-snapshots', '0 3 * * *',
--   $$DELETE FROM public.price_snapshots WHERE recorded_at < CURRENT_DATE - INTERVAL '90 days'$$);
