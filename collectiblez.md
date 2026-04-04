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
- **Card Data API:** TCGdex (card/set data), Scrydex (sealed product pricing)
- **Charts:** Recharts (price history)

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
- Pricing enrichment from TCGdex
- Cards from "Pokémon TCG Pocket" series excluded

### Sets Page (`/sets`)
- All TCG expansions grouped by series (newest first)
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

---

## Edge Functions

| Function | Purpose |
|---|---|
| `scrydex-proxy` | Proxies requests to Scrydex API for sealed product data |
| `snapshot-prices` | Scheduled — snapshots card prices to `price_snapshots` |
| `snapshot-sealed` | Scheduled — snapshots sealed product prices |
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
- `public/data/all-cards.json` — combined card index for search

---

## Key Libraries & Components
- **AppHeader** — Shared navigation with global search, theme toggle, auth menu, API health banner
- **GlobalSearch** — Site-wide card search overlay
- **CollectionList** — Sortable card list with for-sale toggles, condition editing
- **SealedTab** — Sealed product market table with infinite scroll
- **PriceChart** — Recharts-based historical price visualization
- **ProfilePageEditor** — Live phone mockup preview of public profile
- **PhoneMockup** — iPhone-style frame for profile preview
- **CardSlider** — Horizontal card carousel (used in card detail)
- **QRCodeModal** — QR code generator for profile sharing
- **AnalyticsDashboard** — Charts for profile views, link clicks, card stats
- **BackgroundLayer** — Animated dot pattern background

---

## Recent Changes (April 2026)
- Dark mode set as default theme
- Set logos downloaded locally (no longer pings TCGdex API for logos)
- "Pokémon TCG Pocket" series archived/hidden from Sets and Explore pages
- Sealed tab: removed search bar, moved type filter to header row
- Sealed tab: fixed duplicate header rows (shared "Card" header hidden when Sealed active)
- Sealed products without price data hidden from display
