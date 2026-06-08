# Scrydex → Website: Pricing Architecture (2026-06-07)

End-to-end reference for how card prices get from Scrydex onto the site, plus a
theoretical single-day run with credit accounting. Read this to sanity-check for
flaws.

**Status legend:** ✅ deployed · 🟡 built, pending deploy · 🔵 built, ships on next frontend build · ⏳ future phase

---

## 0. Core principles (what we settled on)

1. **Single cards = live; bulk lists = cached.** A card page can fetch Scrydex
   live (cheap, 1 card). The Market grid shows thousands of cards ranked — that
   MUST read a precomputed cache (you can't live-fetch 22k cards per visitor).
2. **Per-set crawling, never global paging.** Global `orderBy` paging silently
   drops random cards (offset drift on live data). Per-expansion (`q=expansion.id`)
   fetches a set whole = no drift.
3. **Atomic per-set writes.** A set's rows are written all-or-nothing. A row in
   `price_snapshots` ⇒ its set fully succeeded. This is what makes the cache
   refresh safe.
4. **Deltas come from Scrydex `trends`, not from diffing our own history.**
   Scrydex ships 1/7/14/30/90/180-day movement per card. We store/forward those
   instead of recomputing — kills the "deltas show — until history accumulates"
   problem.
5. **Decoupled refresh.** The cache rebuild runs on its own cron, never bolted to
   the crawl, so a crawl hiccup can't block the read path.
6. **Snapshots are for the deep chart, not for deltas.** They accumulate daily
   detail; the 6-month shape comes from trends.

---

## 1. The Scrydex per-card response (one fetch gives all of this)

`GET /pokemon/v1/cards/{id}?include=prices` (or `?q=expansion.id:{set}` for a set):

- **`variants[].prices[]`** — for the NM raw USD entry:
  - `market` → current price
  - `trends.days_1/7/14/30/90/180` → each has `price_change` (current − prior) and `percent_change`
  - graded entries (PSA/BGS/CGC/TAG) with their own ladder
- **Billing: 1 credit per request (≈100 cards/page)** — NOT per card. Measured 2026-06-07.

`prior_price = market − trends.days_N.price_change`. We store prior prices (the
cache's existing contract); the frontend computes the %.

---

## 2. Components

### Tables
- **`price_snapshots`** — daily history. Columns incl. `price`, `recorded_at`, and now `price_1d/7d/30d` (trends-derived priors). One row per card per day. 90-day retention.
- **`latest_card_prices`** — the read cache the site reads. Latest price + `price_1d/7d/30d` per card. Rebuilt by the refresh fn.
- **`graded_price_snapshots`** / **`latest_graded_prices`** — graded analogue.
- **`scrydex_set_snapshot_state`** 🟡 — the per-set work queue + completeness ledger (status, `last_success_on`, `card_total`, `last_cards_priced`, lease columns).
- **`card_price_overrides`** — durable manual price pins (win in the refresh).

### Edge function `snapshot-prices` (modes)
- **`crawl-batch`** 🟡 — claim N due sets (`FOR UPDATE SKIP LOCKED`), fetch each set whole, **atomic write**, stamp. THE daily pipeline.
- **`seed-sets`** 🟡 — refresh the registry from `/expansions` (EN physical non-Pocket).
- `daily` / `full` / `chunk` / `sets` — legacy global-paging modes; kept only as a manual fallback (Master Refresh buttons). Drift-prone — not the daily path.

### SQL functions
- **`refresh_latest_card_prices()`** 🟡 — rebuild the cache: latest-per-card within 45 days, deltas copied from each row's stored trends. No 17k floor. Sealed via lookback; overrides win.
- **`claim_due_snapshot_sets` / `mark_set_snapshot_success` / `mark_set_snapshot_error`** 🟡 — the locked queue ops.
- **`get_latest_price_page` / `get_top_movers` / `get_graded_page`** — frontend read RPCs (flat reads off the cache).

### Crons (set by `PER_SET_PIPELINE_DEPLOY.sql`) 🟡
| Cron | Schedule (UTC) | Job | Credits |
|---|---|---|---|
| `snapshot-crawl-batch-5m` | every 5 min | `{crawl-batch, limit:15}` | ~1/page while working, 0 when caught up |
| `seed-snapshot-sets-daily` | 00:05 | `{seed-sets}` | ~5 |
| `refresh-latest-prices-intraday` | every 20 min | pure SQL refresh (both caches) | 0 |
| `prune-snapshots-weekly` (existing) | Sun 08:00 | delete >90d | 0 |
| `snapshot-sealed` (existing, separate) | daily | sealed products | ~modest |
| **retired** | — | `snapshot-chunk-%`, `verify-and-heal%`, `daily/weekly-full` | — |

### Frontend read paths
- **Market / Explore / Movers** — read `latest_card_prices` via RPCs. Deltas: 24h/7d everywhere, +30d toggle on Movers. ✅ (data path 🟡 until pipeline deploys)
- **Card detail** — live `getScrydexCard` + `getScrydexNmAudit` (price + 6 trend anchors + graded). 🔵
- **Chart** 🔵 — merges, by date: trend anchors (deep 6-month shape) UNDER daily snapshots (real, recent) + today's live price.

---

## 3. The two read paths, precisely

**Path A — Market deltas (bulk):**
```
crawl-batch fetches set → captures trends.days_1/7/30 → writes prior prices onto
price_snapshots row → refresh copies latest row → latest_card_prices →
get_latest_price_page / get_top_movers → Market grid (24h/7d, Movers +30d)
```

**Path B — Card chart (single):**
```
card page loads → getScrydexNmAudit (live) → 6 trend anchors (1/7/14/30/90/180d)
   ＋ getCardPriceHistory (our daily snapshots, dense recent)
   → PriceChart merges (snapshots win per date) → 6M/1Y curve
```

---

## 4. A single day, theoretically (UTC)

Assume ~180 EN physical sets, ~300 total pages across them.

| Time | What runs | Credits |
|---|---|---|
| **00:00** | `crawl-batch` tick #1 — claims 15 oldest-due sets, crawls each whole, atomic-writes, stamps | ~25 (≈15 sets × ~1.7 pages) |
| **00:05** | `seed-sets` — refresh registry from `/expansions` (adds any new sets) | ~5 |
| **00:05–~01:00** | `crawl-batch` ticks #2–#12 — 15 sets each until all ~180 are stamped today | ~275 (remaining pages) |
| **~01:00 onward** | `crawl-batch` every 5 min finds **0 due sets → instant no-op** until next UTC day | 0 |
| **every 20 min, all day** | `refresh-latest-prices-intraday` — rebuild cache from snapshots (surfaces sets as they land 00:00–01:00; light rebuild rest of day) | 0 |
| **07:00** | `refresh-latest-prices-daily` (if kept; redundant with intraday) | 0 |
| **Sun 08:00** | `prune-snapshots-weekly` — delete snapshots >90 days | 0 |
| **daily** | `snapshot-sealed` (separate subsystem) | ~modest |
| **throughout** | card-page views — 1 live fetch each for chart anchors + graded | ~1–2 each (traffic-dependent) |

**Net result by ~01:00:** every set's current price + deltas are in the cache,
chase cards included (per-set = no drift), and the per-set health panel on
`/admin/health` shows ~180/180 fresh. The catalog stays correct all day; the
crawl idles until tomorrow.

### Credit budget — USAGE vs CEILING (don't confuse them)
**What we actually SPEND per day:**
- Crawl (full per-set cycle): **~300**
- Seed registry: **~5**
- Refreshes + prune: **0** (pure SQL)
- Sealed: ~modest (separate subsystem)
- Card-page views: **~1–2 each** (only cost that scales with traffic)
- → **Pipeline baseline ≈ ~325 credits/day** + traffic.

**The CEILING (your Scrydex plan, NOT usage):** the plan is ~50,000 credits/month
≈ **~1,600/day available**. We were at ~500/day before this work. So the pipeline
spends **~325 of the ~1,600 ceiling** — roughly 20%. The 1,600 is headroom, not
consumption.

---

## 5. Known flaws / open items / optimizations

1. **Card page may make 2+ live fetches of the same card** (graded tiles + `getScrydexNmAudit` + possibly `enrichCardWithPricing` cold). Each is ~1 credit. **Optimization:** consolidate to ONE `getScrydexCard` per page and derive price, deltas, anchors, and graded from it. Not broken — just wasteful under traffic.
2. **Intraday refresh `TRUNCATE`s `latest_card_prices`** every 20 min → a brief `ACCESS EXCLUSIVE` lock (readers wait ~seconds), 72×/day. Fine now; could move to an upsert/merge refresh if it ever bites.
3. **Legacy global-paging modes still exist** (`daily`/`full`/`chunk`) and the Master Refresh buttons still call them (drift-prone). Harmless manual fallback; could repoint to `crawl-batch`.
4. **Trend anchors are approximations** (market − price_change). Shown under a "estimated from trends" note until daily snapshots densify. By design.
5. **Graded has no deltas/movers yet** — `latest_graded_prices` carries price only. v2 = graded movers (needs deltas computed in the graded refresh).
6. **Cards with no NM raw USD price** (energy commons, graded-only secret rares) are intentionally not priced → show N/A. `priced/total` on the health panel will always be < total because of this (expected, not a bug).
7. **Deploy gating:** all 🟡 items are live only after the migrations + edge-fn deploy + `PER_SET_PIPELINE_DEPLOY.sql`. Commit ≠ deploy for edge functions — the #1 historical failure.

---

## 6. Phase 2 — webhooks (⏳ future)

Scrydex webhooks already fire to `scrydex-webhook` (observer mode, logging to
`webhook_events_log`). Once we have a day or two of firing data:
- On `pokemon.expansions.prices.raw_updated` for expansion X → trigger
  `crawl-batch` scoped to just X (real-time, only changed sets).
- The 5-min crawl + daily cycle become the safety net behind the webhook.
- Cuts daily crawl credits to ~"only what changed" and makes prices near-real-time.

---

## 7. One-game-agnostic note

The entire pipeline is game-agnostic — swap `/pokemon/` for `/onepiece/`,
`/gundam/`, `/lorcana/` (Scrydex supports all, raw prices). A new game reuses the
exact crawl + cache + chart with a different endpoint prefix.
