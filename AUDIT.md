# Collectiblez — Codebase Audit

Compiled from 6 parallel feature audits on 2026-04-29. Each issue tagged with severity and a suggested fix. Top of file is the prioritized fix list — go down it in order.

---

## Top 10 — fix in this order

| # | File:Line | Severity | Issue |
|---|---|---|---|
| 1 | `collection_cards` table RLS | **CRITICAL — security** | If RLS policies are missing on `collection_cards`, any authenticated user can read/modify/delete any other user's cards by id. **Verify in Supabase first** — see Audit §4. |
| 2 | [supabase/functions/giveaway-submit/index.ts](pokevault-main/pokevault-main/supabase/functions/giveaway-submit/index.ts) | **HIGH** | No rate limiting. A single IP can spam unlimited entries. Block before any public launch. |
| 3 | [src/lib/giveaway-store.ts:212](pokevault-main/pokevault-main/src/lib/giveaway-store.ts#L212) `drawWinner()` | **HIGH** | Not idempotent. Two near-simultaneous admin clicks pick different winners; second overwrites first. Check `status === 'drawn'` first and return cached `winner_entry_id`. |
| 4 | [supabase/migrations giveaway_entries](pokevault-main/pokevault-main/supabase/migrations/20260426000000_giveaways.sql) `UNIQUE(giveaway_id, email)` | **MEDIUM** | Postgres `text` is case-sensitive. `Test@x.com` and `test@x.com` both insert. Edge function lowercases on submit but the DB constraint doesn't enforce it. Migration to `UNIQUE(giveaway_id, lower(email))` via expression index. |
| 5 | [src/lib/pokemon-api.ts seedPricingCache / appendPricingCache](pokevault-main/pokevault-main/src/lib/pokemon-api.ts) | **CRITICAL — pricing** | Concurrent clear + reseed during cache refresh can stomp on values. Only clear inside full `seedPricingCache`; guard `appendPricingCache` writes. |
| 6 | [supabase/functions/giveaway-submit/index.ts:212](pokevault-main/pokevault-main/supabase/functions/giveaway-submit/index.ts#L212) origin header | **MEDIUM** | Trusts request `origin` to build the confirmation URL. Attacker can craft a phishing link by sending `origin: https://attacker.com`. Use `SITE_URL` env var as the source of truth instead. |
| 7 | [src/pages/Sets.tsx:94](pokevault-main/pokevault-main/src/pages/Sets.tsx#L94) | **MEDIUM** | `activePage="market"` should be `"sets"`. Wrong nav highlight on the Sets page. One-line fix. |
| 8 | [src/lib/pokemon-api.ts expandVariants vintage filter](pokevault-main/pokevault-main/src/lib/pokemon-api.ts) | **MEDIUM** | When a card has BOTH a vintage variant (`::1stEdition*`) AND a modern variant (`::holofoil`), the modern variant gets dropped. Should: if any vintage marker present, keep only vintage; otherwise emit all. |
| 9 | [supabase/functions/giveaway-confirm/index.ts](pokevault-main/pokevault-main/supabase/functions/giveaway-confirm/index.ts) token expiration | **MEDIUM** | Tokens never expire. A leaked token works forever. Add `confirmation_sent_at + 7 days < now()` check, return 410. |
| 10 | [src/pages/admin/AdminGiveawayForm.tsx:51-54](pokevault-main/pokevault-main/src/pages/admin/AdminGiveawayForm.tsx#L51) | **MEDIUM** | If a giveaway is deleted while you're editing it, the form spins on "Loading…" forever. Render "Not found" state when query returns null. |

---

## §1 — Market + data tables (Grade: B+)

### Intended behavior
Market paints instantly from localStorage cache, then swaps in fresh data. Top 300 cards by price (Top tab); Trending/Gainers/Losers filter and sort on % change. Sealed tab grouped by category, default ETBs newest set first. Vintage cards split into 1st Ed / Shadowless / Unlimited Holo when those rows exist; modern cards collapse to one row. % change computed from raw prior prices, never reverse-engineered.

### Issues found

| File:Line | Severity | Description | Fix |
|---|---|---|---|
| pokemon-api.ts (cache double-clear) | **Critical** | `cardmarketAvgsCache.clear()` + concurrent `appendPricingCache` calls can stomp on each other during refresh. | Only clear inside full `seedPricingCache`; never inside `appendPricingCache`. |
| pokemon-api.ts `expandVariants` (mixed vintage+modern) | **Medium** | Card with both `::1stEdition*` and `::holofoil` matches loses the modern variant. | Branch logic: if any vintage marker present, filter to vintage-only; otherwise emit all. |
| sealed-store.ts:254 sort fallback | **Minor** | `.localeCompare(b.expansionReleaseDate ?? "")` puts undefined dates at the **top** instead of bottom. | Use `?? "0000-01-01"`. |
| sealed-store.ts tin dedupe key | **Minor** | If `expansionId` is empty, all such products collapse to the same dedupe key. | Use `${p.expansionId || 'unknown'}|...`. |
| Market.tsx visibleCount + sort | **Suspicious** | After tab switch, sort applies fresh but `visibleCount` resets — first render can show stale-sort cards before re-sort kicks in. Not a current bug but fragile if touched. | Document or reset sort state on tab change. |

---

## §2 — Explore (Grade: B+)

### Intended behavior
Two-phase render: cards instant from `/data/all-cards.json`, prices fill async via `enrichPageWithPricing` (concurrency-limited, 15 workers). Filters combine (name + rarity + type + set). Pagination in non-set mode, infinite scroll in set mode. Click-through to `/card/:id`.

### Issues found

| File:Line | Severity | Description | Fix |
|---|---|---|---|
| Explore.tsx:257-260 query key | **Medium** | `cardIds.join(",")` is unstable across re-renders even when content matches → spurious refetches under load. | Sort or hash card IDs before stringifying. |
| Explore.tsx:265 | **Low** | If `enrichPageWithPricing` errors mid-flight, `pricedCards` is undefined and the grid crashes. | `const cards = pricedCards ?? rawCards;` |
| Explore.tsx:586, 646 image `<img>` | **Low** | No `onError` fallback. Broken Scrydex CDN URL → permanent broken-image icon. | Add `onError` swap to placeholder. |
| Explore.tsx:606-608 skeleton UX | **Low** | All-or-nothing skeleton; cards arrive incrementally but skeleton hides them all. | Skeleton per-card based on `tcgplayer.prices` presence. |
| Explore.tsx:529 indentation | **Trivial** | Line uses 14 spaces instead of 16. Cosmetic. | Reformat. |

---

## §3 — Sets (Grade: A−, two minor)

### Intended behavior
All ~179 physical TCG expansions grouped by series, newest first within each. Local PNG logos. Click-through filters Explore by set ID. Virtual 1st Edition sets injected when vintage pricing exists.

### Issues found

| File:Line | Severity | Description | Fix |
|---|---|---|---|
| Sets.tsx:94 | **Medium** | `activePage="market"` — should be `"sets"`. Nav highlight wrong on this page. | One-line edit. |
| all-cards.json data | **Low** | "NP" series (Nintendo Black Star Promos) and McDonald's Collection promos sort under "Other"/last. | Fix series names in upstream sync, not code. |

Otherwise solid. All logos load, lazy-loading works, responsive grid is correct, virtual sets only inject when pricing exists.

---

## §4 — Dashboard / Collection (Grade: D+ pending RLS verification, B− if RLS is correct)

### Intended behavior
Authenticated users manage a collection: view, filter, add/remove, edit qty/condition/manual price, CSV import (free-tier limit), wishlist CRUD, public profile at `/u/:slug` with portfolio value.

### Critical security finding — verify before anything else

`collection-store.ts` updates/deletes by `id` only. Functions:
- `updateCardQuantity(id, qty)` — no user_id check
- `removeFromCollection(id)` — no user_id check
- `updateCardCondition(id, ...)` — no user_id check
- `toggleForSale(id, ...)` — no user_id check

These rely entirely on Supabase RLS to prevent cross-user tampering. **Run this in Supabase SQL editor right now to verify**:

```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('collection_cards', 'wishlists', 'wishlist_items', 'profiles', 'profile_links');
```

Every row must show `relrowsecurity = true`. Then check policies:

```sql
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'collection_cards';
```

You need policies for `SELECT`, `INSERT`, `UPDATE`, `DELETE` with `qual = (auth.uid() = user_id)`. If any are missing, **any logged-in user can modify any other user's collection by guessing IDs**.

### Other issues

| File:Line | Severity | Description | Fix |
|---|---|---|---|
| Dashboard.tsx:97 CSV limit check | **Medium** | `totalCards` is fetched once at mount. Two tabs importing in parallel can both pass the limit check and exceed the cap. | Re-fetch fresh count before each batch insert, or enforce server-side. |
| csv-import.ts dedupe | **Medium** | Two "Charizard" rows in the same CSV both get added — no within-import dedupe. | Dedupe by `(name, setName, number)` before calling `resolveImport`. |
| collection-store.ts `addToCollection` race | **Medium** | Two rapid adds of the same card can race past the duplicate-check and produce two rows. | Use Postgres UPSERT with `ON CONFLICT (user_id, tcg_api_id, condition) DO UPDATE`. |
| Dashboard portfolio value | **Medium** | Uses `marketPrice` stored at add-time. Stale until card is re-added or refreshed. | Recompute from latest `pricingCache` on render. |
| CollectionList | **Low** | No UI to edit quantity or manual price; `manualPrice` field exists but is never user-editable. | Add inline editor or modal. |
| Profile.tsx slug uniqueness | **Suspicious** | No visible client-side check before set; relying on DB unique index. | Verify the index exists, and use `checkSlugAvailability()` before save. |

---

## §5 — Card Match (Grade: B+)

### Intended behavior
Server creates 20-slot session with shuffled card pairs. Client preloads images, reveals board, starts client-side timer. Each flip hits the server which validates and returns match/no-match. Mismatches flash red, flip back after 1.8s with input locked. Game completes on 10 pairs matched. Score = `10000 - floor(ms/100) - wrongFlips * 100`. Weekly leaderboard, `period_key = week`.

### Issues found

| File:Line | Severity | Description | Fix |
|---|---|---|---|
| CardMatch.tsx:215 `matchedCount` | **Medium** | Server response with `match: true` but missing `otherCard` will increment `matchedCount` by 1 instead of 2 — score/board mismatch. | Validate `res.otherCard` exists in the match-true branch; if not, treat as error. |
| game-card-match-flip:150 | **Low** | No type guards on JSONB-loaded slot cards before comparison. | Add: `if (!card || !pendingCard) return fail("Slot corrupted")`. |
| **Missing feature** | **Medium** | No code determines weekly winners or populates `prize_winners`. The `CurrentPrizeCard` reads existing prizes but no flow declares one. | Add scheduled job or admin-triggered "Award winner" action. |
| CardMatch.tsx image preload | **Low** | `preloadImagesAwait` resolves on both `load` and `error`, so failed images silently degrade. | Show "Some images failed to load — refresh?" banner if any error. |
| Timer divergence | **Suspicious** | Client timer starts at board reveal; server scores from session start. 5s preload = 5s display drift. Server is source of truth so scoring is correct, but UX confusing. | Document; consider syncing. |

Otherwise solid. The recently-fixed `animLockTimer` cleanup and `bothMatched` check are both still in place. Pause/resume math is correct. Anti-cheat (server checks already-matched + session ownership) is correct.

---

## §6 — Giveaway + Admin (Grade: C+, hardening needed before public launch)

### Intended behavior
Public `/giveaway` shows the active giveaway with countdown. Form submits → edge function inserts `pending` row + sends Resend email → user clicks link → `/giveaway/confirm?token=...` flips to `confirmed`. Resubmit before confirm = fresh token; resubmit after = 409. Admin dashboard gated by `has_role`, full CRUD + image upload + manual confirm/reject + draw winner + CSV export.

### Issues found

| File:Line | Severity | Description | Fix |
|---|---|---|---|
| giveaway-submit/index.ts | **HIGH** | No rate limiting at all. Single IP can submit unlimited entries. | Postgres-backed rate limit table or Supabase rate-limit; 5 per IP per hour. |
| giveaway-store.ts:212 `drawWinner` | **HIGH** | Two simultaneous admin clicks each pick different winners; second overwrites. | Check `status === 'drawn'` first; return existing `winner_entry_id` if so. |
| giveaway_entries unique constraint | **Medium** | `UNIQUE(giveaway_id, email)` is case-sensitive. `Test@x.com` ≠ `test@x.com`. | New migration: `CREATE UNIQUE INDEX … ON giveaway_entries (giveaway_id, lower(email))`. |
| giveaway-submit/index.ts:212 origin | **Medium** | Confirmation URL trusts request `origin` header. Phishing vector. | Use `SITE_URL` env var as authoritative; ignore `origin`. |
| giveaway-submit email regex | **Medium** | Permissive regex passes `a@b.c`. | Stricter regex or use `email-validator` library. |
| giveaway-confirm token | **Medium** | Tokens never expire — leaked tokens work forever. | Add 7-day expiration check, 410 response. |
| AdminGiveawayForm.tsx:51-54 | **Medium** | Deleted giveaway → form stuck on "Loading…". | Render "Not found" when `existing === null && !isLoading && !isNew`. |
| AdminGiveawayForm.tsx:162 client-side date | **Low** | No validation that `startsAt < endsAt` before save; user sees generic error. | Add client toast before insert. |
| AdminGiveawayForm.tsx CSV export | **Low** | Doesn't escape newlines in cell values. | Replace `\n` with `\\n` or wrap all fields in quotes. |
| Multiple Mike's | **Suspicious** | Countdown uses client clock; server uses server clock. Skewed clocks → user sees "Ended" but server still accepts, or vice versa. Acceptable but document. | Add 30s grace window on server. |

---

## Cross-cutting findings

- **No image error fallbacks anywhere**. Card images, prize images, profile avatars — all lack `onError` swaps. Broken CDN URL = broken UI everywhere.
- **No automated tests at all**. Every fix in this audit is a hand-verification. A small unit-test layer for pricing math (`getMarketPrice`, `findHistoricalPrice`, `formatPct`) would catch the next regression instantly.
- **Sentry / error reporting absent**. Production errors go into the void.
- **Index-based React keys** in a few places (game slots, market rows) — safe in their current contexts but fragile if list ordering ever becomes dynamic.

---

## Recommended next steps

1. **Right now** — verify `collection_cards` RLS in Supabase. If missing, fix immediately. (5 min)
2. **Today** — fix Top-10 items #2, #3, #5, #7, #8 (giveaway race, pricing cache stomp, sets activePage, vintage variant filter, drawWinner idempotency). All small, well-contained edits.
3. **This week** — Top-10 #4, #6, #9, #10 (giveaway hardening: case-insensitive unique, origin header, token expiry, deleted-giveaway state).
4. **Before launching the giveaway publicly** — rate limiting + token expiration + abuse protection are non-negotiable.
5. **Long-term** — image fallback component used everywhere, basic unit tests for pricing math, Sentry or similar for production error capture.
