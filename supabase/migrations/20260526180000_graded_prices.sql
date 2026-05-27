-- Graded price snapshots — daily history of PSA/CGC/BGS/TAG/SGC/ACE prices
-- per card. Populated by snapshot-prices alongside raw prices (zero extra
-- Scrydex credits — same /cards?include=prices response, we were just
-- discarding the graded entries).
--
-- Mirrors the price_snapshots → latest_card_prices → Market pattern:
--   graded_price_snapshots  = append-only history
--   latest_graded_prices    = precomputed cache the frontend reads
--   refresh_latest_graded_prices() = function called at end of snapshot run

-- ─── History table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.graded_price_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id     TEXT NOT NULL,
  company     TEXT NOT NULL,      -- 'PSA' | 'CGC' | 'BGS' | 'TAG' | 'SGC' | 'ACE'
  grade       NUMERIC NOT NULL,   -- 10, 9.5, 9, 8.5, 8, 7, ...
  is_perfect  BOOLEAN NOT NULL DEFAULT FALSE,
  is_signed   BOOLEAN NOT NULL DEFAULT FALSE,
  is_error    BOOLEAN NOT NULL DEFAULT FALSE,
  low         NUMERIC,
  mid         NUMERIC,
  market      NUMERIC,
  high        NUMERIC,
  currency    TEXT NOT NULL DEFAULT 'USD',
  recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
  -- One row per (card, grading variant, day). Specialty flags are part of the
  -- key because PSA 10 vs PSA 10 Pristine are distinct products.
  UNIQUE (card_id, company, grade, is_perfect, is_signed, is_error, recorded_at)
);

ALTER TABLE public.graded_price_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read graded_price_snapshots"
  ON public.graded_price_snapshots FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_graded_card_recorded
  ON public.graded_price_snapshots (card_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_graded_recorded
  ON public.graded_price_snapshots (recorded_at DESC);

-- ─── Precomputed read-side cache ─────────────────────────────────────────────
-- One row per (card, company, grade) carrying the most recent prices. Reads
-- on CardDetail go straight here — no joins, no aggregations. Sub-50ms.
-- Specialty rows (signed/error/perfect) are excluded; this cache only
-- serves the standard tile row.
CREATE TABLE IF NOT EXISTS public.latest_graded_prices (
  card_id    TEXT NOT NULL,
  company    TEXT NOT NULL,
  grade      NUMERIC NOT NULL,
  low        NUMERIC,
  mid        NUMERIC,
  market     NUMERIC,
  high       NUMERIC,
  currency   TEXT NOT NULL DEFAULT 'USD',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, company, grade)
);

ALTER TABLE public.latest_graded_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read latest_graded_prices"
  ON public.latest_graded_prices FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_latest_graded_card
  ON public.latest_graded_prices (card_id);

-- ─── Refresh function ────────────────────────────────────────────────────────
-- Called by snapshot-prices at the end of every successful run, same as
-- refresh_latest_card_prices. Recomputes the cache from the latest snapshot
-- per (card_id, company, grade). Specialty rows are filtered out.
CREATE OR REPLACE FUNCTION public.refresh_latest_graded_prices()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INT;
BEGIN
  -- Atomically replace the cache. TRUNCATE + INSERT is fine here because
  -- this table is read-only from the frontend and the operation is fast.
  TRUNCATE public.latest_graded_prices;

  INSERT INTO public.latest_graded_prices (
    card_id, company, grade, low, mid, market, high, currency, updated_at
  )
  SELECT DISTINCT ON (card_id, company, grade)
    card_id, company, grade, low, mid, market, high, currency, now()
  FROM public.graded_price_snapshots
  WHERE is_perfect = FALSE
    AND is_signed  = FALSE
    AND is_error   = FALSE
    AND market IS NOT NULL
    AND market > 0
  ORDER BY card_id, company, grade, recorded_at DESC;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_latest_graded_prices() TO service_role;

-- ─── Read RPC for the frontend ───────────────────────────────────────────────
-- GradedPriceTiles calls this with a card_id. Returns rows for the 6 tiles
-- the component renders (PSA/BGS/CGC × 10, 9). The component fills in
-- missing combos with placeholder em-dash tiles client-side, so we just
-- return whatever the cache has.
CREATE OR REPLACE FUNCTION public.get_graded_tiles_for_card(p_card_id TEXT)
RETURNS TABLE (
  company  TEXT,
  grade    NUMERIC,
  market   NUMERIC,
  low      NUMERIC,
  mid      NUMERIC,
  high     NUMERIC,
  currency TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT company, grade, market, low, mid, high, currency
  FROM public.latest_graded_prices
  WHERE card_id = p_card_id
    AND company IN ('PSA','BGS','CGC')
    AND grade IN (10, 9)
  ORDER BY company, grade DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_graded_tiles_for_card(TEXT) TO anon, authenticated;
