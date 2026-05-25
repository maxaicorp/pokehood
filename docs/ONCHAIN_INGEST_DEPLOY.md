# Onchain Ingest Architecture — Lovable Deploy Instructions

This refactors `/onchain` from "live API hit on every page load" to
"backend cron ingests → DB → frontend reads from DB". Mirrors the existing
`price_snapshots → latest_card_prices → Market` pattern.

## What ships in this PR

### Database
- **Migration**: `supabase/migrations/20260524230000_onchain_ingest_tables.sql`
  - New tables: `onchain_activities`, `onchain_listings`, `nft_names`
  - New RPCs: `get_onchain_activity`, `get_onchain_listings`, `get_onchain_top_sales`
  - All indexes designed for the read patterns (newest-first activity, both directions of price sort, USD-desc within time window)
  - RLS: public read everywhere, service-role writes only

### Edge functions
- **NEW** `supabase/functions/ingest-onchain-activity` — cron worker. Hits ME `/activities` + Helius `getAssetBatch`, computes USD via Jupiter/Pyth, upserts to `onchain_activities` + `nft_names`. Requires `CRON_SECRET` header.
- **NEW** `supabase/functions/ingest-onchain-listings` — cron worker. Snapshots ME `/listings` per collection, upserts active rows, soft-deletes (sets `delisted_at`) any active row missing from the snapshot. Requires `CRON_SECRET`.
- **NEW** `supabase/functions/onchain-top-sales` — public read. Returns top 50 sales by USD value in a 1/7/30 day window.
- **REWRITTEN** `supabase/functions/onchain-activity` — was a live ME+Helius proxy, now a thin SELECT from `onchain_activities`. Same response shape, frontend needs no changes.
- **REWRITTEN** `supabase/functions/onchain-listings` — was a live ME proxy, now a thin SELECT from `onchain_listings`. Same response shape.

### Health + admin
- `health-check` gained two new probes: `onchain_activity_freshness`, `onchain_listings_freshness`.
- `/admin/functions` page gained probes for `onchain-top-sales`, `ingest-onchain-activity`, `ingest-onchain-listings`.

### Frontend
- `Onchain.tsx` Top Sales tab rebuilt: 1d / 7d / 30d pills, leaderboard layout with rank badges (gold/silver/bronze), USD-primary pricing.
- Sitemap updated to include `/onchain/top-sales`.

---

## Deploy steps (Lovable)

### 1. Apply the migration

The migration file is already in `supabase/migrations/`. Lovable should apply it automatically on the next push. If it doesn't, run it manually in the Supabase SQL editor.

### 2. Confirm secrets exist in Supabase

Required env vars on every onchain function:
- `SUPABASE_URL` (auto-injected)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-injected)
- `CRON_SECRET` (already set per previous deploy — used by ingest functions for auth)
- `HELIUS_API_KEY` (already set — used by `ingest-onchain-activity` only)

No new secrets needed.

### 3. Schedule the two new crons

Run this in the Supabase SQL editor. **`<CRON_SECRET>`** = the value already in `vault.decrypted_secrets` (Lovable can substitute).

```sql
-- Activity ingest: every 60 seconds
SELECT cron.schedule(
  'ingest-onchain-activity-60s',
  '* * * * *',  -- every minute
  $$
  SELECT net.http_post(
    url:='https://<PROJECT_REF>.supabase.co/functions/v1/ingest-onchain-activity',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body:='{}'::jsonb
  );
  $$
);

-- Listings ingest: every 2 minutes
SELECT cron.schedule(
  'ingest-onchain-listings-2m',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url:='https://<PROJECT_REF>.supabase.co/functions/v1/ingest-onchain-listings',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body:='{}'::jsonb
  );
  $$
);
```

If `current_setting('app.cron_secret', true)` doesn't resolve, substitute the literal secret value (this is the same pattern the existing snapshot crons use).

### 4. Backfill the tables

Once the crons exist, the tables fill organically as time passes. To kick-start a faster backfill (so the page isn't empty for the first few minutes), manually trigger each ingest once with a wider page window:

```bash
# Activity: pull 5 pages = ~2500 events
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/ingest-onchain-activity \
  -H "x-cron-secret: <CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"pageLimit": 5}'

# Listings: pull 10 pages = ~1000 listings (covers full active set)
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/ingest-onchain-listings \
  -H "x-cron-secret: <CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"maxPages": 10}'
```

### 5. Verify

After ~2 minutes:
- `/admin/functions` should show green for `onchain-activity`, `onchain-listings`, `onchain-top-sales`
- `/admin/health` should show `onchain_activity_freshness` and `onchain_listings_freshness` both green
- `/onchain/activity`, `/onchain/marketplace`, `/onchain/top-sales` should load with data

---

## Architecture summary

```
                     ┌──────────────────────┐
                     │   pg_cron (Postgres) │
                     └──────────┬───────────┘
                                │ POST every 60s/2m
                                ▼
        ┌─────────────────────────────────────────────────┐
        │  ingest-onchain-activity   ingest-onchain-listings │
        │       │                            │              │
        │  Magic Eden + Helius        Magic Eden            │
        │  + Jupiter/Pyth SOL/USD     + Jupiter/Pyth        │
        │       │                            │              │
        │  UPSERT onchain_activities  UPSERT onchain_listings│
        │  UPSERT nft_names           (soft-delete missing) │
        └─────────────────────────────────────────────────┘
                                │
                                ▼
                  ┌──────────────────────────┐
                  │   Supabase Postgres      │
                  │  onchain_activities      │
                  │  onchain_listings        │
                  │  nft_names               │
                  └──────────┬───────────────┘
                             │ SELECT (indexed)
                             ▼
        ┌─────────────────────────────────────────────┐
        │  onchain-activity     onchain-listings      │
        │  onchain-top-sales                          │
        │  (15-60s edge cache, no upstream API hit)   │
        └─────────────┬───────────────────────────────┘
                      │
                      ▼
                  Browser /onchain/*
```

### Why this is a win

- **Cost**: API spend is now fixed regardless of traffic. Previously every page load + 30s poll triggered a fresh ME + Helius round-trip.
- **Reliability**: ME outage no longer blank-screens the page — users see the last-ingested state until the cron catches up.
- **Speed**: Reads are single indexed SELECT against Postgres, not a remote round-trip to ME + Helius (which previously meant 500-2000ms latency per page load).
- **DB-side sort/filter**: Top Sales by USD across a time window, "sort listings desc" without the offset-from-end gymnastics — all native SQL.
- **Historical data**: We now accumulate sales history. All-time leaderboards, weekly/monthly volume, etc. become trivial once data builds up.
- **PSA-ready**: `nft_names` already has a `cert_number` column. The Helius enrichment populates it from NFT metadata, so the PSA flow can layer on without any new schema.

### Future hooks
- `nft_names.cert_number` → PSA cert lookup edge function for grade/year/subject enrichment.
- `onchain_activities` historical → "All-time top sales" tab (free byproduct, just remove the window filter).
- `onchain_listings.delisted_at` → "Average days listed" / "Sell-through rate" analytics.
