# Collectiblez — Pre-Launch Mega Audit

**Date**: 2026-05-10
**Scope**: Desktop functionality of all main systems (auth, market, explore, sets, card detail, dashboard, collection, wishlists, public profile, card match, pricing pipeline, cross-cutting concerns).
**Excluded by user**: Stripe (will configure last), Onchain (archived), Giveaway/Admin (deferred until pre-launch), Mobile UI (separate dedicated audit pass — TODO).

## Severity legend
- 🔴 **BLOCKER** — ship-stoppers. Privacy leaks, broken core flows, data loss risk.
- 🟠 **HIGH** — should fix before users land. Annoying, embarrassing, or fragile under load.
- 🟡 **MEDIUM** — fix soon but not launch-blocking. UX rough edges, edge-case bugs.

---

## 🔴 BLOCKERS

### B1 — Private profiles aren't actually private (DB layer + React layer)
**Files**: `src/pages/Profile.tsx:198-271`, plus RLS policies on `profiles` / `collection_cards` / `user_links`

There's a working "published" toggle in the dashboard (`src/components/ProfilePageEditor.tsx:364-374`) that flips `profiles.is_published`. **Neither layer honors it.**

**Layer 1 — DB**: SELECT policies on `profiles`, `collection_cards`, and `user_links` are all `true` (anyone, including unauthenticated requests, can read every row). The privacy toggle has zero effect at the Supabase REST API — a curl with the anon key returns any user's collection regardless of `is_published`.

**Layer 2 — React**: `Profile.tsx` renders the value badge, links, collection grid, and contact popover regardless of `is_published`. The check at line 199 only gates a decorative "Private Profile" badge.

**Status — migration written**: `supabase/migrations/20260511000000_privacy_respecting_rls.sql` tightens the three SELECT policies to require `is_published = true OR auth.uid() = user_id`. Ready to run.

**Tomorrow's steps**:
1. User runs the migration SQL in Supabase SQL Editor.
2. Verify a published profile still loads on `/u/:slug` while logged out.
3. Verify an unpublished profile returns no data.
4. Patch `Profile.tsx` (or rather the query inside it) to show a clean "this profile is private" page when the lookup returns null because of RLS.

---

### B2 — RLS verified on user tables ✅
**Tables**: `collection_cards`, `profiles`, `user_links`

User ran the verification SQL on 2026-05-10. Results show all three tables have proper **write protection** (`ALL` policy with `auth.uid() = user_id`) — no one can mutate another user's data by guessing IDs. Original B2 concern resolved.

