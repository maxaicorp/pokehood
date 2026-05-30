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
- ✅ 🔴 **Stale "PokeVault" branding in user-visible text** → replaced with "Collectiblez" in Terms (×6), Privacy (×2), the "Powered by" footer on the public-profile preview, QR share text + download filename, and the wrong `pokevault.app/u/` URL in ProfileSettings (→ collectiblez.app). Internal localStorage keys left as-is (changing them would reset users' theme prefs).
- ✅ 🟡 **Profile views inflated** (mega-audit M4) → once-per-day localStorage cap (was per-tab sessionStorage).
- ✅ 🟡 **Slug collision showed a raw Postgres error** (mega-audit M2) → traps 23505, shows "That profile URL was just taken — try another" + flags the field.
- ✅ 🟠 **Broken-image glyphs everywhere on CDN failure** (mega-audit H4) → new shared `CardImage` (inline-SVG placeholder, retries on src change) applied to the high-traffic surfaces: CardGridView (Market+Explore grids), Market list/most-visited rows, Explore list, CollectionList, public Profile grid, CardDetail suggestions. CardDetail hero `motion.img` got an inline large→small→hide fallback. Remaining low-traffic raw imgs (Sealed* components, WishlistDashboard, CurrentPrizeCard, DemoProfile) can adopt `CardImage` in a follow-up.
- ✅ 🔴 **No top-level ErrorBoundary** (mega-audit B3) → any thrown render blanked the whole app. Added `ErrorBoundary` wrapping `<Routes>` with a "reload" fallback.
- ✅ 🟠 **addToCollection duplicate-row permanent break** (mega-audit H1) → a prior race could leave 2 rows for one (user,card,condition), after which `maybeSingle()` threw "multiple rows" forever, blocking all future adds of that card. Frontend now uses `limit(1)` (tolerates dupes); migration `20260530120000_collection_cards_unique.sql` dedups + adds the unique index (deploy-gated).
- ✅ 🔴 **Market mover tabs + column-header sort only re-ordered the loaded page** → Market now loads the full filtered set up front (capped at 500, same top-N the header total uses) via `getLatestSnapshotAll`; first paint keeps a tiny page for speed, then Phase B swaps in the full set. Column sorts (Price/24h/7d) and Trending/Gainers/Losers now sort over every card in the filter; infinite scroll is pure client-side reveal (no more per-page network sort). User-reported symptom ("arrow flips but nothing sorts") fixed.

## ✅ Requested additions (2026-05-30)
- ✅ **Most-Visited tab** now shows Price + 24h + 7d (hydrated from `latest_card_prices` via `getLatestPricesByIds`; 30d omitted to keep the row readable, data exists if wanted). Hidden on mobile, views still show there.
- ✅ **Games page** — added 4 "Soon" roadmap tiles (Higher or Lower, Guess the Set, Price Sprint, TCG Trivia) so the grid isn't sparse.
- ✅ **Giveaway hidden from public** — removed both nav links, `/giveaway` redirects to `/` (`/giveaway/confirm` kept live for in-flight emails). Admin still manages at `/admin/giveaways`.

## ⬜ To fix — prioritized
1. ✅ 🔴 **Market Trending/Gainers/Losers + column sort** — DONE (full-set client sort; see fixed list above).
2. ✅ 🟡 **Auth password reset** — DONE (forgot + set-new-password flow).
3. ✅ 🟡 **Onchain marketplace obsolete ME offset-from-end sort** — DONE. Ripped out the `include_total` + walk-from-end + reverse-each-page + re-fetch gymnastics; the `onchain-listings` edge fn / `get_onchain_listings` RPC already sort `price-desc` natively, so it's now plain forward pagination (`offset = page * BATCH`, sort token passed through). `pageParam` collapsed from `{page,total}` to a number.
4. ✅ 🟡 **Merch blocklist triplication** — reduced. The edge fn no longer carries its own `NAME_BLOCKLIST` (relies on the RPC's `is_merch_name`); frontend keeps only a thin one-line safety net for the rare un-indexed straggler. Effectively single-source (SQL) + intentional defense-in-depth one-liner.
5. ✅ 🟡 **Vote optimistic-update math duplicated** — DONE. Extracted `applyVote()` in sentiment-store; Market + CardDetail both call it. (Both inline copies were actually correct, but the nested-ternary was unreadable and a drift risk — now one source.)
6. ⬜ 🟡 **Giveaway winner draw uses client `Math.random()`.** **Fix (only if prizes have real value):** server-side, auditable draw.
7. ✅ 🟡 **AdminFunctions probe red 401/400 pills** — DONE. `failedCount` was already correct (okStatuses), but the status pill rendered red for expected auth-rejections (green check + red pill mismatch). Pill now colours by expected-ness (in okStatuses → green "expected", with a tooltip), only true unexpected statuses are red.
8. ⏸️ 🟡 **Phase 4b — DEFERRED until the `cards` table is verified populated** (post-deploy of `sync-cards-catalog` + `20260529160000_cards_catalog.sql`). **Why deferred, not done:** `buildCardFromDb` falls back to `latest_card_prices` (already populated) when `cards` is empty, but that row has NO rarity/types/hp/supertype. Flipping `getCardById`/`getSetCards`/`searchCardsAdvanced` to DB-first *now* would silently regress card metadata for every card until the catalog syncs. **Post-deploy recipe:** once `SELECT count(*) FROM cards` ≈ 23k, (a) flip `getCardById` to try `buildCardFromDb` first for non-`::variant` ids, static fallback for variants; (b) add a `getSetCards` DB query + reuse existing pricing/variant enrichment; (c) point `searchCardsAdvanced` at a DB text/filter query. Then delete `all-cards.json`. See DEPLOY_CHECKLIST.

## 🧹 Cleanup (after Phase 4 deploy + verify the `cards` table is populated)
- 🧹 Delete `public/data/all-cards.json` (9.9 MB), `sealed-products.json`, `public/data/sets/` (200 files), `sets-list.json`.
- 🧹 Delete the broken sync scripts (`sync-scrydex-cards.js`, `sync-scrydex-sealed.js`, `build-card-index.js`).
- 🧹 Remove TCGdex remnants (the `cardmarketAvgs` "TCGdex" label, fallback comments).
- 🧹 Retire the ME-CC listings ingest once `ingest-cc-marketplace` covers it (391 → ~52k).

## Notes
- Games/CardMatch + Admin (besides #7) + NotFound: no blocking bugs found.
- Two root causes drive most of the above: **static catalog** (Phase 4 built) and **leftover Magic-Eden-era scaffolding** (#3/#4/#8 + cleanup).
