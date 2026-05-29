-- Sealed product CATALOG table — the permanent fix for the 2026-04→05 outage.
--
-- Background: sealed data had two pipelines that silently diverged. Prices
-- flowed daily into price_snapshots (sealed-% rows) via the snapshot-sealed
-- cron, but the *catalog* (which products exist: names, types, images,
-- expansion metadata) came from a MANUAL local script that wrote a static
-- public/data/sealed-products.json. That script broke (proxy hardening) and
-- nobody ran it for ~7 weeks, so new sets like Chaos Rising (me4) had prices
-- in the DB but were invisible in the app.
--
-- Fix: move the catalog into the DB and have the snapshot-sealed cron upsert
-- it every run (the function already fetches every full product object, so
-- this is near-free). Frontend reads from here; the static JSON becomes a
-- fallback only. New sets now appear automatically within 24h, forever.

CREATE TABLE IF NOT EXISTS public.sealed_products (
  id                      TEXT PRIMARY KEY,           -- Scrydex sealed product id (e.g. me4-s1)
  name                    TEXT NOT NULL,
  type                    TEXT NOT NULL DEFAULT '',    -- Booster Box | Elite Trainer Box | Tin | ...
  description             TEXT,
  image_small             TEXT,
  image_medium            TEXT,
  expansion_id            TEXT,
  expansion_name          TEXT,
  expansion_series        TEXT,
  expansion_release_date  TEXT,                        -- 'YYYY-MM-DD' (slashes normalized to dashes)
  expansion_logo          TEXT,
  variants                JSONB,                       -- full Scrydex variants[] — fallback price source
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.sealed_products ENABLE ROW LEVEL SECURITY;

-- Public read: the Sealed tab is open to everyone. Writes are service-role
-- only (snapshot-sealed cron), which bypasses RLS — no write policy needed.
CREATE POLICY "Public read sealed_products"
  ON public.sealed_products FOR SELECT USING (true);

-- Default Sealed-tab sort is newest expansion first.
CREATE INDEX IF NOT EXISTS idx_sealed_products_release
  ON public.sealed_products (expansion_release_date DESC);

-- "More from this set" / per-expansion lookups.
CREATE INDEX IF NOT EXISTS idx_sealed_products_expansion
  ON public.sealed_products (expansion_id);

-- Type filter (ETBs, Booster Boxes, Tins, …).
CREATE INDEX IF NOT EXISTS idx_sealed_products_type
  ON public.sealed_products (type);
