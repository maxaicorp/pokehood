-- Observer log for incoming Scrydex webhooks. PURE OBSERVATION — nothing here
-- touches price_snapshots / latest_card_prices. We just record every delivery so
-- we can measure cadence, payload size, which events fire, and whether our
-- signature secret verifies — BEFORE designing the real-time pipeline.

CREATE TABLE IF NOT EXISTS public.webhook_events_log (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  source         TEXT NOT NULL DEFAULT 'scrydex',
  event_name     TEXT,
  expansion_count INT,
  expansion_ids  JSONB,
  sig_valid      BOOLEAN,
  sig_reason     TEXT,
  raw            JSONB
);
CREATE INDEX IF NOT EXISTS idx_wel_received ON public.webhook_events_log (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_wel_event ON public.webhook_events_log (event_name, received_at DESC);

-- Locked down like the other internal logs: written only by the edge fn
-- (service role bypasses RLS), readable by admins for analysis.
ALTER TABLE public.webhook_events_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "webhook_events_log admin read" ON public.webhook_events_log;
CREATE POLICY "webhook_events_log admin read" ON public.webhook_events_log
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));
GRANT SELECT, INSERT ON public.webhook_events_log TO service_role;

NOTIFY pgrst, 'reload schema';
