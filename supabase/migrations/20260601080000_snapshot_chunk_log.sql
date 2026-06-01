-- snapshot_chunk_log — one row per chunk run, so the heal can re-run ONLY the
-- chunks that came up short instead of re-pulling the whole catalog.
--
-- Each of the six snapshot-chunk-* crons calls snapshot-prices {mode:"chunk",
-- startPage, pageLimit}. At the end of its background work the chunk stamps a
-- row here: which page range it owned, how many pages it processed, and whether
-- it finished cleanly (complete = no hard page failure).
--
-- This catches BOTH ways a chunk falls short:
--   • hard page failure → it writes a row with complete=false
--   • killed / timed out before finishing → it writes NO row at all
-- The heal treats "no complete=true row today for an expected chunk" as
-- "re-run this chunk" — covering both cases with one rule.
CREATE TABLE IF NOT EXISTS public.snapshot_chunk_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at          timestamptz NOT NULL DEFAULT now(),
  recorded_date   date        NOT NULL DEFAULT current_date,
  start_page      int         NOT NULL,
  page_limit      int         NOT NULL,
  pages_processed int         NOT NULL DEFAULT 0,
  complete        boolean     NOT NULL DEFAULT false,
  version         text
);

-- The heal queries "today's complete chunks by start_page", so index that.
CREATE INDEX IF NOT EXISTS snapshot_chunk_log_date_page_idx
  ON public.snapshot_chunk_log (recorded_date, start_page);

ALTER TABLE public.snapshot_chunk_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.snapshot_chunk_log TO service_role;

-- Housekeeping: keep ~30 days of chunk history. Cheap to call from the weekly
-- prune cron, or ignore — the table is tiny (≤ ~6 rows/day normally).
-- DELETE FROM public.snapshot_chunk_log WHERE recorded_date < current_date - 30;
