# Data pipeline hardening plan

**Goal:** make the real architecture match the intended one — *daily snapshot → simple math → frontend* — so data never silently rots again.

Confirmed root causes (my code read + 3 Lovable audit agents agree):
1. **Partial-success pipelines** — a snapshot can fail mid-run, still rebuild the read cache, and report `success`.
2. **Stale derived/read-side caches** — the sealed read-cache is only refreshed by the *card* cron; frontend module caches never expire.
3. **No single data contract / no end-to-end verification** — every stage re-filters; health checks test stage liveness, not the user-visible result.

## The contract (what "fixed" means)
1. The read cache (`latest_card_prices`) only advances on a **verified-complete** run. On a failed page or below-floor coverage, leave last-good data and report `partial`, not `success`.
2. Whoever writes prices refreshes the read cache (sealed cron refreshes too), coverage-guarded.
3. No cache outlives correctness: frontend singletons get a TTL + honor the existing `collectiblez:force-refresh` broadcast.
4. Health checks validate **coverage** and a **real user-visible value**, not just timestamps.

## Phases (ship one at a time, each its own commit)

### Phase 1 — Verification (ZERO production risk, read-only) ← STARTING HERE
Add to `health-check`:
- **Sealed deltas computed** — % of `sealed-%` rows in `latest_card_prices` with `price_1d` populated. (Directly detects the deltas bug we just hit.)
- **End-to-end read probe** — call the *real* read accessors (`get_latest_price_page` RPC for cards; `latest_card_prices` sealed read for sealed) and assert they return rows with a non-null price. Catches read-path filter bugs that stage-level checks miss.
- Surface both in the admin health page.
Deferred to Phase 2 (needs editing the functions anyway): function **version stamps**.

### Phase 2 — The cure: coverage-guarded refresh (backend, write path)
- `snapshot-prices`: track failed pages + expected coverage. Only call `refreshLatestCardPrices` when complete; otherwise keep last-good cache and return `partial`.
- `snapshot-sealed`: add the same coverage-guarded `refreshLatestCardPrices` call (fixes the freshness coupling).
- Each function returns a `version` string; `health-check` flags version drift (catches "old function still running").

### Phase 3 — Frontend cache lifetime
- Give `pricingCache`, `allLatestRowsPromise`, `sealedCache`, `sealedPriceMap` a TTL and wire them to the `collectiblez:force-refresh` localStorage signal so they clear after an update. (Respects the LOCKED no-persistence rule — in-memory only.)

### Phase 4 — Hardening + unify the catalog
- Tighten refresh/RPC permissions (refresh is service-role only; read RPCs minimal).
- Move the catalog (cards, sets) into DB tables populated by the cron, like `sealed_products` — eliminates the static JSON files and the dead-anon-key scripts so new sets appear automatically.

## Status
- [x] Phase 1 — verification (end-to-end read probe + sealed delta coverage)
- [x] Phase 2 — coverage-guarded refresh, page retries, credit pre-flight, version stamps; **only the full run prunes, and only when complete** (so a partial run can never delete middle-card history); snapshot-sealed now refreshes the read cache itself
- [ ] Phase 3 — frontend cache lifetime
- [ ] Phase 4 — hardening + catalog-to-DB

### A known limitation (by design)
Daily/full/sets run in the background and return HTTP 202 immediately, so the
*HTTP response* always says `success: true` — the real partial/complete outcome
is in the logs and is what gates the prune/refresh. Detection of a bad run is
the health-check's job (end-to-end read + coverage + run-history thresholds),
not the 202 response.
