# FIX ASAP — consolidated bug list (from the per-page audit)

Severity: 🔴 broken/user-facing · 🟡 wrong-but-survivable / polish · 🧹 cleanup.
Status: ✅ fixed · ⬜ to do.

## ✅ Already fixed this audit (live on next frontend deploy)
- ✅ 🔴 **CardDetail "Card not found"** on new-set cards → builds from DB (`buildCardFromDb`).
- ✅ 🔴 **Portfolio value frozen at add-time prices** (Dashboard + public Profile) → `repriceLive()` against `latest_card_prices`.
- ✅ 🔴 **Sealed tab blank 1d/7d deltas** → read `latest_card_prices` directly (earlier).
- ✅ 🔴 **>1s blank pages** → removed `cache:"no-store"`; Market/Explore off the 9.9 MB file.
- ✅ 🟡 **No password reset** → added "Forgot password?" + PASSWORD_RECOVERY set-new-password flow.
- ✅ 🔴 **Private profiles leaked everything (collection/links/value) + got Google-indexed** → Profile.tsx now gates an unpublished profile behind an owner check (non-owners see a "Private Profile" screen, not the content) and emits `noindex` for any unpublished profile. ⚠️ DB enforcement still requires running `20260511000000_privacy_respecting_rls.sql` (see DEPLOY_CHECKLIST) — until then a raw anon-key curl can still read private rows.
- ✅ 🔴 **Dashboard "Vault Full → Upgrade to Pro" button was dead** (`getElementById("upgrade-to-pro")` matched nothing) → wired to the real `create-checkout` Stripe flow.
- ✅ 🟡 **CSV import**: progress bar never hit 100% with unmatched rows (denominator fix), fired error+success toasts together on a limit hit (one message now), could render `NaN%` width (zero-guarded), and didn't dedupe duplicate lines within a file (mega-audit H2 — now collapses on name|set|number, merging qty).
- ✅ 🟡 **Profile views inflated** (mega-audit M4) → once-per-day localStorage cap (was per-tab sessionStorage).
- ✅ 🟡 **Slug collision showed a raw Postgres error** (mega-audit M2) → traps 23505, shows "That profile URL was just taken — try another" + flags the field.
- ✅ 🟠 **Broken-image glyphs everywhere on CDN failure** (mega-audit H4) → new shared `CardImage` (inline-SVG placeholder, retries on src change) applied to the high-traffic surfaces: CardGridView (Market+Explore grids), Market list/most-visited rows, Explore list, CollectionList, public Profile grid, CardDetail suggestions. CardDetail hero `motion.img` got an inline large→small→hide fallback. Remaining low-traffic raw imgs (Sealed* components, WishlistDashboard, CurrentPrizeCard, DemoProfile) can adopt `CardImage` in a follow-up.
- ✅ 🔴 **No top-level ErrorBoundary** (mega-audit B3) → any thrown render blanked the whole app. Added `ErrorBoundary` wrapping `<Routes>` with a "reload" fallback.
- ✅ 🟠 **addToCollection duplicate-row permanent break** (mega-audit H1) → a prior race could leave 2 rows for one (user,card,condition), after which `maybeSingle()` threw "multiple rows" forever, blocking all future adds of that card. Frontend now uses `limit(1)` (tolerates dupes); migration `20260530120000_collection_cards_unique.sql` dedups + adds the unique index (deploy-gated).
- ✅ 🔴 **Market mover tabs + column-header sort only re-ordered the loaded page** → Market now loads the full filtered set up front (capped at 500, same top-N the header total uses) via `getLatestSnapshotAll`; first paint keeps a tiny page for speed, then Phase B swaps in the full set. Column sorts (Price/24h/7d) and Trending/Gainers/Losers now sort over every card in the filter; infinite scroll is pure client-side reveal (no more per-page network sort). User-reported symptom ("arrow flips but nothing sorts") fixed.

## ⬜ To fix — prioritized
1. ✅ 🔴 **Market Trending/Gainers/Losers + column sort** — DONE (full-set client sort; see fixed list above).
2. ✅ 🟡 **Auth password reset** — DONE (forgot + set-new-password flow).
3. ⬜ 🟡 **Onchain marketplace uses obsolete Magic-Eden offset-from-end sort** (`include_total`, reverse pages). The DB RPC sorts `price DESC` natively. **Fix:** drop the offset math, use the RPC sort. (Removes a bug-prone path + dead complexity.)
4. ⬜ 🟡 **Merch/moonbirds blocklist lives in 3 places** (frontend `filterBlocked`, edge `NAME_BLOCKLIST`, SQL `is_merch_name`). **Fix:** single source (SQL helper); drop the dupes.
5. ⬜ 🟡 **Vote optimistic-update math duplicated** in Market + CardDetail (convoluted; possible off-by-one). **Fix:** extract one `applyVote()` helper.
6. ⬜ 🟡 **Giveaway winner draw uses client `Math.random()`.** **Fix (only if prizes have real value):** server-side, auditable draw.
7. ⬜ 🟡 **AdminFunctions probe counts secure 401/400 as "failures"** → "8 of 19 failed" noise. **Fix:** treat expected-auth-rejections as healthy.
8. ⬜ 🟡 **Phase 4b** — make `getCardById`/`getSetCards`/`searchCardsAdvanced` DB-first so the 9.9 MB `all-cards.json` is never downloaded (after the `cards` table is populated).

## 🧹 Cleanup (after Phase 4 deploy + verify the `cards` table is populated)
- 🧹 Delete `public/data/all-cards.json` (9.9 MB), `sealed-products.json`, `public/data/sets/` (200 files), `sets-list.json`.
- 🧹 Delete the broken sync scripts (`sync-scrydex-cards.js`, `sync-scrydex-sealed.js`, `build-card-index.js`).
- 🧹 Remove TCGdex remnants (the `cardmarketAvgs` "TCGdex" label, fallback comments).
- 🧹 Retire the ME-CC listings ingest once `ingest-cc-marketplace` covers it (391 → ~52k).

## Notes
- Games/CardMatch + Admin (besides #7) + NotFound: no blocking bugs found.
- Two root causes drive most of the above: **static catalog** (Phase 4 built) and **leftover Magic-Eden-era scaffolding** (#3/#4/#8 + cleanup).
