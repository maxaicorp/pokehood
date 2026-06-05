-- Security hardening for the card-stats tables (flagged by the schema linter).
--
-- card_stats had a permissive UPDATE policy (USING true / WITH CHECK true) that
-- let ANY authenticated user rewrite ANY row's counters directly via the REST
-- API (inflate view/search/collection counts, etc.). All legitimate writes go
-- through the SECURITY DEFINER increment_card_stat() RPC, which bypasses RLS, so
-- the client only ever needs SELECT. Drop every existing policy and re-create a
-- single read-only one. The client only ever does .from('card_stats').select().

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'card_stats'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.card_stats', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.card_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "card_stats public read" ON public.card_stats FOR SELECT USING (true);
-- No INSERT/UPDATE/DELETE policies on purpose: direct client writes are denied;
-- counters change only via the SECURITY DEFINER increment_card_stat() RPC.
REVOKE INSERT, UPDATE, DELETE ON public.card_stats FROM anon, authenticated;
GRANT SELECT ON public.card_stats TO anon, authenticated;

-- card_view_events: the linter warns "RLS enabled but no policies". That is
-- INTENTIONAL — the table is written only inside increment_card_stat() and read
-- only via get_most_viewed_windowed(), both SECURITY DEFINER (they bypass RLS).
-- No direct client access is wanted, so no policies is the correct, locked-down
-- state. Documented here so it isn't "fixed" by adding a permissive policy.
COMMENT ON TABLE public.card_view_events IS
  'Append-only view log. Locked down by design: written/read only via SECURITY DEFINER funcs (increment_card_stat / get_most_viewed_windowed). RLS on + no policies = no direct client access (intended).';

NOTIFY pgrst, 'reload schema';
