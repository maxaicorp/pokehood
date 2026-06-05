-- Storage + internal-log RLS hardening (schema linter findings).

-- ─── 1) card-images bucket — REAL write hole ──────────────────────────────────
-- The "Authenticated upload/update card-images" policies let ANY authenticated
-- user write to the bucket (only checked bucket_id, not role). A non-admin could
-- overwrite real card art or upload arbitrary files. No user-facing client code
-- writes to this bucket (profile uploads go to avatar buckets, giveaways to
-- giveaway-images), and backend uploads use the service role (which bypasses
-- RLS), so restricting client writes to admins breaks nothing. Public SELECT
-- stays — the bucket is public-read for serving images.
DROP POLICY IF EXISTS "Authenticated upload card-images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update card-images" ON storage.objects;

CREATE POLICY "Admin upload card-images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'card-images' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin update card-images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'card-images' AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'card-images' AND public.has_role(auth.uid(), 'admin'::app_role));

-- ─── 2) Internal pipeline logs — document the deny-all intent ──────────────────
-- pipeline_heal_log + snapshot_chunk_log are written only by SECURITY DEFINER
-- pipeline functions (which bypass RLS). They were RLS-on with no policies =
-- inaccessible via the API (safe). Add an explicit admin-only SELECT so the
-- intent is documented and a future accidental permissive policy is less likely.
-- No write policies on purpose (no client writes).
ALTER TABLE public.pipeline_heal_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshot_chunk_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_heal_log admin read" ON public.pipeline_heal_log;
CREATE POLICY "pipeline_heal_log admin read" ON public.pipeline_heal_log
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "snapshot_chunk_log admin read" ON public.snapshot_chunk_log;
CREATE POLICY "snapshot_chunk_log admin read" ON public.snapshot_chunk_log
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

NOTIFY pgrst, 'reload schema';
