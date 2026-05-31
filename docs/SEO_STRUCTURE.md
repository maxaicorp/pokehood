# SEO / URL structure

Canonical base: **`https://collectiblez.app`** (set in `src/components/SEO.tsx`).
Every page renders `<SEO title description path [image] [jsonLd] [noindex]>` →
`<title>`, meta description, `<link rel=canonical>`, OpenGraph/Twitter tags,
and optional JSON-LD. Titles are truncated to 60 chars, descriptions to 160.

## Slug rules (`src/lib/slug.ts`)
- **Set slug** = `kebab(set.name)` → e.g. *Ascended Heroes* → `ascended-heroes`
- **Card slug** = `kebab(name)-{localId}` → e.g. *Mega Gengar ex* #284 → `mega-gengar-ex-284`
- `kebab()` lowercases, strips accents (Pokémon→pokemon), non-alphanumeric→`-`.
- Verified: 179 physical sets → 0 slug collisions; 23,450 cards → 0 in-set collisions. No year/ID disambiguator needed.

## Indexed pages (public, crawlable)
| Route | Title pattern | Canonical path | JSON-LD |
|---|---|---|---|
| `/` (Market) | `Pokémon TCG Market Prices & Trends — Collectiblez` | `/` | yes (WebSite/Product) |
| `/explore` | `Explore Pokémon TCG Cards — Collectiblez` | `/explore` | – |
| `/sets` | `Pokémon TCG Sets & Expansions — Collectiblez` | `/sets` | – |
| `/sets/:slug` (SetDetail) | `{Set Name} — Card List & Prices ({year}) \| Collectiblez` | `/sets/{set-slug}` | yes (BreadcrumbList + ItemList) |
| `/sets/:slug/:cardSlug` (CardDetail) | `{Card Name} · {Set} — Collectiblez` | `/sets/{set-slug}/{card-slug}` | yes (Product + Breadcrumb) |
| `/card/:id` (legacy) | → **301-style canonical** to `/sets/:slug/:cardSlug` | canonical = slug URL | — |
| `/sealed/:id` (SealedDetail) | `{Product} · {Set} — Collectiblez` | `/sealed/{id}` | – |
| `/onchain`, `/onchain/:tab` | `Onchain Activity — Phygital Pokémon Cards \| Collectiblez` | `/onchain` | – |
| `/games` | `Pokémon TCG Mini-Games & Weekly Prizes — Collectiblez` | `/games` | – |
| `/u/:slug` (public Profile, published only) | `{display_name} on Collectiblez` | `/u/{slug}` | – |
| `/privacy` | `Privacy Policy — Collectiblez` | `/privacy` | – |
| `/terms` | `Terms of Service — Collectiblez` | `/terms` | – |

## Noindex pages (excluded from search)
| Route | Why |
|---|---|
| `/dashboard` | private user data (`noindex`) |
| `/auth` | login page |
| `/u/:slug` when **unpublished** | private profile gate → `noindex` + "Private profile" title |
| `/giveaway` | currently **redirects to `/`** (hidden pre-launch) |
| `*` (NotFound) | `noindex` |
| `/admin/*` | guarded, not linked |
| `/stats`, `/games/card-match`, `/demo`, `/giveaway/confirm` | utility/no SEO value |

## Social link previews (OG/Twitter unfurl)
Crawlers (Discord/Twitter/iMessage/FB) don't run JS, so previews come from the
**prerendered static HTML**, not the React SEO component.
- ✅ **Per-route OG image now set** (fixed 2026-05-31 in `prerender.mjs`): card pages unfurl with the **card art**, set pages with the set's **chase card**. Previously every prerendered page kept the generic `og-image.jpg`.
- ✅ Title + description are per-route on all prerendered pages.
- ⚠️ **Coverage gap:** only home, `/sets`, 179 set pages, and **top-500 cards by price** are prerendered. The other **~20,000 cards** are NOT prerendered → their links unfurl with the generic banner + base title. Fix = Stage B (prerender all cards — heavy build) OR a bot-UA-detecting edge function that serves per-card meta on demand. (So a chase card like Mega Gengar ex unfurls correctly; an obscure common does not — yet.)

## Known SEO gaps (pinned, non-blocking)
1. **30 sets missing from `market-sets.json`** → their `/sets/{slug}` pages won't resolve/render until the static catalog is regenerated. Mostly sealed pseudo-sets + promo buckets (see below).
2. **SPA, not prerendered** — `scripts/prerender.mjs` runs at build, but confirm non-JS crawlers get real HTML for the indexed routes above (the core SEO concern from the original plan). Sitemaps exist: `public/sitemap*.xml`, `public/robots.txt`, `public/llms.txt`.
