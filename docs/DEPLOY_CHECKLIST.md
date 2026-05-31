# One-shot deploy checklist (when Lovable credits reset)

Lovable Cloud = managed backend. **Frontend auto-deploys on every git commit.**
**Edge functions deploy ONLY when you ask the Lovable agent** (no UI button, no CLI/
Actions — those need a Supabase token Lovable Cloud doesn't expose). Migrations you
apply yourself in the SQL editor.

## 1. Tell the Lovable agent (chat):
> Deploy the latest edge functions to Cloud: **snapshot-prices, snapshot-sealed,
> health-check, ingest-cc-native, cc-discovery-run** (and ingest-cc-marketplace if
> added). The code is already in the repo — just redeploy them to Supabase.

✅ DONE 2026-05-30 — all 6 deployed (snapshot-prices, snapshot-sealed, health-check,
ingest-cc-native, ingest-cc-marketplace, cc-discovery-run). sync-cards-catalog skipped
(Phase 4b not active). CC crons scheduled (ingest-cc-native-5m, ingest-cc-marketplace-10m)
+ one-time sales backfill dispatched.

## 2. Apply any migrations not yet run (SQL editor → paste → Run):
- [x] `20260528120000_sealed_products_catalog.sql` — sealed catalog table (done)
- [x] `20260529120000_filter_merch.sql` — merch filter RPCs (done)
- [x] graded refresh: `SELECT refresh_latest_card_prices(); SELECT refresh_latest_graded_prices();` (done)
- [x] cron switched to full-daily; dead 401 jobs removed (done)
- [x] **`20260530140000_search_catalog.sql`** — DONE (2026-05-30). pg_trgm + `search_catalog` RPC; DB-backed, typo-tolerant, includes sealed; excludes `::variant` rows. Verified `search_catalog('charizard',5)` returns 5 distinct Charizards, clean images.
- [x] **`20260530120000_collection_cards_unique.sql`** — DONE (2026-05-30). Dedupe + `collection_cards_uniq` index live. (Frontend still lookup-then-insert; can switch to upsert(onConflict) now that the index exists — minor follow-up.)
- [x] **`20260511000000_privacy_respecting_rls.sql`** — DONE (2026-05-30). Verified: each of profiles/collection_cards/user_links has exactly ONE SELECT policy (the restrictive published-or-owner one), no leftover permissive policy. Private profiles now enforced at the DB.

## 3. Post-deploy verification (ping Claude to run these):
- [ ] `snapshot-prices` response shows `"version":"2026-05-28-phase2-coverage-guard"` → Phase 2 live
- [ ] `ingest-cc-native` returns a JSON summary (not 404) → CC sales ingest live
- [ ] Trigger `snapshot-sealed {force:true}` → confirms catalog_upserted (sealed catalog fresh)
- [ ] Trigger `ingest-cc-native {sigLimit:1000}` once → backfill CC sales, then add its 5-min cron
- [ ] Run `cc-discovery-run` from /admin → undervalued board populates (matched/undervalued counts)

## ⚠️ CRON AUDIT 2026-05-30 — `snapshot-prices` was NOT scheduled
`SELECT jobname FROM cron.job` showed: ingest-onchain-listings-2m, daily-health-check,
daily-snapshot-sealed, ingest-cc-native-5m, ingest-cc-marketplace-10m — but **no
`snapshot-prices` cron** (the core card-pricing pipeline) and **no
`ingest-onchain-activity`**. Sealed was scheduled, card prices were not → prices
would drift stale (the recurring "prices vanish" failure mode). Added:
```sql
SELECT cron.schedule('daily-snapshot-prices','0 6 * * *',$$ SELECT net.http_post(url:='https://cmthndfrvnlyfxgxqjkm.supabase.co/functions/v1/snapshot-prices',headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret','CharlieDemon333'),body:='{}'::jsonb); $$);
SELECT cron.schedule('weekly-snapshot-prices-full','0 5 * * 0',$$ SELECT net.http_post(url:='https://cmthndfrvnlyfxgxqjkm.supabase.co/functions/v1/snapshot-prices',headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret','CharlieDemon333'),body:='{"mode":"full"}'::jsonb); $$);
SELECT cron.schedule('ingest-onchain-activity-60s','* * * * *',$$ SELECT net.http_post(url:='https://cmthndfrvnlyfxgxqjkm.supabase.co/functions/v1/ingest-onchain-activity',headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret','CharlieDemon333'),body:='{}'::jsonb); $$);
```
**Always re-check `cron.job` after any backend change — a missing snapshot-prices cron is the #1 cause of stale prices.**

## 4. New crons to add after deploy (SQL editor):
```sql
-- CC native sales every 5 min
SELECT cron.schedule('ingest-cc-native-5m','*/5 * * * *',$$
  SELECT net.http_post(url:='https://cmthndfrvnlyfxgxqjkm.supabase.co/functions/v1/ingest-cc-native',
    headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret','CharlieDemon333'),
    body:='{}'::jsonb); $$);
```

## After cards catalog is populated → do Phase 4b (frontend)
Once `sync-cards-catalog` has deployed + run and `SELECT count(*) FROM cards`
returns ~23k:
1. `getCardById` → try `buildCardFromDb` first for non-`::variant` ids (static index only as fallback / for variants).
2. `getSetCards` → DB query on `cards WHERE set_id = ...`, then existing pricing/variant enrichment.
3. `searchCardsAdvanced` → DB text + filter query instead of scanning `all-cards.json`.
4. Then delete `public/data/all-cards.json` (9.9 MB) + the broken sync scripts.
⚠️ Do NOT do this before the table is populated — `buildCardFromDb` falls back to
`latest_card_prices`, which lacks rarity/types/hp, so card detail would lose metadata.

## Verify deployed code anytime
Re-ping `snapshot-prices` (chunk, 1 page) and check for the `version` field — its
presence = the new code is live. Absence = still old code (deploy didn't happen).
