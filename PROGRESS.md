# Collectiblez — Working Progress

Snapshot of in-flight work across two threads: pricing pipeline overhaul + giveaway feature buildout. Last updated 2026-04-26.

---

## 1. Pricing pipeline overhaul — DONE

Goal: make the Market data tables trustworthy. Replace the reverse-engineering math, fix the runaway "1,000,000%" bug, and stop variant cross-contamination.

### Shipped (commits `1f86a15` → `fef6927`)

**Phase 1 — guardrails** (commit `7b8c8be`)
- `formatPct` renders "—" for `NaN`, `Infinity`, or `|pct| > 1000`. Garbage stops at the display boundary.
- `findHistoricalPrice` byName key now scoped by variant suffix (`name|set|variant`). `base1-4::holofoil` can't cross-match a legacy `base1-4` row.
- Card Match: nested `setTimeout` that releases the input lock is now tracked in `animLockTimer` and cleared on unmount/reset. `matchedCount` only adds 2 when both tiles are genuinely flipped.

**Phase 2 — architecture** (same commit `7b8c8be`)
- `LatestPrice` interface carries raw `price1d/7d/30d` instead of `pricePct24h/7d/30d`.
- `seedPricingCache` stores prior-day prices directly in `cardmarketAvgs.avg1/7/30`. The reverse-engineering formula (`price / (1 + pct/100)`) is gone.
- `getPcts` in Market unchanged — same formula, but now operates on real prior prices.
- `PriceChart`'s synthetic history scales by `currentPrice/trend` (now always 1.0 → more accurate).
- `sealed-store.getSealedTrends` computes pct from raw prior prices.

