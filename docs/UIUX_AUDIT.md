# UI/UX audit (component-by-component, mobile-first)

Companion to PAGE_AUDIT.md (which covered URLs/data). This pass covers the
*visual/interaction* layer — layout, mobile, empty/loading states, touch
targets, truncation. Severity: 🔴 broken · 🟡 rough · 🟢 ok/verified.

## Found this pass (2026-05-31)
- ✅ 🟡 **Dashboard stat cards smushed on mobile** — Total Value `$1,3…` truncated between the 3 grid-cols-3 cards. FIXED: Total Value now spans full width on mobile (`col-span-2 sm:col-span-1`), Cards/Sets share row 2. *Follow-up:* give Total Value its own section with a portfolio-value sparkline (bigger task — see below).
- 🔴 **Onchain activity images not loading** — CC native sales (`source='collector_crypt_native'`) show the grey "NFT" placeholder. Root cause: `ingest-cc-native` writes `image: null` (it parses the on-chain tx, which has no metadata). **Fix options:** (a) the read RPC `get_onchain_activity` LEFT JOINs `onchain_listings` on `token_mint` to borrow the image (works since cc-marketplace rows carry `frontImage`); or (b) `ingest-cc-native` looks up the image from `onchain_listings`/`nft_names` at write time. (a) is cleaner (one migration, backfills existing rows). *Deploy-gated.*
- 🟡 **Dashboard whole-page mobile reformat** — user request. Tab strip (`Collection/Wishlists/My Page/Analytics`) overflows; stats/actions/search stack awkwardly. Plan below.
- 🟢 **Explore filter close (X)** — the mobile slide-over DOES have an X (`Explore.tsx:405`); line 426 is the desktop inline sidebar (no X by design). Re-check on device which panel was open; if the X truly isn't appearing on mobile, it's a render/z-index edge case, not a missing element.

## Dashboard mobile reformat — proposed plan
1. **Hero: Total Value** as its own full-width card (done partially) + a small portfolio-value sparkline (reuse PriceChart styling / a lightweight area chart over the collection's daily value).
2. **Secondary stats** (Cards, Sets) as a compact 2-up row beneath.
3. **Tab strip** → horizontally scrollable (`overflow-x-auto scrollbar-none`) or a `Select` on `<sm`.
4. **Actions** (Import CSV / Add Cards) → full-width stacked buttons on mobile.
5. **CollectionList grid** → verify 2-col on mobile, tap targets ≥44px.

## Systematic checklist (sweep each page at ≤390px width)
- [ ] No horizontal overflow / truncated numbers (Dashboard stats ✅ fixed)
- [ ] Tap targets ≥ 44px (filter chips, vote buttons, qty steppers)
- [ ] Tab strips scroll, don't clip (Dashboard, Onchain, Market)
- [ ] Every list has loading skeleton + empty state + error state
- [ ] All card images via `<CardImage>` (placeholder on fail) — Onchain activity/marketplace still use raw `<img>` → broken "NFT" tiles
- [ ] Dialogs/sheets have a visible close affordance + backdrop dismiss
- [ ] Bottom mobile nav doesn't overlap content (pb-20 on pages)
- [ ] Long names truncate with ellipsis, don't wrap-break layout

## Priority order
1. 🔴 Onchain images (RPC join) — most visible "broken" look.
2. 🟡 Dashboard mobile reformat (user's explicit ask).
3. 🟡 Sweep the checklist page-by-page at mobile width.
