# Collectiblez — active fix list

Living checklist of outstanding work. Check items off as they ship. Grouped by
status so blocked/decision items don't stall the shippable ones.

## ✅ Done (this push)
- [x] **Buy-link search query** — strip the `(Unlimited Holo)` variant parenthetical from name + set so outbound searches read `Articuno Fossil pokemon card` (CardDetail). Selling sites list as `<Pokémon> <Set>`.
- [x] **Load-from-top** — added `ScrollToTop` on route change (was landing mid-page on every navigation).

## 🟢 Next up (shippable, no blockers)
- [ ] **Panel system (RowActions)** — component is built + committed but **never wired into rows**. Wire the `+` button on Market / Explore / Sets / SetDetail rows to open `<RowActions>` (add-to-inventory / wishlist / buy links). *User wants this immediately next.*
- [ ] **Graded tiles RPC cap** — `get_graded_tiles_for_card` hard-caps `grade IN (10,9)` but the tiles component shows all grades via dropdown. Remove the cap (SQL migration).

## 🟠 Builds (migration + UI)
- [ ] **Graded price override** — mirror the raw override: `graded_price_overrides` table + `admin_set_graded_price` RPC + override-aware `refresh_latest_graded_prices` + a graded tab in `/admin/prices`. (Also absent from verify-and-heal.)
- [ ] **Most Visited restyle** — match the other Market list views (consistent rows/columns/spacing).
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
