-- Giveaway / sweepstakes feature
CREATE TABLE public.giveaways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  prize_image_url TEXT,
  estimated_value_usd NUMERIC(10,2),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','closed','drawn')),
  winner_entry_id UUID,
  rules_text TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_giveaways_status_ends_at ON public.giveaways(status, ends_at);

ALTER TABLE public.giveaways ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public reads active giveaways"
  ON public.giveaways FOR SELECT
  USING (status = 'active' OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins write giveaways"
  ON public.giveaways FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.giveaway_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id UUID NOT NULL REFERENCES public.giveaways(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  street_address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','rejected')),
  confirmation_token TEXT NOT NULL UNIQUE,
  confirmation_sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (giveaway_id, email)
);

CREATE INDEX idx_giveaway_entries_token ON public.giveaway_entries(confirmation_token);
CREATE INDEX idx_giveaway_entries_giveaway_status ON public.giveaway_entries(giveaway_id, status);

ALTER TABLE public.giveaway_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read all entries"
  ON public.giveaway_entries FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "users read their own entries"
  ON public.giveaway_entries FOR SELECT
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

CREATE POLICY "admins update entries"
  ON public.giveaway_entries FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins delete entries"
  ON public.giveaway_entries FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE public.giveaways
  ADD CONSTRAINT giveaways_winner_entry_fk
  FOREIGN KEY (winner_entry_id) REFERENCES public.giveaway_entries(id) ON DELETE SET NULL;

INSERT INTO storage.buckets (id, name, public)
VALUES ('giveaway-images', 'giveaway-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public reads giveaway images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'giveaway-images');

CREATE POLICY "admins write giveaway images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'giveaway-images' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins update giveaway images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'giveaway-images' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins delete giveaway images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'giveaway-images' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.set_giveaways_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER giveaways_set_updated_at
  BEFORE UPDATE ON public.giveaways
  FOR EACH ROW EXECUTE FUNCTION public.set_giveaways_updated_at();