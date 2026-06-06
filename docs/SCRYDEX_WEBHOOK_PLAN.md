# Scrydex Webhooks → real-time price pipeline (implementation plan)

**Goal:** replace the credit-burning daily *polling* (snapshot-chunk crons hitting
all ~197 sets) with Scrydex **webhooks** that push us only the expansions that
changed — real-time, fewer credits. Runs *alongside* the existing pipeline first,
zero downtime, easy rollback.

---

## Verified facts (from `docs/scrydex/README.md`, 2026-06-06)

- **Webhook payload is a NOTIFICATION, not data** — it only lists changed
  expansions:
  ```json
  { "id": "...", "name": "pokemon.expansions.prices.raw_updated",
    "data": { "expansion_ids": ["sv8pt5", "me1", ...] } }
  ```
- **Events:** `pokemon.expansions.prices.raw_updated`,
  `pokemon.expansions.prices.graded_updated`,
  `pokemon.expansions.pop_reports.updated`.
- **Fetch a changed expansion's cards:**
  `GET /pokemon/v1/expansions/{id}/cards?include=prices&page_size=100&page=N`
  (paginated, max 100/page; same `q/select/include` params as `/cards`).
- **Prices live at** `card.variants[].prices[]` — raw NM = `type:"raw"`,
  `condition:"NM"`, `!is_perfect`, with `market` + `trends`. (Same parser we built
  in `backfill-price-history`'s `trendAnchorsByVariant`.)
- **Auth headers** (for the fetch): `X-Api-Key`, `X-Team-ID: collectiblez` (lowercase).
- **Signature:** `X-Scrydex-Signature: t=<unix>,v1=<hmac>`. HMAC-SHA256 of
  `` `${t}.${rawBody}` `` with the `whsec_…` secret. Use the **raw bytes** of the
  body (minified UTF-8 — never re-stringify). Reject if `t` is >5 min old.
- **Timing:** respond **2xx within <2s** (hard timeout 10s). Scrydex **retries 4×**
  with backoff on non-2xx → our ingest must be **idempotent** (it is: upsert on
  `card_id,recorded_at`).

---

## Architecture

```
Scrydex --POST--> [scrydex-webhook edge fn]
                    1. read RAW body
                    2. verify HMAC sig (+ 5-min replay window)
                    3. return 200 immediately  (<2s)
                    4. EdgeRuntime.waitUntil( ingest(expansion_ids) )
                         for each expansion_id:
                           GET /expansions/{id}/cards?include=prices  (paginate)
                           parse raw-NM market from variants[].prices
                           upsert -> price_snapshots (recorded_at = today)
                         then refresh_latest_card_prices() (+ graded)
```

What **stays** (unchanged): `price_snapshots`, `latest_card_prices`, the read path
(`get_latest_price_page`), the chart, deltas, graded, overrides. Only the **intake**
changes.

---

## Build steps (when we resume)

### Phase 1 — the edge function `supabase/functions/scrydex-webhook/index.ts`
- [ ] Public endpoint (NO JWT gate — secured by HMAC). Handle `OPTIONS`.
- [ ] `const raw = await req.text()` FIRST (need raw body for the signature).
- [ ] Parse `X-Scrydex-Signature` → `t`, `v1`. Compute
      `HMAC_SHA256(secret, `${t}.${raw}`)` via Web Crypto (`crypto.subtle`),
      hex-encode, **constant-time compare** to `v1`. Reject 401 on mismatch.
- [ ] Reject if `Math.abs(now - t) > 300s` (replay protection).
- [ ] `JSON.parse(raw)` → `body.data.expansion_ids`. If event isn't a pokemon
      prices event we care about, 200 + ignore.
- [ ] **Return 200 NOW**, then `EdgeRuntime.waitUntil(ingest(ids))`.
- [ ] `ingest(ids)`: dedupe ids; for each, page through
      `/pokemon/v1/expansions/{id}/cards?include=prices&page_size=100`; build
      `price_snapshots` rows (id, card_name, set_name, price=rawNM.market,
      recorded_at=today) using the `variants[].prices` raw-NM parser; upsert in
      batches (onConflict `card_id,recorded_at`); then
      `supabase.rpc("refresh_latest_card_prices")` (+ `refresh_latest_graded_prices`
      if graded events are subscribed).
- [ ] Env: `SCRYDEX_WEBHOOK_SECRET` (the `whsec_…`), plus existing
      `SCRYDEX_API_KEY` / `SCRYDEX_TEAM_ID`, `SUPABASE_URL`,
      `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Log a summary (expansions, cards upserted, credits used) for `cron.job`-style
      visibility.

### Phase 2 — deploy + register
- [ ] Deploy `scrydex-webhook` via Lovable. URL =
      `https://cmthndfrvnlyfxgxqjkm.supabase.co/functions/v1/scrydex-webhook`.
- [ ] Add `SCRYDEX_WEBHOOK_SECRET` to Supabase function env (get the `whsec_…`
      from Scrydex when creating the webhook).
- [ ] In Scrydex dashboard → **Add Webhook**: paste the URL, subscribe to
      `pokemon.expansions.prices.raw_updated` (+ `graded_updated`, `pop_reports`
      optional). Save → copy the signing secret into the env var above.

### Phase 3 — verify (run ALONGSIDE existing crons)
- [ ] Trigger a test delivery (Scrydex dashboard "send test" if available, or wait
      for a real price update). Check the function logs: signature verified,
      expansions ingested, rows upserted, `latest_card_prices` refreshed.
- [ ] Confirm `max(recorded_at)` in `latest_card_prices` tracks updates in
      real-ish time (use `docs/PRICE_FRESHNESS_CHECK.sql`).

### Phase 4 — retire polling (only after Phase 3 is solid for a few days)
- [ ] Reduce/disable the `snapshot-chunk-1..6` crons. Keep **one** daily snapshot
      (or `verify-and-heal`) as a safety net + the daily refresh.
- [ ] Confirm credit usage drops and prices stay fresh.

---

## Open questions to resolve during the build
- **Exact event name:** sample showed `...expansions.prices_updated` (combined);
  the events list shows `.raw_updated` / `.graded_updated` (split). Subscribe to
  both raw + graded; have the handler match on a prefix (`...prices.`/`prices_`).
- **Per-expansion fetch cost:** confirm credits per page (test one expansion via
  the existing `backfill`/a quick curl) so we know the real per-event cost.
- **Burst handling:** a busy update window could fire many webhooks / large
  `expansion_ids` arrays. v1 = process each, idempotent upsert (safe). If it gets
  noisy, add a short debounce or a `webhook_events` queue table + a drain cron.
- **Graded ingest:** decide whether the webhook also feeds the graded cache
  (`refresh_latest_graded_prices`) or that stays on its own path.

## Rollback
Webhooks are additive. If anything misbehaves: delete the webhook in Scrydex (push
stops) and the untouched snapshot crons keep running. No data migration to undo.
