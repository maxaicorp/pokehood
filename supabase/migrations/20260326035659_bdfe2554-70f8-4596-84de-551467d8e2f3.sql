CREATE TABLE public.price_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id text NOT NULL,
  card_name text NOT NULL DEFAULT '',
  set_name text NOT NULL DEFAULT '',
  price numeric NOT NULL,
  recorded_at date NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (card_id, recorded_at)
);

ALTER TABLE public.price_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Price snapshots are publicly readable"
  ON public.price_snapshots
  FOR SELECT
  TO public
  USING (true);

CREATE INDEX idx_price_snapshots_card_date ON public.price_snapshots (card_id, recorded_at DESC);