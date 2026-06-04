# Collectiblez — active fix list

Living checklist of outstanding work. Check items off as they ship. Grouped by
status so blocked/decision items don't stall the shippable ones.

## ✅ Done (this push)
- [x] **Buy-link search query** — strip the `(Unlimited Holo)` variant parenthetical from name + set so outbound searches read `Articuno Fossil pokemon card` (CardDetail). Selling sites list as `<Pokémon> <Set>`.
- [x] **Load-from-top** — added `ScrollToTop` on route change (was landing mid-page on every navigation).

## ✅ Done (also)
- [x] **Panel system (RowActions)** — wired the `+` on Market / Explore / SetDetail to open `<RowActions>` (add to inventory / wishlist / buy). Plus-icon only, "Add" text removed. Buy query uses the clean `buyQueryForCard` helper (shared with #1).

## 🟢 Next up (shippable, no blockers)
- [ ] **Graded tiles RPC cap** — `get_graded_tiles_for_card` hard-caps `grade IN (10,9)` but the tiles component shows all grades via dropdown. Remove the cap (SQL migration).

## ✅ Done (also)
- [x] **Graded price override** — `graded_price_overrides` table + `admin_set_graded_price`/`admin_clear_graded_override` RPCs + override-aware `refresh_latest_graded_prices` + graded editor in `/admin/prices`. Also un-capped `get_graded_tiles_for_card` (was `grade IN (10,9)`). *Migration run.*
- [x] **Most Visited restyle** — now uses the same column widths + desktop-grid/mobile-card layout as the other Market tables (Views as the last column).
- [x] **Buy-row brand logos** — TCGplayer / eBay / Collector Crypt SVGs wired into the panel.

## 🟠 Builds / polish
- [ ] **Bottom-nav icons** — refresh the look. *Needs direction: filled vs outline / vibe, or "you pick".*

## 🔴 Blocked — need data or a decision
- [ ] **24h / 7d / 30d view dropdown (Most Visited)** — `card_stats` is **cumulative only**; no per-day history to window by. Needs a `card_view_events` table (or daily count snapshots) first, then a windowed query. Build the data layer to unblock.
- [ ] **`cards` catalog sync writes 0** — schema mismatch. Need the `cards` **column list** + the manual-upsert result. Blocks Explore listing vintage from the live index + DB rarity search.

## ⚫ Deploy / credit blocked & deferred
- [ ] **snapshot-prices NM-only + canonical dedup** — committed; needs a Lovable edge-fn deploy (credits). Until then the cron can still write bad fills; overrides protect only pinned cards.
- [ ] **DB `search_catalog` rarity enrichment + Tier 2/3 search** ("cosmos holo", vintage finishes) — gated on the `cards` sync.
- [ ] **SEO link previews** — Cloudflare Worker in front of Lovable (UA-based prerender of OG tags) + per-card OG image. Deferred by user; needs DNS move to Cloudflare.
- [ ] **verify-and-heal + write-time sanity gate** — robustness; a `verify-and-heal` fn file exists, state TBD.

## Handled elsewhere
- Eeveelution graded gap (Prismatic Evolutions) — **Lovable is fixing this**; removed from our list.

---
_Recent shipped (context): admin price override system, vintage 404 fix, variant-URL fix, Tier-1 rarity/type search, Most Visited 500 cap + card_stats column fix, line chart + sonar ping, SEO titles._
