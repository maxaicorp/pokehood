-- ============================================================================
-- LAUNCH READINESS CHECK  (read-only, zero credits — run in the SQL editor)
-- ----------------------------------------------------------------------------
-- One paste → a PASS/WARN/FAIL verdict for every critical system. It does NOT
-- just check "table has rows" — it CALLS the exact RPCs the frontend uses, so
-- a PASS means the real read path works. Run all 3 queries below.
-- FAIL = launch-blocking. WARN = look, but usually data still filling in.
-- ============================================================================

-- ── QUERY 1 — data + every read RPC ─────────────────────────────────────────
WITH r AS (
  SELECT 1 AS ord, 'MARKET' AS area, 'latest_card_prices fresh (<30h)' AS chk,
         CASE WHEN now()-max(updated_at) < interval '30 hours' THEN 'PASS' ELSE 'FAIL' END AS status,
         'age=' || round(extract(epoch FROM now()-max(updated_at))/3600,1) || 'h' AS detail
  FROM latest_card_prices WHERE card_id NOT LIKE 'sealed-%'
  UNION ALL SELECT 2,'MARKET','card rows >= 20k',
         CASE WHEN count(*)>=20000 THEN 'PASS' ELSE 'WARN' END, count(*)||' cards'
  FROM latest_card_prices WHERE card_id NOT LIKE 'sealed-%'
  UNION ALL SELECT 3,'MARKET','24h delta coverage >= 90%',
         CASE WHEN count(*) FILTER (WHERE price_1d IS NOT NULL)::numeric/NULLIF(count(*),0) >= 0.9 THEN 'PASS' ELSE 'WARN' END,
         round(100.0*count(*) FILTER (WHERE price_1d IS NOT NULL)/NULLIF(count(*),0),1)||'% have 1d'
  FROM latest_card_prices WHERE card_id NOT LIKE 'sealed-%'
  UNION ALL SELECT 4,'MARKET','RPC get_latest_price_page',
         CASE WHEN (SELECT count(*) FROM get_latest_price_page(5,0,NULL,'desc',false))>0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM get_latest_price_page(5,0,NULL,'desc',false))||' rows'
  UNION ALL SELECT 5,'MARKET','RPC get_all_latest_prices',
         CASE WHEN (SELECT count(*) FROM get_all_latest_prices(5,0))>0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM get_all_latest_prices(5,0))||' rows'
  UNION ALL SELECT 6,'MARKET','RPC get_filter_summary',
         CASE WHEN (SELECT count(*) FROM get_filter_summary(NULL,500))>0 THEN 'PASS' ELSE 'FAIL' END,'ok'
  UNION ALL SELECT 7,'SEARCH','RPC search_catalog(charizard)',
         CASE WHEN (SELECT count(*) FROM search_catalog('charizard',5))>0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM search_catalog('charizard',5))||' hits'
  UNION ALL SELECT 8,'SEALED','sealed rows in read cache',
         CASE WHEN count(*)>0 THEN 'PASS' ELSE 'FAIL' END, count(*)||' sealed'
  FROM latest_card_prices WHERE card_id LIKE 'sealed-%'
  UNION ALL SELECT 9,'SEALED','sealed_products catalog',
         CASE WHEN count(*)>0 THEN 'PASS' ELSE 'WARN' END, count(*)||' products'
  FROM sealed_products
  UNION ALL SELECT 10,'GRADED','latest_graded_prices fresh (<30h)',
         CASE WHEN now()-max(updated_at) < interval '30 hours' THEN 'PASS' ELSE 'FAIL' END,
         'age='||round(extract(epoch FROM now()-max(updated_at))/3600,1)||'h, '||count(*)||' rows'
  FROM latest_graded_prices
  UNION ALL SELECT 11,'ONCHAIN','CC listings (collector_crypt_cc)',
         CASE WHEN count(*)>500 THEN 'PASS' ELSE 'WARN' END, count(*)||' listed'
  FROM onchain_listings WHERE collection='collector_crypt_cc' AND delisted_at IS NULL
  UNION ALL SELECT 12,'ONCHAIN','ME listings (collector_crypt)',
         CASE WHEN count(*)>0 THEN 'PASS' ELSE 'WARN' END, count(*)||' listed'
  FROM onchain_listings WHERE collection='collector_crypt' AND delisted_at IS NULL
  UNION ALL SELECT 13,'ONCHAIN','activity feed recent (<2h)',
         CASE WHEN now()-to_timestamp(max(block_time)) < interval '2 hours' THEN 'PASS' ELSE 'WARN' END,
         'latest='||to_timestamp(max(block_time))::date
  FROM onchain_activities WHERE collection='collector_crypt'
  UNION ALL SELECT 14,'ONCHAIN','RPC get_onchain_listings(cc)',
         CASE WHEN (SELECT count(*) FROM get_onchain_listings('collector_crypt_cc','price-asc',5,0))>0 THEN 'PASS' ELSE 'FAIL' END,'ok'
  UNION ALL SELECT 15,'ONCHAIN','RPC get_onchain_activity',
         CASE WHEN (SELECT count(*) FROM get_onchain_activity('collector_crypt',NULL,5,0))>0 THEN 'PASS' ELSE 'FAIL' END,'ok'
  UNION ALL SELECT 16,'ONCHAIN','RPC get_onchain_top_sales(30d)',
         CASE WHEN (SELECT count(*) FROM get_onchain_top_sales('collector_crypt',30,0,5))>0 THEN 'PASS' ELSE 'WARN' END,'ok'
  UNION ALL SELECT 17,'DISCOVERY','cc_discovery_results populated',
         CASE WHEN count(*)>0 THEN 'PASS' ELSE 'WARN' END, count(*)||' rows'
  FROM cc_discovery_results
)
SELECT area, chk AS check, status, detail FROM r ORDER BY (status='PASS'), ord;

-- ── QUERY 2 — every expected cron present? ──────────────────────────────────
WITH expected(jobname) AS (VALUES
  ('daily-snapshot-prices'),('weekly-snapshot-prices-full'),('daily-snapshot-sealed'),
  ('refresh-latest-prices-daily'),('ingest-cc-marketplace-10m'),('ingest-cc-native-5m'),
  ('ingest-onchain-activity-60s'),('ingest-onchain-listings-2m'),('daily-health-check'))
SELECT e.jobname,
       CASE WHEN j.jobname IS NULL THEN '❌ MISSING' ELSE '✅ '||j.schedule END AS status
FROM expected e LEFT JOIN cron.job j USING (jobname)
ORDER BY (j.jobname IS NOT NULL), e.jobname;

-- ── QUERY 3 — privacy RLS enforced (exactly 1 SELECT policy per table) ──────
SELECT tablename, count(*) AS select_policies,
       CASE WHEN count(*)=1 THEN 'PASS' ELSE 'CHECK' END AS status
FROM pg_policies
WHERE schemaname='public' AND cmd='SELECT'
  AND tablename IN ('profiles','collection_cards','user_links')
GROUP BY tablename ORDER BY tablename;
