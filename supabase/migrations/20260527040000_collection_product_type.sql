-- Add product_type to collection_cards so the same table can hold both
-- singles (cards) and sealed products. Sealed products reuse the existing
-- columns: tcg_api_id = sealed product id, name/image/market_price as usual,
-- but have no meaningful "condition" (they're sealed).
--
-- Default 'card' keeps every existing row valid with zero backfill.

ALTER TABLE public.collection_cards
  ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'card'
  CHECK (product_type IN ('card', 'sealed'));

-- Index so the Dashboard can cheaply split the collection into the
-- Cards vs Sealed views.
CREATE INDEX IF NOT EXISTS idx_collection_cards_user_product
  ON public.collection_cards (user_id, product_type);
