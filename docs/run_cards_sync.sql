-- Fill the `cards` catalog (the fix for the slow/freezing search).
-- PREREQ: Lovable must redeploy the `sync-cards-catalog` edge function first
-- (it now dedups ids + runs in the background). Verify version is
-- "2026-06-04-dedup-ids".

-- 1) Kick off the sync. It runs in the background now, so this returns instantly.
SELECT net.http_post(
  url := 'https://cmthndfrvnlyfxgxqjkm.supabase.co/functions/v1/sync-cards-catalog',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','CharlieDemon333'),
  body := '{}'::jsonb,
  timeout_milliseconds := 5000
);

-- 2) Wait ~2-3 minutes, then check it filled (run a few times; it climbs):
SELECT count(*) AS total, count(rarity) AS with_rarity, max(updated_at) AS last_write
FROM public.cards;
-- Expect ~23,000 total once finished. Once total >= the static index count,
-- the site auto-switches off the 9.9MB all-cards.json -> search freeze gone,
-- Explore lists vintage, header rarity search + artist filter unblock.
