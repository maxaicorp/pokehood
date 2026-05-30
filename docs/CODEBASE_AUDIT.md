# Codebase audit & simplification plan — "rocket v2"

The site works, but it carries three *different* data-source patterns layered on
top of each other (the wires hanging out). Almost every bug this session traced
back to that. **The v2 thesis: one pattern everywhere — `cron → DB → frontend
reads DB`. Delete the static-file + manual-script half entirely.**

---

## A. Bugs fixed this session (for the record)
1. **"Prices vanish"** — the `weekly-full-price-snapshot` cron authed with `Bearer <anon key>` → **401, never ran**. Middle-numbered cards (only that job refreshes them) aged past 90 days and got pruned by the daily retention sweep. → full-daily cron, dead 401 jobs removed.
2. **Pipeline stalls** — Scrydex **credit cap pinned at 5,000** = old Starter limit; exhausted mid-cycle every month. → raised.
3. **Sealed tab blank deltas** — `get_all_latest_prices` had `WHERE card_id NOT LIKE 'sealed-%'`, starving the sealed price map. → read `latest_card_prices` directly.
4. **New sealed sets invisible** — catalog came from a manual static-JSON script that broke for 7 weeks. → `sealed_products` DB table, cron-upserted.
5. **>1s blank pages** — `all-cards.json` (9.9 MB) fetched with `cache:"no-store"` → re-downloaded every navigation. → `force-cache`; Market/Explore now use the 80 KB `market-sets.json`.
6. **Partial-success snapshots** — a failed Scrydex page still rebuilt the cache + pruned. → coverage-guard + retries + credit pre-flight (Phase 2).
7. **Stale in-memory caches** — module singletons never expired. → TTL + force-refresh invalidation (Phase 3).

## B. Remaining bugs / potential bugs
| Sev | Issue | Fix |
|---|---|---|
| **High** | **CardDetail loads 9.9 MB + "Card not found"** on cold/SEO loads — static catalog staleness | Phase 4 (cards → DB) |
| **High** | **`onchain_listings` will double-list** — after `ingest-cc-marketplace` runs, the same NFT has a ME row *and* a `cc-*` row | Dedup by `token_mint` in `get_onchain_listings` (prefer `cc-*`) |
| Med | **Migrations not replayable from scratch** — ~7 base objects (`profiles`, `collection_cards`, `user_roles`, `app_role`, `has_role`, `update_updated_at_column`) created outside tracked migrations; a couple double-`CREATE`s | Reconcile a baseline migration (also unblocks self-hosting) |
| Med | **CC API is an undocumented 3rd-party dep** (`api.collectorcrypt.com`) — could change/rate-limit; no caching/alerting | Cache last-good in DB; health-check probe |
| Low | Stripe `create-checkout` trusts client `priceId` (no server allowlist) | Server-side price allowlist |
| Low | `check-subscription` hits Stripe by email every call (no entitlement table) | Entitlement table before scaling |
| Low | Giveaway winner draw uses client `Math.random()` | Server draw if prizes have real value |
| Low | TS strict off, no CI | Turn on; add a lint/typecheck CI gate |

## C. Bloat / dead weight (the wires to tuck in)
| Item | Size/scope | Action |
|---|---|---|
| **`all-cards.json`** | **9.9 MB** | The central bloat → move to DB (Phase 4), then delete |
| `sealed-products.json` | 1.06 MB | Now just a fallback (`sealed_products` table is source) → delete after deploy confirms |
| `public/data/sets/` + `sets-list.json` | 200 files + 40 KB | Legacy TCGdex remnants (referenced in pokemon-api/card-stats/CardSlider as fallbacks) → remove fallbacks + files |
| **Manual sync scripts** | `sync-scrydex-cards.js`, `sync-scrydex-sealed.js`, `build-card-index.js` | **Broken** (stale anon key + obsolete proxy endpoint), superseded by cron→DB → delete after Phase 4 |
| **ME-CC listings ingest** | covers <1% of CC (391 vs ~52k) | CC API supersedes it for listings → retire ME for CC listings; keep ME only if its activity feed adds anything CC-native misses |
| Overlapping FE caches | `pricingCache`, `allLatestRowsPromise`, `sealedCache`, `sealedPriceMap`, `cardmarketAvgs*` | Collapse to read-through once catalog is DB-backed |

## D. Rocket v2 — the simplification
**Single principle: no static catalog, no manual scripts, no client-side megabyte payloads. Everything the frontend renders comes from a DB read.**

**Phase 4 (the keystone): catalog → DB**
- New `cards` table (`id, name, set_id, set_name, number, rarity, supertype, subtypes, types, hp`) — **upserted by `snapshot-prices`**, which already fetches the full card objects (images derived from `card_id`, like sealed). Near-free.
- `getCardById` / `getSetCards` read the DB; **delete `loadCardIndex`, `all-cards.json`, and the 9.9 MB download.**
- Result: CardDetail ~30 ms, no "Card not found," no manual scripts, no staleness — *and* it kills the last static catalog.

**Then consolidate:**
- Delete the static files + the 3 sync scripts.
- Dedup `onchain_listings`; retire the redundant ME-CC ingest.
- Collapse the frontend cache layer (read-through + the Phase-3 TTL only).

## E. Prioritized roadmap
1. **Deploy the staged batch** (the gate) → verify Phase 2/CC/undervalued live.
2. **Phase 4 (cards→DB)** — biggest single simplification + CardDetail speed/staleness fix.
3. **Cleanup sweep** — delete static files + scripts; dedup onchain listings.
4. **Hardening** — replayable migration baseline; TS strict + CI; Stripe entitlement table.
5. **Resilience** — CC API caching + alerting; population/Japanese expansions.

After Phase 4 + the cleanup, the data layer is: **Scrydex/CC → cron edge functions → DB tables → flat RPC reads → frontend.** One pattern. No static catalog, no manual steps, no 9.9 MB. That's the minimalist v2 that's harder to break.
