-- Collector Crypt discovery tool — backing schema.
--
-- Two tables:
--   cc_discovery_state    — singleton row tracking last run time + status
--   cc_discovery_results  — most-recent-run snapshot; TRUNCATE+INSERT each
--                           Run cycle.
--
-- Plus an RPC the admin page reads in one shot.

-- ─── Singleton state ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cc_discovery_state (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_run_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'idle',  -- 'idle' | 'running' | 'error'
  -- Counters from the most recent run, for the page header summary.
  total_active    INT NOT NULL DEFAULT 0,
  matched_count   INT NOT NULL DEFAULT 0,
  unmatched_count INT NOT NULL DEFAULT 0,
  undervalued_count INT NOT NULL DEFAULT 0,
  last_error      TEXT
);
-- Seed the singleton so reads return a row even before the first run.
INSERT INTO public.cc_discovery_state (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.cc_discovery_state ENABLE ROW LEVEL SECURITY;
-- Admin-only read. Service role bypasses RLS for writes via the edge fn.
CREATE POLICY "Admins read cc_discovery_state"
  ON public.cc_discovery_state FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- ─── Per-listing results (replaced each run) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cc_discovery_results (
  pda_address       TEXT PRIMARY KEY,
  -- Pulled from the listing at run time so the admin table renders without
  -- a join even if the listing later gets delisted between runs.
  token_mint        TEXT NOT NULL,
  listing_name      TEXT,
  listing_image     TEXT,
  listing_price_usd NUMERIC,
  marketplace_url   TEXT,
  -- Matcher output. matched_card_id is the latest_card_prices key when we
  -- successfully matched; NULL when unmatched.
  matched_card_id   TEXT,
  matched_card_name TEXT,
  matched_set_name  TEXT,
  matched_company   TEXT,
  matched_grade     NUMERIC,
  market_price_usd  NUMERIC,
  delta_pct         NUMERIC,            -- (listing - market) / market * 100; negative = undervalued
  match_method      TEXT,               -- 'graded_attrs' | 'raw_attrs' | 'name_parse' | 'none'
  match_confidence  NUMERIC,            -- 0..1 score from the matcher
  status            TEXT NOT NULL,      -- 'matched' | 'unmatched'
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cc_discovery_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read cc_discovery_results"
  ON public.cc_discovery_results FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_cc_disc_delta
  ON public.cc_discovery_results (delta_pct ASC NULLS LAST)
  WHERE status = 'matched';

CREATE INDEX IF NOT EXISTS idx_cc_disc_status
  ON public.cc_discovery_results (status);

-- ─── Read RPC for the admin page ────────────────────────────────────────────
-- Single call returns the singleton state + a sorted page of results filtered
-- by status. The page uses two calls (one per tab: matched/unmatched).
CREATE OR REPLACE FUNCTION public.get_cc_discovery(
  p_status TEXT DEFAULT 'matched',     -- 'matched' | 'unmatched'
  p_limit  INT  DEFAULT 200,
  p_offset INT  DEFAULT 0
)
RETURNS TABLE (
  pda_address       TEXT,
  token_mint        TEXT,
  listing_name      TEXT,
  listing_image     TEXT,
  listing_price_usd NUMERIC,
  marketplace_url   TEXT,
  matched_card_id   TEXT,
  matched_card_name TEXT,
  matched_set_name  TEXT,
  matched_company   TEXT,
  matched_grade     NUMERIC,
  market_price_usd  NUMERIC,
  delta_pct         NUMERIC,
  match_method      TEXT,
  match_confidence  NUMERIC,
  status            TEXT,
  computed_at       TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- Admin-only — mirrors the RLS policies on the underlying tables.
  SELECT r.pda_address, r.token_mint, r.listing_name, r.listing_image,
         r.listing_price_usd, r.marketplace_url,
         r.matched_card_id, r.matched_card_name, r.matched_set_name,
         r.matched_company, r.matched_grade, r.market_price_usd,
         r.delta_pct, r.match_method, r.match_confidence, r.status,
         r.computed_at
  FROM public.cc_discovery_results r
  WHERE r.status = p_status
    AND public.has_role(auth.uid(), 'admin')
  ORDER BY
    -- Matched tab: most undervalued first (most negative delta first).
    CASE WHEN p_status = 'matched' THEN r.delta_pct END ASC NULLS LAST,
    -- Unmatched tab: newest computed first.
    CASE WHEN p_status = 'unmatched' THEN r.computed_at END DESC NULLS LAST
  OFFSET p_offset
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_cc_discovery(TEXT, INT, INT) TO authenticated;

-- Cooldown-aware state read. Returns the singleton row plus a derived
-- can_run_at timestamp so the frontend can show a countdown without
-- doing its own cooldown math.
CREATE OR REPLACE FUNCTION public.get_cc_discovery_state()
RETURNS TABLE (
  last_run_at     TIMESTAMPTZ,
  status          TEXT,
  total_active    INT,
  matched_count   INT,
  unmatched_count INT,
  undervalued_count INT,
  last_error      TEXT,
  can_run_at      TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    s.last_run_at, s.status, s.total_active, s.matched_count,
    s.unmatched_count, s.undervalued_count, s.last_error,
    -- Cooldown: 10 minutes after the last run. If never run, allow now.
    CASE
      WHEN s.last_run_at IS NULL THEN now()
      ELSE s.last_run_at + INTERVAL '10 minutes'
    END AS can_run_at
  FROM public.cc_discovery_state s
  WHERE s.id = 1
    AND public.has_role(auth.uid(), 'admin');
$$;

GRANT EXECUTE ON FUNCTION public.get_cc_discovery_state() TO authenticated;
