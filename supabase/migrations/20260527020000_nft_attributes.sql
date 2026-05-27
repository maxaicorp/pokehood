-- Extend nft_names with structured attributes pulled from Helius
-- getAssetBatch. The Onchain page only needed `name` (the human-readable
-- string for display); the upcoming CC discovery tool needs structured
-- fields to deterministically match each NFT against latest_graded_prices.
--
-- All columns nullable + indexed loosely — population is best-effort. The
-- `attributes` JSONB stores the full raw Helius attribute array so future
-- code can extract additional traits without re-querying Helius.

ALTER TABLE public.nft_names
  ADD COLUMN IF NOT EXISTS attributes      JSONB,
  ADD COLUMN IF NOT EXISTS card_name_attr  TEXT,
  ADD COLUMN IF NOT EXISTS set_hint        TEXT,
  ADD COLUMN IF NOT EXISTS card_number     TEXT,
  ADD COLUMN IF NOT EXISTS grading_company TEXT,   -- 'PSA' | 'CGC' | 'BGS' | 'TAG' | 'SGC' | 'ACE'
  ADD COLUMN IF NOT EXISTS grade_value     NUMERIC,
  ADD COLUMN IF NOT EXISTS year_attr       TEXT;

-- These indexes help the matcher join nft_names → latest_card_prices /
-- latest_graded_prices by (set_hint, card_number) or (grading_company, grade).
CREATE INDEX IF NOT EXISTS idx_nft_names_set_card
  ON public.nft_names (set_hint, card_number)
  WHERE set_hint IS NOT NULL AND card_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nft_names_grading
  ON public.nft_names (grading_company, grade_value)
  WHERE grading_company IS NOT NULL;
