# Migration runbook — Lovable → Vercel + self-owned Supabase

Goal: get fully off Lovable. Same repo, same `collectiblez.app` domain, **new Supabase
project you own**, hosted on **Vercel** (which serves the prerendered pages at clean
URLs — the thing Lovable's host refused to do, and the entire reason the 20k pages
were "Discovered, currently not indexed").

Pre-launch, no real users → **nothing to migrate but schema + functions + reference
data.** No user/collection/Stripe-subscription data to preserve.

> Status: this is the **plan + the SQL/config files**, authored ahead of time. Nothing
> here has been run against any live system. Execute it deliberately when ready.

---

## 0. Prereqs (local)
- Supabase CLI: `npm i -g supabase` (or `scoop install supabase`)
- The Scrydex, Stripe, Helius, Jupiter, Resend keys (you hold these)
- A new random `CRON_SECRET` (do **not** reuse the leaked `CharlieDemon333`)

## 1. Create the new Supabase project (you own it)
Supabase dashboard → New project (your own org). Note the new **project ref**
(`xxxxxxxxxxxx`) and the **anon/publishable** + **service_role** keys.

## 2. Link the repo + push the schema (77 migrations)
```bash
# from repo root
supabase link --project-ref <NEW_REF>          # update supabase/config.toml project_id to <NEW_REF>
supabase db push                                # replays all 77 migrations in order
```
Enable extensions if a migration doesn't: `create extension if not exists pg_cron;`
`create extension if not exists pg_net;` `create extension if not exists pg_trgm;`

## 3. Deploy all 28 edge functions
```bash
for fn in backfill-price-history cc-discovery-run cc-price-check check-subscription \
  create-checkout customer-portal game-card-match-flip game-card-match-start \
  generate-content-signals giveaway-confirm giveaway-submit heal-onchain health-check \
  ingest-cc-marketplace ingest-cc-native ingest-onchain-activity ingest-onchain-listings \
  onchain-activity onchain-listings onchain-top-sales scrydex-new-sets-check scrydex-proxy \
  scrydex-webhook snapshot-prices snapshot-sealed sol-price sync-cards-catalog verify-and-heal; do
  supabase functions deploy "$fn" --project-ref <NEW_REF>
done
```
JWT-verify settings come from `supabase/config.toml` — confirm the public ones
(scrydex-proxy, onchain-*, sol-price, game-*, giveaway-*) match the old project.

## 4. Set edge-function secrets (13)
```bash
supabase secrets set --project-ref <NEW_REF> \
  SCRYDEX_API_KEY=...  SCRYDEX_TEAM_ID=...  SCRYDEX_WEBHOOK_SECRET=... \
  STRIPE_SECRET_KEY=...  HELIUS_API_KEY=...  JUPITER_API_KEY=...  RESEND_API_KEY=... \
  CRON_SECRET=<NEW_CRON_SECRET>  GIVEAWAY_FROM_ADDRESS=...  SITE_URL=https://collectiblez.app
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.)

## 5. Schedule the crons
Run **`docs/new-supabase/01_crons.sql`** in the new project's SQL editor after
find/replacing `__PROJECT_REF__` and `__CRON_SECRET__`.
⚠️ Before go-live, run `SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;`
on the OLD project and paste it to me so I can reconcile the CC/onchain jobs the repo
doesn't document (see the RECONCILE block at the bottom of 01_crons.sql).

## 6. Full populate
Run **`docs/new-supabase/02_full_populate.sql`** (seed sets → crawl all → build caches
→ sealed → cards catalog → kickstart onchain). ~20k cards priced in one sitting.

## 7. Reconfigure external services (point them at the new project)
- **Stripe**: recreate the product/price (or reuse), update the **price id** in
  `src/lib/stripe-config.ts`, and point the **webhook** at
  `https://<NEW_REF>.supabase.co/functions/v1/<stripe-webhook fn>`. Update `STRIPE_SECRET_KEY`.
- **Google OAuth**: Supabase → Auth → Providers → Google (client id/secret). In Google
  Cloud console add the redirect `https://<NEW_REF>.supabase.co/auth/v1/callback`.
- **Auth URL config**: Supabase → Auth → URL config → Site URL `https://collectiblez.app`,
  add redirect URLs (prod + the Vercel preview domain + `http://localhost:8080`).

## 8. Frontend env → new project
Set in **Vercel** (and local `.env`):
```
VITE_SUPABASE_URL=https://<NEW_REF>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<new anon/publishable key>
```

## 9. Deploy to Vercel
- Import `maxaicorp/pokevault` in Vercel.
- Build command **`npm run build`** (runs the prerender via `postbuild` — NOT `build:app`,
  which skips it). Output dir **`dist`**.
- Add the two `VITE_SUPABASE_*` env vars + the Supabase service vars the **prerender**
  needs to embed prices (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
- `vercel.json` (already set: `cleanUrls:true` + SPA fallback) makes Vercel serve
  `dist/sets/x/index.html` at `/sets/x` and fall back to the shell only for fileless
  routes (`/dashboard`, `/card/:id`, `/u/:slug`).

## 10. Verify BEFORE moving DNS
On the `*.vercel.app` URL:
```bash
curl -s -A Googlebot https://<proj>.vercel.app/sets/ascended-heroes | grep -i canonical
#  EXPECT: <link rel="canonical" href="https://collectiblez.app/sets/ascended-heroes" />
#  (NOT  .../">  — that was the bug)
```
Also run `docs/LAUNCH_READINESS.sql` on the new project → expect the PASS table.

## 11. Cut over DNS
Point `collectiblez.app` (Cloudflare DNS) at Vercel per Vercel's domain instructions.
Keep Lovable until verified, then retire it.

## 12. Post-cutover SEO (only now)
GSC → Sitemaps → resubmit `https://collectiblez.app/sitemap.xml`; URL-inspect a few
set/card pages → Request Indexing. The "Discovered, not indexed" bucket should start
draining within days because each page finally returns its own canonical/title.

---

### Risk register
- **Crons not in repo** (CC ingest, top-sales, heal) — reconcile via the live `cron.job`
  dump (step 5). Everything else is codified.
- **Secrets / Stripe / OAuth** — only you have these; can't be automated from here.
- **Scrydex credits** — the full populate + any history backfill spend credits.
- **Leaked `CRON_SECRET`** — rotate it; never put the literal back in the repo.
