# Scrydex Growth-plan features — implementation guide

We're on Scrydex **Growth** ($99/mo, **50,000 credits**). Beyond raw + graded prices
(already integrated) it unlocks: **Price History**, **Price Trends**, **Population
Reports**, and **Vision: Image Analysis** (card scanning).

Credit costs: most calls **1 credit**; **Price History = 3**; **Image Analysis = 5**.
Current monthly pipeline burn ≈ 7k (full-daily) + ~800 sealed ≈ **~8k/mo**, leaving
~42k headroom.

## Guiding principle: bulk vs. lazy
- **Bulk (all 22k cards):** keep the snapshot pipeline. It gives latest price +
  1d/7d/30d deltas for the whole catalog cheaply (one pass, deltas computed from
  our own history). Fetching per-card trends/history for 22k cards would cost
  22k–66k credits per refresh — not viable. **Snapshots stay for the Market/Explore lists.**
- **Lazy (one card at a time, on a detail/scan view):** Price History, Population,
  and Vision are perfect here — fetched on demand, cached in DB, cheap at real traffic.

---

## 1. Price History → fix the empty CardDetail chart (HIGH PRIORITY)
**Problem:** the CardDetail chart shows *"Price history will appear once daily
snapshots accumulate"* because our snapshots only have a few days. Bad first impression.

**Fix:** fetch Scrydex history on demand.
- Endpoint: `GET /pokemon/v1/cards/{id}/price_history?days=90` (3 credits).
- New DB table `card_price_history (card_id, points jsonb, fetched_at)`.
- New edge fn `card-price-history`: check cache → if missing/older than ~7 days,
  fetch Scrydex, store, return; else serve cached (0 credits).
- `PriceChart` reads from this fn instead of our thin snapshot history.
- Budget: a card is fetched at most once/7 days regardless of views. Even 2k unique
  cards/week × 3 = 6k/mo. Comfortable.
- **Does NOT replace snapshots** — it complements them (charts use Scrydex history;
  lists still use snapshot deltas).

## 2. Population Reports → scarcity (medium)
- Per-card PSA/CGC/BGS population counts by grade.
- Surface on CardDetail next to graded tiles ("PSA 10 pop: 1,243").
- Strong **undervalued signal**: low pop + undervalued = higher-confidence flag in
  the CC discovery tool.
- Same lazy + DB-cache pattern as history. Cache table `card_population`.

## 3. Vision: Image Analysis → "Scan a Card" (high consumer value)
- `POST` image → Scrydex identifies the card (5 credits).
- New `/scan` page: user uploads/takes a photo → edge fn `card-scan` proxies Scrydex
  Vision → returns the matched card_id → route to its CardDetail (with live value).
- User-initiated, so volume is self-limiting; 5 credits/scan is fine.
- Killer mobile feature: point phone at a card, get its market + graded value instantly.

## 4. Price Trends → validation/backfill (low)
- Scrydex trend deltas can sanity-check our computed deltas and backfill 1d/7d/30d
  for brand-new cards that lack snapshot history yet. Optional polish.

---

## Suggested sequence
1. **Price History** (fixes the visible empty-chart problem; reuses scrydex-proxy pattern).
2. **Population Reports** (cheap add to CardDetail + sharpens the undervalued tool).
3. **Vision "Scan a Card"** (new page; big consumer hook for mobile/marketing).
4. Trends (optional).

All four are lazy + DB-cached, so none threatens the credit budget, and none
disturbs the locked Market read path or the snapshot pipeline.
