-- ============================================================================
-- LAUNCH READINESS CHECK  (read-only, zero credits — run in the SQL editor)
-- ----------------------------------------------------------------------------
-- ONE query → a PASS/WARN/FAIL/CHECK verdict for every critical system in a
-- single result table (the SQL editor only shows the LAST statement's output,
-- so everything is unioned into one). It CALLS the exact RPCs the frontend
-- uses — a PASS means the real read path works, not just "table has rows".
-- Non-PASS rows sort to the top. FAIL = launch-blocking. WARN/CHECK = look.
-- ============================================================================
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
  -- CRONS: one row per expected job
  UNION ALL
  SELECT 20, 'CRON', e.jobname,
         CASE WHEN j.jobname IS NULL THEN 'FAIL' ELSE 'PASS' END,
         COALESCE(j.schedule, 'MISSING')
  FROM (VALUES ('daily-snapshot-prices'),('weekly-snapshot-prices-full'),('daily-snapshot-sealed'),
        ('refresh-latest-prices-daily'),('ingest-cc-marketplace-10m'),('ingest-cc-native-5m'),
        ('ingest-onchain-activity-60s'),('ingest-onchain-listings-2m'),('daily-health-check')) e(jobname)
  LEFT JOIN cron.job j ON j.jobname = e.jobname
  -- RLS: exactly 1 SELECT policy per user table = privacy enforced
  UNION ALL
  SELECT 30, 'RLS', tablename,
         CASE WHEN count(*)=1 THEN 'PASS' ELSE 'CHECK' END,
         count(*)||' select policy(s)'
  FROM pg_policies
  WHERE schemaname='public' AND cmd='SELECT'
    AND tablename IN ('profiles','collection_cards','user_links')
  GROUP BY tablename
)
SELECT area, chk AS check, status, detail
FROM r
ORDER BY (status='PASS'), ord, chk;