**Variant collapse** (commits `a0b858a`, `f304f1d`, plus Lovable's `ba6cdfd`)
- `extractAllVariantPrices` (edge function) collapses modern cards to one bare-id row when no vintage marker (`1stEdition*`, `unlimitedHolofoil`, `shadowless*`) is present in Scrydex's variants array.
- Client `expandVariants`:
  - Auto-discovers suffixes from the pricing cache (no hardcoded list).
  - For vintage cards, drops the bare row when a holo-specific variant is present (Charizard "Unlimited Holo" only, no duplicate plain row).
  - For modern cards, emits one row using best-price priority (bare → holofoil → reverseHolofoil), keeps base card id, no "(Holo)" rename.

**Other fixes shipped along the way**
- Health banner only flips to "down" when BOTH `scrydex_proxy` and `price_snapshot_freshness` fail (the app survives a stale snapshot fine via the prev1/prev2 merge).
- Market limit bumped from 200 to 300 cards (`e4822ef`).
- Lazy-loaded all page routes via `React.lazy` + Suspense (commit `1f86a15`).
- localStorage SWR cache for instant Market paint on return visits (`market-cache-v3`, 24h TTL).
- `scrydex-proxy` requires Supabase JWT + endpoint allowlist.

### Open question (data, not code)

Vintage cards (Base/Jungle/Fossil) only show **Unlimited Holo** rows. **No 1st Edition or Shadowless rows.** The all-cards.json index has zero entries mentioning those variants — they live inside Scrydex's per-card `variants` array. Need to confirm whether Scrydex actually returns `::1stEditionHolofoil` / `::shadowlessHolofoil` entries by running this in Supabase SQL editor:

```sql
SELECT card_id, price FROM price_snapshots
WHERE card_id LIKE 'base1-4%'
  AND recorded_at = (SELECT MAX(recorded_at) FROM price_snapshots)
ORDER BY card_id;
```

If only `base1-4::unlimitedHolofoil` shows up, Scrydex is the gap and the vintage variant feature can't progress further without supplementing data from another source (TCGPlayer direct, TCGdex, or hardcoded vintage card list).

---

## 2. Giveaway / sweepstakes feature — Phases 1–3 DONE, Phase 4 + ops PENDING

Goal: public `/giveaway` page → email submission → double-opt-in confirmation → admin dashboard for management.

### Shipped (commits `f197d00`, `ec30863`)

**Database** (`supabase/migrations/20260426000000_giveaways.sql`)
- `giveaways` table — title, description, prize_image_url, dates, status (`draft|active|closed|drawn`), winner_entry_id, rules_text.
- `giveaway_entries` table — full address, status (`pending|confirmed|rejected`), confirmation_token, ip_address, user_agent. Unique on `(giveaway_id, email)`.
- RLS via existing `has_role(auth.uid(),'admin')` (same pattern as `prizes` table). Public reads only `status='active'`. Admins read/write everything. Signed-in users can read their own entries.
- Storage bucket `giveaway-images` (public read, admin write).
- `updated_at` trigger.

**Edge functions** (under `supabase/functions/`)
- `giveaway-submit` — full validation (US state, ZIP regex, real email), upserts pending row with 16-byte hex token, captures IP+user_agent. Emails via Resend (gracefully degrades if `RESEND_API_KEY` unset — entry still saved). Returns `{ok, email_sent, message}`.
- `giveaway-confirm` — token-based, idempotent, flips `pending → confirmed`.

**Public surface**
- `src/pages/Giveaway.tsx` (`/giveaway`) — PrizeCard hero with countdown, value, CTA, optional collapsible rules text.
- `src/components/PrizeCard.tsx` — shared visual matched to CardMatch SlotTile front-face. Used on `/giveaway` and admin pages.
- `src/components/GiveawayEntryForm.tsx` — Dialog on desktop, Drawer on mobile (uses existing `useIsMobile`). State-machine UI: form → submitting → success/error.
- `src/pages/GiveawayConfirm.tsx` (`/giveaway/confirm`) — handles email link, three states.

**Admin dashboard** (gated by `AdminRouteGuard`)
- `/admin` — overview with active-giveaway / confirmed / pending counts, quick links.
- `/admin/giveaways` — list with status badges, value column.
- `/admin/giveaways/new` and `/admin/giveaways/:id` — shared form. Image upload to Supabase Storage with live PrizeCard preview. Edit, delete, and "Draw winner" (random pick from confirmed entries, marks `status='drawn'`). Per-giveaway entries section with manual confirm/reject and CSV export.
- `/admin/prizes` — manage existing weekly game prizes (uses `prizes` table). Same image upload and PrizeCard.

**Nav**
- Desktop header: "Giveaway" link added between Games and the avatar.
- User dropdown: "Giveaway" item for everyone, "Admin" item (with shield icon) only for admins.

**Data layer**
- `src/lib/giveaway-store.ts` — full CRUD + edge function invocations + image upload helper + winner draw.

### Pending — Phase 4 polish + ops

| Task | Why it's pending | Effort |
|---|---|---|
| **Configure Resend** | Need API key + verified sender domain. Without it, entries stay `pending` until manually confirmed in admin. | Sign up at resend.com (free tier), verify a domain (DNS records, ~10 min on registrar), drop `RESEND_API_KEY` + `GIVEAWAY_FROM_ADDRESS` in Supabase secrets. |
| **Set `SITE_URL` Supabase secret** | Confirmation URL falls back to `https://collectiblez.lovable.app` if `Origin` header missing. After Vercel migration this needs updating. | One env var. |
| **Grant admin role** | New admin code uses `user_roles` table + `has_role()` RPC. Confirm your account has `role='admin'` row. | One SQL insert (see Q&A below). |
| **Booster pack hero graphic** | Slot is ready (`prize_image_url` field + upload UI in admin). | User generates and uploads. |
| **Winner notification email** | Currently `drawWinner` only flips status + sets `winner_entry_id`. Should also email the winner. | Small addition to admin draw flow once Resend is live. |
| **Captcha + disposable email blocklist** | Add when abuse becomes real, not before. | Optional. |
| **Mobile bottom-nav slot for Giveaway** | Currently 5 tabs full. Could replace one or build a "more" overflow. | Small UX call. |

### How to access

- Public: `/giveaway` (singular). Will show "No active giveaway right now" until one is created with `status='active'`.
- Admin: log in → click avatar → "Admin" item. Direct: `/admin`.
- Grant admin to your user:
  ```sql
  INSERT INTO public.user_roles (user_id, role)
  SELECT id, 'admin'::app_role
  FROM auth.users
  WHERE email = 'collectiblezxyz@gmail.com';
  ```

---

## 3. Vercel migration — TODO

Decided to move off Lovable hosting. Lovable will keep being useful as a code-editing surface (it just commits to GitHub like any other client), but Vercel will serve the production site.

### What needs to happen

1. **Vercel project setup**
   - Import the GitHub repo `maxaicorp/pokevault` into Vercel.
   - Build command: `npm run build`. Output directory: `dist`. Install: `npm install`. Framework preset: Vite.
   - Set environment variables (anything `VITE_*` from current Lovable env). Likely just `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — confirm by checking `src/integrations/supabase/client.ts`.

2. **Domain**
   - Move `collectiblez.com` (or whichever production domain you'll use) to Vercel.
   - Update any DNS pointing at Lovable. If using `collectiblez.lovable.app` for Resend sender, set up the email subdomain on the new domain instead.

3. **Update edge function references to site URL**
   - `SITE_URL` Supabase secret → new domain.
   - `giveaway-submit` confirmation email href → uses `Origin` header (auto) or `SITE_URL` fallback.

4. **Delete Lovable-specific guards**
   - `import.meta.env.VITE_PUBLISHED_DOMAIN` is no longer present anywhere (we already use `window.location.origin`). Clean.
   - `gpt-engineer-app[bot]` commits in git history will continue but become irrelevant after the move.

5. **What stays in Supabase (unchanged)**
   - All edge functions (`scrydex-proxy`, `snapshot-prices`, `health-check`, `giveaway-submit`, `giveaway-confirm`, etc.)
   - DB and migrations
   - Storage buckets (`giveaway-images`)
   - Cron schedules for daily snapshots

### Caveats

- **Lovable's edge-function deploy is a Supabase deploy, not a Vercel deploy.** Edge functions are decoupled from where the web app is hosted, so the Vercel migration doesn't affect them. Just make sure changes to `supabase/functions/` are still deployed to Supabase after the migration (manual via `supabase functions deploy <name>` or whatever script you set up).
- **CORS on edge functions** — current functions return `Access-Control-Allow-Origin: *`, so they'll work from any domain. No changes needed.
- **Build-time secrets** — Vite only inlines `VITE_*` vars. Anything sensitive (API keys, etc.) must remain in Supabase or server-side; do NOT add to Vercel env as `VITE_*`.

---

## 4. Tomorrow's prioritized punch list

In order:

1. **Run the diagnostic SQL** for vintage variants (`base1-4%` query). This unblocks the "why are 1st Edition / Shadowless not showing" question once and for all.
2. **Set up Resend** if you want the giveaway email loop to work end-to-end before any public launch.
3. **Vercel migration** — single biggest infra change, but mostly mechanical.
4. **Grant your admin role + create a draft giveaway** to verify the full admin flow works in production.
5. **Generate the booster pack hero graphic** and upload via the admin form.
6. **Add winner-notification email** to the draw flow once Resend is live.

---

## 5. Recent commit history (this session)

```
ec30863 feat(giveaway): phase 2 + 3 — public page, entry form, admin dashboard
f197d00 feat(giveaway): phase 1 — db schema + submit/confirm edge functions
fef6927 fix(health-banner): require BOTH scrydex + freshness to fail before "down"
ba6cdfd Fixed Base Set pricing & health   ← Lovable
f304f1d fix(variants): drop bare row when a holo-specific variant is present
a0b858a fix(variants): only split rows for vintage cards
e4822ef feat(market): show top 300 cards per view (up from 200)
8230497 (rebased into e4822ef)
2cd7bce Redeployed & resumed snapshot      ← Lovable
e2fc77b perf(market): instant-paint via localStorage SWR cache
36c1ba9 fix(card-match): track input-lock timer and honor partial matches
7b8c8be fix(pricing): stop reverse-engineering prior prices from stored percents
1f86a15 chore: lazy-load routes, harden scrydex-proxy, drop dead pages
```
