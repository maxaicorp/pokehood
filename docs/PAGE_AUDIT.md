# Per-page audit (route-by-route)

Each route has a main job; we audit them one at a time for bugs, broken UI,
and inefficiency. Severity: 🔴 broken/bug · 🟡 inefficiency/polish · 🟢 ok.

## Route map (17 page functions)
| Route | Component | Audited |
|---|---|---|
| `/` | Market | ⬜ |
| `/explore` | Explore | ⬜ |
| `/card/:id`, `/sets/:slug/:cardSlug` | CardDetail | ✅ below |
| `/sealed/:id` | SealedDetail | ⬜ |
| `/sets`, `/sets/:slug` | Sets, SetDetail | ⬜ |
| `/onchain`, `/onchain/:tab` | Onchain | ⬜ |
| `/dashboard` | Dashboard | ⬜ |
| `/u/:slug`, `/demo` | Profile, DemoProfile | ⬜ |
| `/stats` | Stats | ⬜ |
| `/games`, `/games/card-match` | Games, CardMatch | ⬜ |
| `/giveaway`, `/giveaway/confirm` | Giveaway | ⬜ |
| `/auth` | Auth | ⬜ |
| `/admin/*` (6) | Admin pages | ⬜ |
| `*` | NotFound | ⬜ |

---

## ✅ CardDetail — `/card/:id` + `/sets/:slug/:cardSlug`
**Job:** show one card — image, price, 24h/7d trends, graded tiles, price chart, collection/wishlist/sentiment, buy links, "more from set."

- 🔴 **"Card not found" for any card not in the static `all-cards.json`.** New-set cards (e.g. fresh Mega Evolution drops) have prices in the DB but aren't in the 9.9 MB static index → the page renders a **broken shell** ("Card not found" + empty chart + dead Buy/Collection buttons), exactly as seen in the wild. *Root cause: static catalog staleness.* **Fix: Phase 4 (fetch the card from DB), or fall back to a live Scrydex fetch when the index misses.**
- 🟡 **Cold-load weight:** `getCardById` + `getSetCards(...,500)` both pull the **9.9 MB** index. `force-cache` makes it one-time, but first/SEO load is heavy. **Fix: Phase 4.**
- 🟡 **Buy links are plain keyword searches** to TCGPlayer/eBay/Amazon — **no affiliate codes** = leaving commission on the table (there's a deferred TCGPlayer-affiliate plan). Quick revenue win.
- 🟡 **`cardmarketAvgs` mislabeled** "from TCGdex" — it's actually fed by snapshot deltas now (the 24h % works). Stale comment, rename during cleanup.
- 🟡 **Vote optimistic-update math** (`handleVote`) is convoluted and uses `card.id` through a *set*-sentiment function (`getSetSentiment`) — works, but worth simplifying; possible off-by-one on rapid toggles.
- 🟢 SEO/jsonLd (canonical, breadcrumb, Product schema) is solid; legacy `/card/:id` → canonical redirect is correct.

**Top action:** Phase 4 fixes the 🔴 *and* the 🟡 cold-load in one move. Affiliate links are an independent quick win.

---

## ✅ Market — `/`
**Job:** homepage leaderboard — tabs (Top/Trending/Gainers/Losers/Most-Visited/Sealed), set filter, infinite scroll, live updates.

- 🔴 **Trending/Gainers/Losers are wrong.** They filter+sort the *currently-loaded* cards client-side, but the list is paginated from the price-**desc** RPC (most expensive first). So they show "top movers among the priciest loaded cards," not the real top movers across all 22k. A $0.50 card up +400% never surfaces. **Fix: for these tabs, sort by Δ% across the full latest-prices set (`getLatestSnapshotPrices`, which has every card's deltas) — or add a delta-sorted RPC.**
- 🟡 **Realtime subscription to *every* `price_snapshots` INSERT** — during a cron run (thousands of inserts) every connected browser gets the flood (debounced, but still streamed). Scaling cost. Consider a single "snapshot done" broadcast instead of per-row events.
- 🟡 **Duplicated + convoluted vote math** — `handleVote` is copy-pasted in Market *and* CardDetail with the same hard-to-read optimistic-update arithmetic. Extract one helper; possible off-by-one on rapid toggles.
- 🟡 `cardmarketAvgs` naming again (vestigial TCGdex label; now snapshot-fed).
- 🟢 Infinite-scroll observer is careful (prefetch 800px, cap clamping, the "stuck at 10 rows" fix). Card images derived from `card_id` (good). Now off the 9.9 MB file (fixed earlier).

**Top action:** fix the mover tabs (core feature, currently misleading).

## ✅ Explore — `/explore`
**Job:** searchable/filterable card browser (rarity, type, set, product type, sort), two-phase render.

- 🟡 **New-set cards aren't searchable/filterable here** — `searchCardsAdvanced` runs over the static `all-cards.json`, so cards not yet in the index don't appear in Explore search/filter even though they're priced. Same catalog-staleness root cause as CardDetail. **Phase 4 fixes.**
- 🟡 **Client-side search over ~23k cards + the 9.9 MB load** (force-cached now). Works, but heavy; a DB-backed search would be lighter and always-fresh.
- 🟡 Dual query paths (paginated when no set, `useInfiniteQuery` when a set is selected) — works but adds complexity; the `pricesReady` flag in the query key triggers a refetch when prices land (intentional double-render).
- 🟢 Filters/sort/product-type gating (TCG-Pocket hidden unless chosen) are correct.

**Root cause = static catalog (shared with CardDetail). Phase 4 resolves the bulk.**

## ✅ Onchain — `/onchain`, `/onchain/:tab`
**Job:** Collector Crypt on-chain — Activity feed, Marketplace browse, Top Sales.

- 🟡 **Obsolete ME-era sort logic.** Marketplace "Price: High→Low" walks offsets *from the end of the array* + `include_total` because *Magic Eden's* listings API was ascending-only. But reads now come from `get_onchain_listings` (DB RPC), which sorts `price DESC` natively. So this offset-from-end math is **dead complexity** + bug-prone (off-by-one on the boundary). **Simplify to the RPC's native sort.**
- 🟡 **Blocklist triplicated.** The merch/moonbirds filter exists in **3 places**: frontend `filterBlocked`, the `onchain-listings` edge fn `NAME_BLOCKLIST`, and SQL `is_merch_name()`. Drift risk. **Consolidate to the SQL helper.**
- 🟡 Marketplace shows **391** (ME-sourced CC) now → ~52k once `ingest-cc-marketplace` deploys. The "X listed" counter we added will track it.
- 🟢 Activity/Top-Sales read from DB (cron-backed), merch-filtered at the RPC, USD-normalized. Solid.

**Theme: leftover Magic-Eden-era scaffolding after the DB rewrite — prune it.**

## (Pending) — audited a few per pass
Market, Explore, Onchain, Sets/SetDetail, Dashboard, Profile, Stats, Games,
Giveaway, Auth, Admin, NotFound. Findings appended here as each is reviewed.