The **read** side gap surfaced by the verification is now tracked as part of B1 above (since fixing the React render alone wouldn't have closed the privacy hole — the DB had to change too).

---

### B3 — No top-level ErrorBoundary
**File**: `src/App.tsx:54-79`

If any component throws — broken image URL crashing parent layout, malformed price data, anything — the user gets a blank page with no message. No way to recover except hard refresh.

**Fix**: wrap `<Routes>` in a React ErrorBoundary that renders a "Something went wrong, refresh" fallback. ~30 lines.

---

### B4 — No password reset flow
**File**: `src/pages/Auth.tsx`

Users who forget their password have zero recourse. Page only has Sign In / Sign Up. Supabase supports `auth.resetPasswordForEmail()` natively.

**Fix**: add "Forgot password?" link → emit reset email → new `/auth/reset` page handles the recovery token.

---

## 🟠 HIGH

### H1 — `addToCollection` race condition
**File**: `src/lib/collection-store.ts:88-143`

Lookup-then-insert pattern is not atomic. Two rapid clicks on "Add to collection" can both pass the duplicate check and produce two rows for the same card+condition. After it happens once, `maybeSingle()` throws "multiple rows" forever for that combo.

**Fix**: Postgres UPSERT with a unique index:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS collection_cards_uniq
  ON public.collection_cards (user_id, tcg_api_id, condition);
```
Then `.upsert({...}, { onConflict: 'user_id,tcg_api_id,condition' })` with quantity increment.

---

### H2 — CSV import doesn't dedupe within file
**File**: `src/lib/csv-import.ts:60-104`

If a CSV has two `"Charizard,Base,4"` lines, both get added separately. No collapse on `(name|setName|number)` before resolving.

**Fix**: dedupe in `resolveImport` before the search loop — merge quantity, single API hit per unique key.

---

### H3 — CSV import tier limit is stale
**File**: `src/pages/Dashboard.tsx:54, 97`

`totalCards` is computed once at render, captured in `handleImport`'s closure. Two tabs importing simultaneously both pass the limit check and exceed the 20-card free cap.

**Fix**: refetch live count from DB at the start of `handleImport`, or move the check server-side as part of the upsert.

---

### H4 — Image fallbacks missing almost everywhere
Only 4 files have `onError` handlers; 15 don't. If Scrydex changes a CDN URL or a card is missing an image, every page displaying it shows broken-image icons.

Files with raw `<img>` tags lacking fallback:
- `src/pages/Market.tsx`
- `src/pages/Explore.tsx`
- `src/pages/CardDetail.tsx`
- `src/pages/Profile.tsx:265`
- `src/pages/CardMatch.tsx`
- `src/pages/SealedDetail.tsx`
- `src/pages/DemoProfile.tsx`
- `src/components/CardGridView.tsx`
- `src/components/CollectionList.tsx`
- `src/components/SealedTab.tsx`
- `src/components/SealedGridView.tsx`
- `src/components/WishlistDashboard.tsx`
- `src/components/CurrentPrizeCard.tsx`

**Fix**: build one `<CardImage>` component with built-in `onError` → placeholder swap. Replace all raw `<img>` tags pointing to Scrydex URLs.

---

### H5 — TCGdex display text still on Market page
**File**: `src/pages/Market.tsx:674-675`

Footer says **"Prices sourced from TCGdex"** on both Top and Sealed views. TCGdex hasn't been the source for over a month. Wrong on a user-visible label.

**Fix**: change to "Prices sourced from Scrydex" or remove the attribution entirely.

---

## 🟡 MEDIUM

### M1 — `/onchain` route still wired despite being archived
**File**: `src/App.tsx:67`

Routes `/onchain` to an Onchain page that calls an unmaintained edge function. A user landing there sees broken/empty content.

**Fix**: remove the route + the import, or redirect to `/`.

---

### M2 — Slug uniqueness has a race
**File**: `src/components/ProfilePageEditor.tsx:117`

`checkSlugAvailability()` runs client-side before write. Two users picking the same slug within seconds can both pass the check; whichever DB write lands second errors out with a generic toast.

**Fix**: unique index in `supabase/migrations/20260308200558_*.sql` protects integrity — trap the `23505` error code on update and show "That slug was just taken, try another."

---

### M3 — Variant rendering: modern + vintage mix
**File**: `src/lib/pokemon-api.ts` — `expandVariants`

Cards with BOTH `::1stEditionHolofoil` AND `::holofoil` rows: only the vintage variant survives, the modern one disappears.

**Fix**: branch logic — if any vintage marker present, filter to vintage-only; otherwise emit all.

---

### M4 — Profile view tracking not deduplicated per-day
**File**: `src/pages/Profile.tsx:64-72`

`sessionStorage` dedupe means refresh tab → no double-count, but new tab → counts again. Analytics inflates views for shared/visited profiles.

**Fix**: `localStorage` keyed by `viewed_${user_id}_${date}` for once-per-day cap.

---

### M5 — `checkSubscription` swallows errors
**File**: `src/contexts/AuthContext.tsx:49-51`

If the Stripe edge function fails, `subscription` keeps its last value forever. A Free user mid-upgrade who polls during a Stripe outage shows Free permanently until manual refresh.

**Fix**: distinguish "network error → keep state" vs "Stripe says no sub → set free". Currently any throw leaves state unchanged.

---

### M6 — Email verification redirect uses raw origin
**File**: `src/pages/Auth.tsx:37`

`emailRedirectTo: window.location.origin` — after Vercel migration / custom domain, if auth is ever opened from a different host, the email links to the wrong place.

**Fix**: hardcode or env-var the production origin.

---

### M7 — `getCardPriceHistory` 90-day window
**File**: `src/lib/price-snapshots.ts:80-96`

Same shape as the bug we just fixed — chart cuts off at 90 days. For older sets with sparse pricing, the chart may show only 1-2 data points even though more history exists.

**Fix**: widen to all snapshots OR use a DISTINCT-ON style query.

---

### M8 — Recharts is the biggest bundle chunk
Production build shows `generateCategoricalChart-CMlrC0Fc.js` at 367 KB. Recharts loads for every page, not just card detail.

**Fix**: lazy-import `PriceChart` in `CardDetail`.

---

## ✅ Verified clean (was a concern, isn't)

- Pricing cache stomp (was Critical in old AUDIT.md) — fixed; `seedPricingCache` no longer clears.
- `Sets.tsx` `activePage` — fixed to `"sets"`.
- `vercel.json` SPA rewrite — correct.
- `health-check` edge function — solid; checks freshness, coverage, sealed, Scrydex usage, sample images.
- Admin route guard — `AdminLayout` wraps all admin pages with `AdminRouteGuard`.
- `GlobalSearch` — Scrydex-only, no TCGdex fallback.
- `AuthContext` subscription polling — 60s refresh works.
- Sealed tab Set sort, Recent caps, latest-per-card RPC — all just shipped, verified.

---

## Recommended order

1. **First session**: run `supabase/migrations/20260511000000_privacy_respecting_rls.sql` in Supabase SQL Editor (closes B1's DB layer). Patch `Profile.tsx` to show "private" UI when lookup returns null. B3 (ErrorBoundary — 30 min). H5 (TCGdex label — 1 min).
2. **Same day**: B4 (password reset), H1 (collection upsert), H4 (CardImage component).
3. **This week**: H2, H3, M1–M3.
4. **Polish**: M4–M8.
5. **Then**: mobile audit pass + vision-scan feature (see `vision-scan.md`).

---

## TODO: Mobile audit (next pass)

Areas to check on small viewports (≤640px):
- All bottom-nav vs header overlap
- Touch targets (44px min)
- Sort buttons hidden in mobile views (e.g. SealedTab uses `hidden sm:grid` for the header — mobile users have no sort access)
- Dialog/Drawer pattern consistency
- Card detail layout on small screens
- Collection grid columns
- Dashboard tab strip overflow
- Profile page padding/scrolling
- Image aspect ratios
- Touch-vs-hover behaviors (Popover, Tooltip, infinite scroll triggers)
- Keyboard handling for inputs on iOS Safari
