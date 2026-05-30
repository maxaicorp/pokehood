# FIX ASAP — consolidated bug list (from the per-page audit)

Severity: 🔴 broken/user-facing · 🟡 wrong-but-survivable / polish · 🧹 cleanup.
Status: ✅ fixed · ⬜ to do.

## ✅ Already fixed this audit (live on next frontend deploy)
- ✅ 🔴 **CardDetail "Card not found"** on new-set cards → builds from DB (`buildCardFromDb`).
- ✅ 🔴 **Portfolio value frozen at add-time prices** (Dashboard + public Profile) → `repriceLive()` against `latest_card_prices`.
- ✅ 🔴 **Sealed tab blank 1d/7d deltas** → read `latest_card_prices` directly (earlier).
- ✅ 🔴 **>1s blank pages** → removed `cache:"no-store"`; Market/Explore off the 9.9 MB file.
- ✅ 🟡 **No password reset** → added "Forgot password?" + PASSWORD_RECOVERY set-new-password flow.

## ⬜ To fix — prioritized
1. ⬜ 🔴 **Market Trending/Gainers/Losers are inaccurate.** They filter+sort only the *loaded* (price-desc) page, so a cheap card up +400% never appears. **Fix:** compute movers from the full latest-prices set (`getLatestSnapshotPrices`, which has every card's deltas), sort by Δ%, take top N — same lesson SetDetail already applies.
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
