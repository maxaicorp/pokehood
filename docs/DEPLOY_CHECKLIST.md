# One-shot deploy checklist (when Lovable credits reset)

Lovable Cloud = managed backend. **Frontend auto-deploys on every git commit.**
**Edge functions deploy ONLY when you ask the Lovable agent** (no UI button, no CLI/
Actions — those need a Supabase token Lovable Cloud doesn't expose). Migrations you
apply yourself in the SQL editor.

## 1. Tell the Lovable agent (chat):
> Deploy the latest edge functions to Cloud: **snapshot-prices, snapshot-sealed,
> health-check, ingest-cc-native, cc-discovery-run** (and ingest-cc-marketplace if
> added). The code is already in the repo — just redeploy them to Supabase.

## 2. Apply any migrations not yet run (SQL editor → paste → Run):
- [x] `20260528120000_sealed_products_catalog.sql` — sealed catalog table (done)
- [x] `20260529120000_filter_merch.sql` — merch filter RPCs (done)
- [x] graded refresh: `SELECT refresh_latest_card_prices(); SELECT refresh_latest_graded_prices();` (done)
- [x] cron switched to full-daily; dead 401 jobs removed (done)
- [ ] **`20260511000000_privacy_respecting_rls.sql`** — ⚠️ NOT YET RUN. Enforces the `is_published` profile toggle at the DB layer (profiles/collection_cards/user_links SELECT now require `is_published = true OR owner`). Until this runs, a raw anon-key `curl` can still read any private profile's collection. The React-layer gate (Profile.tsx) is live on frontend deploy, but this migration is the real enforcement — run it.

## 3. Post-deploy verification (ping Claude to run these):
- [ ] `snapshot-prices` response shows `"version":"2026-05-28-phase2-coverage-guard"` → Phase 2 live
- [ ] `ingest-cc-native` returns a JSON summary (not 404) → CC sales ingest live
- [ ] Trigger `snapshot-sealed {force:true}` → confirms catalog_upserted (sealed catalog fresh)
- [ ] Trigger `ingest-cc-native {sigLimit:1000}` once → backfill CC sales, then add its 5-min cron
- [ ] Run `cc-discovery-run` from /admin → undervalued board populates (matched/undervalued counts)

## 4. New crons to add after deploy (SQL editor):
```sql
-- CC native sales every 5 min
SELECT cron.schedule('ingest-cc-native-5m','*/5 * * * *',$$
  SELECT net.http_post(url:='https://cmthndfrvnlyfxgxqjkm.supabase.co/functions/v1/ingest-cc-native',
    headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret','CharlieDemon333'),
    body:='{}'::jsonb); $$);
```

## Verify deployed code anytime
Re-ping `snapshot-prices` (chunk, 1 page) and check for the `version` field — its
presence = the new code is live. Absence = still old code (deploy didn't happen).
