
-- 1. prize_winners: restrict SELECT to owner + admins
DROP POLICY IF EXISTS "anyone reads winners" ON public.prize_winners;
CREATE POLICY "winners and admins read winners"
  ON public.prize_winners FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- Attach guard trigger that blocks winners from editing admin-only columns
DROP TRIGGER IF EXISTS prize_winners_guard_update ON public.prize_winners;
CREATE TRIGGER prize_winners_guard_update
  BEFORE UPDATE ON public.prize_winners
  FOR EACH ROW EXECUTE FUNCTION public.guard_prize_winner_update();

-- 2. card_stats: replace anon write policies with authenticated-only
DROP POLICY IF EXISTS "Anyone can upsert card stats" ON public.card_stats;
DROP POLICY IF EXISTS "Anyone can update card stats" ON public.card_stats;
CREATE POLICY "Authenticated can upsert card stats"
  ON public.card_stats FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY "Authenticated can update card stats"
  ON public.card_stats FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE ON public.card_stats FROM anon;

-- 3. Restrict SECURITY DEFINER functions that should not be public
REVOKE EXECUTE ON FUNCTION public.refresh_latest_card_prices() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_card_stat(text, text, text, text, text) FROM anon;

-- 4. Storage: card-images uploads/updates restricted to authenticated users
DROP POLICY IF EXISTS "Anon upload card-images" ON storage.objects;
DROP POLICY IF EXISTS "Anon update card-images" ON storage.objects;
CREATE POLICY "Authenticated upload card-images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'card-images');
CREATE POLICY "Authenticated update card-images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'card-images') WITH CHECK (bucket_id = 'card-images');
