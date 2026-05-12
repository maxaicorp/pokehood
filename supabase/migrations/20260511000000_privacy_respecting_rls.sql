-- Make the "is_published" profile toggle actually enforce privacy at the DB layer.
--
-- Before this migration, SELECT on profiles / collection_cards / user_links was
-- open to all (anon role included) so public profile pages work. That left the
-- "Private Profile" toggle as a purely cosmetic UI control — anyone hitting the
-- Supabase REST API directly could read any user's collection regardless.
--
-- After: SELECT is allowed if the row's owner has is_published = true, OR if
-- the requester is the owner themselves. Write policies are unchanged.

-- ─── profiles ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

CREATE POLICY "Published or own profile is selectable"
  ON public.profiles FOR SELECT
  USING (
    is_published = true
    OR auth.uid() = user_id
  );

-- ─── collection_cards ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Cards are publicly viewable" ON public.collection_cards;

CREATE POLICY "Cards visible if owner is published, or own"
  ON public.collection_cards FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = collection_cards.user_id
        AND p.is_published = true
    )
  );

-- ─── user_links ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Links are publicly viewable" ON public.user_links;

CREATE POLICY "Links visible if owner is published, or own"
  ON public.user_links FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = user_links.user_id
        AND p.is_published = true
    )
  );

-- Refresh PostgREST's policy cache so the changes apply immediately.
NOTIFY pgrst, 'reload schema';
