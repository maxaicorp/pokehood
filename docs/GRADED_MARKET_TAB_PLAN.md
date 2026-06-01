# Graded section in the /market data tables — PLAN (post-launch)

**Goal:** a market data table (like raw cards / Movers) that surfaces **changes in
graded card prices** — e.g. "Base Set Charizard PSA 10 +12% (7d)". One of the
highest-value lenses, because graded comps are exactly what serious buyers search.

This is the graded analogue of the raw Movers feature. It revisits *after launch*,
once the chunked snapshot has banked a few weeks of clean **graded** history.

## Why it's not trivial: we have current graded prices but no graded *deltas*
- `latest_graded_prices` holds the **current** market per `(card_id, company, grade)`
  but has **no** `price_1d/7d/30d`. The raw side gets deltas because
  `refresh_latest_card_prices()` computes prior-window prices via lateral joins on
  `price_snapshots`. The graded refresh (`refresh_latest_graded_prices()`) does NOT.
- `graded_price_snapshots` DOES have daily history (`recorded_at`), so the deltas are
  computable — they just aren't computed yet.

## Phase 1 — backend: graded deltas
Extend `refresh_latest_graded_prices()` (or add a sibling) to also compute, per
`(card_id, company, grade)`, the prior price at ~1d/7d/30d from `graded_price_snapshots`
(same lateral-join pattern as `refresh_latest_card_prices`). Add `price_1d/7d/30d`
columns to `latest_graded_prices`. Keep it on the dedicated `refresh-latest-prices-daily`
cron (already runs both refreshes) so it can't drift. See [[project_graded_refresh_gap]],
[[project_chunked_snapshot]].

## Phase 2 — read RPCs
- `get_graded_movers(p_window, p_company, p_grade, p_min_price, p_limit)` — ranks
  `latest_graded_prices` rows by `abs(% move)` over the window, mirroring
  `get_top_movers` (price floor, server-side, full catalog).
- `get_graded_page(...)` — a sortable paged read for the full graded data table
  (the graded equivalent of `get_latest_price_page`).

## Phase 3 — frontend
- A **Graded** view in /market (own tab, or a raw/graded toggle on Movers). Row unit =
  `(card, company, grade)` — e.g. "Charizard · base1-4 · PSA 10 · $505k · +3% 24h".
- Filters: **company** (PSA/BGS/CGC), **grade** (10/9/…), **window** (24h/7d/30d),
  price floor. Reuse the 3-company + grade-dropdown patterns already built in
  `GradedPriceTiles`.
- Read via the new RPCs; hydrate like the raw table; no browser compute (read contract).

## Design considerations
- **Thin-market noise** — graded markets are sparse and jumpy; a single sale can swing
  the comp. Apply a price floor (≥ ~$20?) and consider requiring ≥2 snapshots in the
  window so one outlier sale doesn't top the movers list. Same glitch-guard concern as
  the (deferred) raw "Unusual" tab.
- **Row granularity** — per `(card, company, grade)` is the honest unit, but the table
  could get long. Option: default to PSA 10 (+ a grade dropdown per row) so it reads as
  "one row per card" with drill-down, matching the card-page tiles.
- **Coverage** — only ~40% of cards have graded data, concentrated on established cards;
  the table will skew vintage/chase. That's fine (it's where graded demand is).

## Dependency / timing
Needs reliable daily **graded** snapshot history. That history only became trustworthy
after the chunked-snapshot fix (2026-06-01); let it accumulate ~2–4 weeks before the
deltas (esp. 30d) are meaningful. **Revisit after launch + ~3 weeks**, after the raw
"Unusual" tab (both share the deltas + glitch-guard groundwork).
