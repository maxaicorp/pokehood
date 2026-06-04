-- sync-cards-catalog writes 0 rows. Findings so far:
--   * `cards` schema matches what the function inserts (not a schema bug).
--   * `cards` has RLS ON with ONLY a SELECT policy ("cards public read") and
--     NO insert policy -> only service_role (which bypasses RLS) can write.
--
-- THEORY: the function isn't writing as service_role, so RLS blocks every
-- insert. snapshot-prices works because price_snapshots likely has no RLS,
-- masking the missing key. These two checks confirm it. Run + report results.

-- 1) Privileged upsert (SQL editor bypasses RLS) — proves schema/PK are fine.
INSERT INTO public.cards
  (id, name, set_id, set_name, number, rarity, supertype, subtypes, types, hp, series, language, updated_at)
VALUES
  ('diag-1','Diag','diag','Diag Set','1','Common','Pokémon','["Basic"]'::jsonb,'["Fire"]'::jsonb,'80','Diag','EN', now())
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now();
SELECT count(*) AS got FROM public.cards WHERE id = 'diag-1';   -- expect 1
DELETE FROM public.cards WHERE id = 'diag-1';

-- 2) RLS comparison: is price_snapshots open (no RLS / has insert policy) while
--    cards is locked? If so, the function writes as anon and that's the bug.
SELECT relname AS table, relrowsecurity AS rls_on
FROM pg_class
WHERE oid IN ('public.cards'::regclass, 'public.price_snapshots'::regclass, 'public.latest_card_prices'::regclass);

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('cards','price_snapshots','latest_card_prices')
ORDER BY tablename, cmd;

-- READ-OUT:
--  got = 1  -> schema/PK fine (expected).
--  If price_snapshots rls_on = false (or has an INSERT policy) but cards is
--  rls_on = true with only SELECT  ->  THEORY CONFIRMED: function writes as
--  anon; RLS blocks cards inserts.
--
-- FIX (then): make cards writable by the sync without weakening security —
--  add a SECURITY DEFINER `upsert_cards(jsonb)` RPC the function calls (bypasses
--  RLS cleanly), OR ensure SUPABASE_SERVICE_ROLE_KEY is set on sync-cards-catalog.
-- Definitive error is also in: Edge Functions -> sync-cards-catalog -> Logs
--  ("cards upsert: <message>" — a permission/RLS error nails it).
