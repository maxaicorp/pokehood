-- ============================================================================
-- GRADED DATA DIAGNOSTIC  (read-only, ZERO Scrydex credits — SQL editor)
-- ----------------------------------------------------------------------------
-- Answers one question: is missing graded data a SOURCE gap (Scrydex has no
-- graded sales for the card / the plan doesn't return them) or a PIPELINE gap
-- (Scrydex returns them but we fail to write them)?
--
-- Data flow being checked:
--   snapshot-prices (daily full) → graded_price_snapshots → latest_graded_prices
--   → get_graded_tiles_for_card RPC → the Graded Prices tiles on a card page
-- ============================================================================

-- ── 1. COVERAGE SUMMARY ─────────────────────────────────────────────────────
-- Run this block first. It tells you how much graded data exists overall.
SELECT 'graded rows (latest_graded_prices)' AS metric, count(*)::text AS value
  FROM latest_graded_prices
UNION ALL SELECT 'distinct cards WITH graded data',
  count(DISTINCT card_id)::text FROM latest_graded_prices WHERE market > 0
UNION ALL SELECT 'priced cards (denominator)',
  count(*)::text FROM latest_card_prices WHERE card_id NOT LIKE 'sealed-%'
UNION ALL SELECT 'GRADED COVERAGE %',
  round(100.0 * (SELECT count(DISTINCT card_id) FROM latest_graded_prices WHERE market > 0)
    / NULLIF((SELECT count(*) FROM latest_card_prices WHERE card_id NOT LIKE 'sealed-%'), 0), 1)::text
UNION ALL SELECT 'graded freshness (max updated_at)',
  COALESCE(max(updated_at)::text, 'NONE') FROM latest_graded_prices
UNION ALL SELECT 'PSA 10 cards priced',  count(*)::text FROM latest_graded_prices WHERE company='PSA' AND grade=10 AND market>0
UNION ALL SELECT 'PSA 9 cards priced',   count(*)::text FROM latest_graded_prices WHERE company='PSA' AND grade=9  AND market>0
UNION ALL SELECT 'BGS 10 cards priced',  count(*)::text FROM latest_graded_prices WHERE company='BGS' AND grade=10 AND market>0
UNION ALL SELECT 'CGC 10 cards priced',  count(*)::text FROM latest_graded_prices WHERE company='CGC' AND grade=10 AND market>0
ORDER BY 1;

-- INTERPRETATION:
--   COVERAGE ~0-2%   → SOURCE gap. Scrydex plan/response isn't returning graded
--                      prices for the catalog. No backfill from Scrydex possible
--                      until the plan tier includes graded data. (Verify with
--                      block 3 below on a KNOWN-graded vintage card like base1-4.)
--   COVERAGE healthy → PIPELINE is working. A specific card showing blanks just
--                      has no graded sales in Scrydex yet (common for brand-new
--                      2025 chase cards). Nothing to backfill — it fills in as
--                      the graded market forms + daily snapshots run.


-- ── 2. CHECK THE SPECIFIC CARD ──────────────────────────────────────────────
-- Grab the card_id from the URL (the /card/:id form, or the last path segment).
-- For the screenshot card, find it by name instead:
SELECT card_id, card_name, set_name FROM latest_card_prices
 WHERE card_name ILIKE '%charizard%' AND set_name ILIKE '%mega%'  -- adjust as needed
 ORDER BY card_id LIMIT 25;

-- Then paste the card_id here to see what graded data (if any) we hold:
-- SELECT * FROM latest_graded_prices WHERE card_id = 'PASTE_CARD_ID';


-- ── 3. SANITY CHECK ON A CARD THAT *SHOULD* HAVE GRADED DATA ─────────────────
-- base1-4 = Base Set Charizard, the most-graded card in the hobby. If THIS has
-- no graded rows, the source/plan is the problem (not per-card thin data).
SELECT card_id, company, grade, market, low, high, currency, updated_at
  FROM latest_graded_prices
 WHERE card_id = 'base1-4'
 ORDER BY company, grade DESC;


-- ── 4. PIPELINE LIVENESS — did the latest snapshot write ANY graded rows? ────
-- If graded_price_snapshots has recent rows but latest_graded_prices is stale,
-- the refresh step (not the fetch) is the gap.
SELECT max(recorded_at) AS latest_graded_snapshot,
       count(*)          AS rows_on_latest_day
  FROM graded_price_snapshots
 WHERE recorded_at = (SELECT max(recorded_at) FROM graded_price_snapshots);


-- ============================================================================
-- DIAGNOSIS (2026-05-31): block 4 returned 47,120 graded rows written TODAY,
-- but the tiles were blank → graded_price_snapshots is fresh, latest_graded_prices
-- is STALE. Root cause: refresh_latest_graded_prices() was only called at the
-- END of the snapshot edge fn (partial-prone), never added to the dedicated
-- refresh-latest-prices-daily cron the way refresh_latest_card_prices() was.
-- Same bug class as the 47h raw-price freeze. See project_refresh_cron_fix.
-- ============================================================================

-- FIX 1 — repopulate the read cache now (safe, zero credits, no contamination):
SELECT public.refresh_latest_graded_prices();

-- FIX 2 — permanent: make the dedicated cron refresh BOTH caches so the graded
-- cache can never drift from the snapshot table again. Upserts by jobname.
SELECT cron.schedule(
  'refresh-latest-prices-daily',
  '0 7 * * *',
  $$SELECT public.refresh_latest_card_prices(); SELECT public.refresh_latest_graded_prices();$$
);

-- Verify the cron now runs both:
-- SELECT jobname, schedule, command FROM cron.job WHERE jobname='refresh-latest-prices-daily';


-- ============================================================================
-- ID RECONCILIATION (zero credits — no Scrydex API needed; the ids Scrydex
-- gave us are already in the DB). Answers: is the graded gap an ID MISMATCH
-- (orphaned ids) or just COVERAGE (fewer cards have graded market data)?
-- ============================================================================

-- 5a. Orphan check: do graded ids line up with the working raw table?
--   graded_orphaned HIGH  → real id mismatch, dig into normalization.
--   graded_orphaned ~0    → ids are consistent; the gap is pure coverage.
WITH g AS (SELECT DISTINCT card_id FROM latest_graded_prices),
     r AS (SELECT DISTINCT card_id FROM latest_card_prices WHERE card_id NOT LIKE 'sealed-%')
SELECT
  (SELECT count(*) FROM g)                                                   AS graded_ids,
  (SELECT count(*) FROM r)                                                   AS raw_ids,
  (SELECT count(*) FROM g JOIN r USING (card_id))                           AS graded_matched_to_raw,
  (SELECT count(*) FROM g LEFT JOIN r USING (card_id) WHERE r.card_id IS NULL) AS graded_orphaned;

-- 5b. Per-set graded coverage — the straggler map. Shows, for every set prefix,
--     how many cards have raw prices vs how many ALSO have graded market data.
--     If `me` (Mega) / recent sets show ~0% while vintage shows high %, it's
--     recency/coverage, not a bug. If `base1` shows 0%, it's a real defect.
SELECT split_part(card_id, '-', 1) AS set_prefix,
       count(*)                                  AS raw_cards,
       count(*) FILTER (WHERE has_graded)        AS with_graded,
       round(100.0 * count(*) FILTER (WHERE has_graded) / NULLIF(count(*),0), 0) AS pct
FROM (
  SELECT r.card_id,
         EXISTS (SELECT 1 FROM latest_graded_prices g
                  WHERE g.card_id = r.card_id AND g.market > 0) AS has_graded
  FROM latest_card_prices r
  WHERE r.card_id NOT LIKE 'sealed-%' AND r.card_id NOT LIKE '%::%'
) t
GROUP BY 1
ORDER BY raw_cards DESC
LIMIT 40;
