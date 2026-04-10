# Collectiblez — Project Documentation

## Overview
Collectiblez is a Pokémon TCG collection tracker and market analytics platform. Users can search cards, build collections, track market prices, manage wishlists, and share public profile pages. The site is built with React 18, Vite, Tailwind CSS, and Lovable Cloud (Supabase) for backend services.

**Live URL:** https://collectiblez.lovable.app  
**Default theme:** Dark mode  

---

## Tech Stack
- **Frontend:** React 18, TypeScript, Vite 5, Tailwind CSS 3
- **UI Library:** shadcn/ui (Radix primitives), Framer Motion animations
- **State/Data:** TanStack React Query, Supabase JS client
- **Backend:** Lovable Cloud (Supabase) — PostgreSQL, Auth, Storage, Edge Functions
- **Payments:** Stripe (Pro subscription — $20/year)
- **Charts:** Recharts (price history)

### API Data Strategy

| Concern | Primary Source | Fallback |
|---|---|---|
| **Card index** (`all-cards.json`) | Scrydex (synced via `scripts/sync-scrydex-cards.js`) | — |
| **Card detail** (`/card/:id`) | Scrydex proxy edge function | TCGdex REST API |
| **Card search** (GlobalSearch) | Scrydex `getCards()` via proxy | TCGdex REST API |
| **Set/expansion listing** (`/sets`) | Scrydex `getExpansions()` via proxy | — |
| **Sealed products** | Scrydex (synced via `scripts/sync-scrydex-sealed.js`) | — |
| **Card images** | 1. Supabase `card-images` storage (cached top cards) → 2. Scrydex CDN → 3. TCGdex CDN | — |
| **Set logos** | Local files (`public/data/logos/*.png`) | — |
| **API health check** (AppHeader banner) | Scrydex proxy ping | TCGdex ping |
| **Landing page card slider** | Scrydex CDN images | TCGdex CDN (onError fallback) |
| **Price snapshots** | Scrydex via `snapshot-prices` edge function | — |

> **Note:** The migration from TCGdex → Scrydex was completed in April 2026. TCGdex is only used as a fallback where noted. All new data (card IDs, images, prices) uses Scrydex format.

---

## Pages & Routes

| Route | Component | Description |
|---|---|---|
| `/` | `Market` | Homepage — market dashboard with card/sealed pricing tabs |
| `/market` | `Market` | Same as above (alias) |
| `/explore` | `Explore` | Card search with filters (set, rarity, type, etc.) |
| `/sets` | `Sets` | Browse all TCG expansions grouped by series |
| `/card/:id` | `CardDetail` | Individual card detail — image, price chart, related cards |
| `/dashboard` | `Dashboard` | Authenticated user dashboard — collection, wishlists, profile editor, analytics |
| `/auth` | `Auth` | Login/signup page |
| `/u/:slug` | `Profile` | Public profile page (shareable link) |
| `/demo` | `DemoProfile` | Demo profile showcase |
| `/privacy` | `Privacy` | Privacy policy |
| `/terms` | `Terms` | Terms of service |

---

## Key Features

### Market Page (`/`, `/market`)
- **Tabs:** Top, Sealed, Trending, Gainers, Losers, Most Visited
- **Card tabs:** Set selector (all, recent 5, recent 10, individual sets), sortable columns (price, 24h%, 7d%, 30d%)
- **Sealed tab:** Product type filter (Booster Box, ETB, etc.), own header row, infinite scroll
- **Products without pricing are hidden** (Japanese sealed products filtered out)
- **"Case" wholesale products filtered out**

### Explore Page (`/explore`)
- Full card search with query, set filter, rarity, type, sort options
- Add to collection / wishlist actions
- Pricing enrichment from Scrydex
- Cards from "Pokémon TCG Pocket" series excluded

### Sets Page (`/sets`)
- All TCG expansions grouped by series (newest first) — fetched from Scrydex API
- **Logos stored locally** in `public/data/logos/` (154 PNG files, no external API dependency)
- Search filter for expansions
- "Pokémon TCG Pocket" series hidden/archived
- Click set → navigates to Explore filtered by that set

### Card Detail (`/card/:id`)
- Large card image, set info, rarity badge
- Price chart (historical price snapshots from `price_snapshots` table)
- Related cards from same set (CardSlider component)
- Add to collection / wishlist actions
- View count tracking

### Dashboard (`/dashboard`) — Requires Auth
- **Collection tab:** View owned cards, search/filter, CSV import, quantity/condition management
- **Wishlists tab:** Multiple wishlists (Pro: unlimited; Free: 1 list, 20 cards)
- **My Page tab:** Profile editor (display name, bio, avatar upload, slug, published toggle, link manager)
- **Analytics tab:** Profile views, link clicks, collection stats with themed charts

### Public Profile (`/u/:slug`)
- Display name, bio, avatar
- Collection value display
- Card grid with lazy loading
- Social/contact links
- QR code sharing
- Cards marked "for sale" highlighted

