-- Admin "Re-crawl all sets now" — the button equivalent of the manual reset we
-- ran during deploy. Marks every enabled set due again so the per-set crawl
-- re-fetches the whole catalog with the latest code. Admin-guarded.
--
-- The button then fires snapshot-prices crawl-batch a few times to start
-- immediately (the 5-min cron would also pick it up), and the AdminHealth
-- per-set panel shows fresh_today climb 0→181 live.

CREATE OR REPLACE FUNCTION public.request_full_resnapshot()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  UPDATE public.scrydex_set_snapshot_state
  SET last_success_on = NULL,
      status          = 'pending',
      locked_until    = NULL,
      attempts_today  = 0,
      attempts_on     = NULL,
      updated_at      = now()
  WHERE enabled;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_full_resnapshot() TO authenticated;

NOTIFY pgrst, 'reload schema';
