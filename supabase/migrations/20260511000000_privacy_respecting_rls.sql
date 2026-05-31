-- Make the "is_published" profile toggle actually enforce privacy at the DB layer.
--
-- Before this migration, SELECT on profiles / collection_cards / user_links was
-- open to all (anon role included) so public profile pages work. That left the
-- "Private Profile" toggle as a purely cosmetic UI control — anyone hitting the
-- Supabase REST API directly could read any user's collection regardless.
--
-- After: SELECT is allowed if the row's owner has is_published = true, OR if
-- the requester is the owner themselves. Write policies are unchanged.
--
-- This version is IDEMPOTENT and name-agnostic: it dynamically drops EVERY
-- existing SELECT policy on each table (so no leftover permissive "allow all"
-- policy can keep granting access — RLS OR-combines permissive policies), then
-- recreates the restrictive one. Safe to run multiple times.

-- ─── profiles ────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Published or own profile is selectable"
  ON public.profiles FOR SELECT
  USING (
    is_published = true
    OR auth.uid() = user_id
  );

-- ─── collection_cards ────────────────────────────────────────────────────────
ALTER TABLE public.collection_cards ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'collection_cards' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.collection_cards', pol.policyname);
  END LOOP;
END $$;

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
ALTER TABLE public.user_links ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_links' AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.user_links', pol.policyname);
  END LOOP;
END $$;

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