### Authentication (`/auth`)
- Email/password login and signup
- Email verification required (no auto-confirm)
- Particle animation background

---

## Database Tables

| Table | Purpose |
|---|---|
| `profiles` | User display name, bio, avatar, slug, published status |
| `collection_cards` | User card collections with quantity, condition, pricing |
| `wishlists` | Named wishlist containers per user |
| `wishlist_cards` | Cards within wishlists |
| `user_links` | Social/contact links for profile pages |
| `link_clicks` | Analytics — tracks link click events |
| `profile_views` | Analytics — tracks profile page views |
| `price_snapshots` | Historical price data for cards and sealed products |
| `card_stats` | Aggregate card popularity (views, searches, collection adds, wishlist adds) |
| `user_roles` | Role-based access (admin, moderator, user) |

### Storage
- **`avatars` bucket** (public) — user profile images (WebP compressed client-side)
- **`card-images` bucket** — cached card images for top-value cards

---

## Edge Functions

| Function | Purpose |
|---|---|
| `scrydex-proxy` | Proxies all Scrydex API requests (cards, expansions, sealed, search) with auth headers |
| `snapshot-prices` | Scheduled — snapshots card prices from Scrydex to `price_snapshots` |
| `snapshot-sealed` | Scheduled — snapshots sealed product prices from Scrydex |
| `check-subscription` | Verifies Stripe subscription status |
| `create-checkout` | Creates Stripe checkout sessions for Pro upgrade |
| `customer-portal` | Redirects to Stripe customer portal |

---

## Subscription Tiers

| Feature | Free | Pro ($20/yr) |
|---|---|---|
| Collection cards | 20 | Unlimited |
| Links | 2 | Unlimited |
| Custom slug | ✗ | ✓ |
| Wishlists | 1 | Unlimited |
| Wishlist cards | 20 | Unlimited |

---

## Static Data
- `public/data/sets-list.json` — master list of all TCG sets (logos point to local `/data/logos/` files)
- `public/data/sets/*.json` — individual set card data (one file per set)
- `public/data/logos/*.png` — 154 locally stored set logo images
- `public/data/all-cards.json` — combined card index (23,450 cards across 197 sets, synced from Scrydex)
- `public/data/sealed-products.json` — sealed product catalog (synced from Scrydex)
- `public/data/card-image-overrides.json` — Supabase-cached image URL overrides for top cards

---

## Key Libraries & Components
- **AppHeader** — Shared navigation with global search, theme toggle, auth menu, API health banner (checks Scrydex → TCGdex)
- **GlobalSearch** — Site-wide card search overlay (Scrydex primary, TCGdex fallback)
- **CollectionList** — Sortable card list with for-sale toggles, condition editing
- **SealedTab** — Sealed product market table with infinite scroll
- **PriceChart** — Recharts-based historical price visualization
- **ProfilePageEditor** — Live phone mockup preview of public profile
- **PhoneMockup** — iPhone-style frame for profile preview
- **CardSlider** — Horizontal card carousel (Scrydex CDN, TCGdex fallback)
- **QRCodeModal** — QR code generator for profile sharing
- **AnalyticsDashboard** — Charts for profile views, link clicks, card stats
- **BackgroundLayer** — Animated dot pattern background

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/sync-scrydex-cards.js` | Fetches all cards from Scrydex API → builds `public/data/all-cards.json` |
| `scripts/sync-scrydex-sealed.js` | Fetches sealed products from Scrydex → builds `public/data/sealed-products.json` |
| `scripts/download-set-logos.js` | Downloads set logo PNGs to `public/data/logos/` |
| `scripts/build-card-index.js` | Builds search-optimized card index from set JSONs |
| `scripts/cache-card-images.js` | Caches top card images to Supabase storage |

---

## Recent Changes (April 2026)

### API Migration: TCGdex → Scrydex (April 6–10)
- **Primary data source migrated to Scrydex API** for all card metadata, pricing, search, and set listings
- TCGdex retained as fallback only (card detail, global search, health check, slider images)
- All card IDs in `all-cards.json` now use Scrydex format
- `scrydex-proxy` edge function handles all Scrydex API calls with X-Api-Key/X-Team-ID auth
- Mega Evolution sets restored (were incorrectly filtered as "online-only" — only TCG Pocket sets are filtered)
- `TCGP_SERIES_IDS` filter fixed to only exclude `"pokémon tcg pocket"` series

### Other Changes
- Dark mode set as default theme
- Set logos downloaded locally (no longer pings external APIs for logos)
- "Pokémon TCG Pocket" series archived/hidden from Sets and Explore pages
- Sealed tab: removed search bar, moved type filter to header row
- Sealed tab: fixed duplicate header rows (shared "Card" header hidden when Sealed active)
- Sealed products without price data hidden from display
