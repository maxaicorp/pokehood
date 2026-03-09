
-- Profile views tracking table
CREATE TABLE IF NOT EXISTS public.profile_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_user_id uuid NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can log a profile view"
  ON public.profile_views FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Owners can view their own profile views"
  ON public.profile_views FOR SELECT
  USING (auth.uid() = profile_user_id);

-- Link clicks tracking table
CREATE TABLE IF NOT EXISTS public.link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.user_links(id) ON DELETE CASCADE,
  link_user_id uuid NOT NULL,
  clicked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.link_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can log a link click"
  ON public.link_clicks FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Owners can view their own link clicks"
  ON public.link_clicks FOR SELECT
  USING (auth.uid() = link_user_id);
