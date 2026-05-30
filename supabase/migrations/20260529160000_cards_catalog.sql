-- Phase 4: card CATALOG in the DB — the keystone of the rocket-v2 cleanup.
--
-- Replaces the static public/data/all-cards.json (9.9 MB, manually rebuilt,
-- goes stale → "Card not found" + unsearchable new cards + a 9.9 MB download on
-- dedicated pages). snapshot-prices already fetches every full card object from
-- Scrydex, so it upserts the catalog here for ~free (mirrors sealed_products).
--
-- Images are NOT stored — they're derived from card_id
-- (https://images.scrydex.com/pokemon/{id}/small). So a card row is tiny.
-- Frontend reads one row per card detail page (~30ms) and per-set lists from
-- set_id, instead of downloading + parsing 9.9 MB.

CREATE TABLE IF NOT EXISTS public.cards (
  id         TEXT PRIMARY KEY,           -- Scrydex card id (e.g. sv8pt5-161)
  name       TEXT NOT NULL,
  set_id     TEXT,                        -- derived: id up to the last '-'
  set_name   TEXT,
  number     TEXT,                        -- local/collector number
  rarity     TEXT,
  supertype  TEXT,                        -- Pokémon | Trainer | Energy
  subtypes   JSONB,                       -- string[]
  types      JSONB,                       -- string[]
  hp         TEXT,
  series     TEXT,
  language   TEXT DEFAULT 'EN',           -- EN now; JP later (undervalued P2)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

-- Public read — card metadata is not PII. Writes are service-role only
-- (snapshot-prices cron), which bypasses RLS.
CREATE POLICY "Public read cards" ON public.cards FOR SELECT USING (true);

-- Per-set lists (CardDetail "more from set", Sets pages).
CREATE INDEX IF NOT EXISTS idx_cards_set ON public.cards (set_id);
-- Name search (Explore / global search once moved to DB).
CREATE INDEX IF NOT EXISTS idx_cards_name ON public.cards USING gin (to_tsvector('simple', name));

NOTIFY pgrst, 'reload schema';
