-- Card "extras" for the mobile info box: attacks / abilities / weakness /
-- resistance / retreat / flavor text. sync-cards-catalog ALREADY downloads the
-- full Scrydex card object on every run and discards these — this just gives it
-- somewhere to land, so the card-detail page reads them straight from the DB
-- (zero per-view Scrydex credits). Stored as jsonb pass-through; the frontend
-- renders defensively.
--
-- Null until sync-cards-catalog is redeployed (v 2026-06-04-card-extras) and
-- re-run; the info box just omits the move section in the meantime.

ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS attacks      jsonb,
  ADD COLUMN IF NOT EXISTS abilities    jsonb,
  ADD COLUMN IF NOT EXISTS weaknesses   jsonb,
  ADD COLUMN IF NOT EXISTS resistances  jsonb,
  ADD COLUMN IF NOT EXISTS retreat_cost jsonb,
  ADD COLUMN IF NOT EXISTS flavor_text  text;

NOTIFY pgrst, 'reload schema';
