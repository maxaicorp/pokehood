# PokeVault — Codebase & Feature Guide

## Overview

**PokeVault** is a full-stack Pokémon TCG portfolio tracker built with React, TypeScript, and Supabase (Lovable Cloud). Users can search cards, manage collections, track market values, mark cards for sale, and share public linktree-style profile pages.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS, shadcn/ui, Framer Motion |
| Data Fetching | @tanstack/react-query |
| Icons | Lucide React, react-icons (brand icons) |
| Backend | Supabase (Lovable Cloud) — PostgreSQL, Auth, Storage, Edge Functions |
| Payments | Stripe (checkout, customer portal) |
| API | [Pokémon TCG API v2](https://pokemontcg.io/) |

---

## Project Structure

```text
src/
├── components/
│   ├── BackgroundLayer.tsx     # Animated background effects
│   ├── CardSearch.tsx          # Card search input with autocomplete
│   ├── CardSlider.tsx          # Horizontal card carousel
│   ├── CollectionList.tsx      # Dashboard collection grid with actions
│   ├── LinkManager.tsx         # Linktree-style link CRUD with platform dropdown
│   ├── NavLink.tsx             # Active-aware navigation link wrapper
│   ├── PhoneMockup.tsx         # iPhone mockup for profile preview
│   ├── ProfilePageEditor.tsx   # Dashboard profile settings editor
│   ├── ProfileSettings.tsx     # Profile display name/slug/bio form
│   ├── QRCodeModal.tsx         # QR code share dialog
│   ├── ThemeToggle.tsx         # Light/dark mode toggle
│   └── ui/                    # shadcn/ui primitives
├── contexts/
│   └── AuthContext.tsx         # Auth provider with user, isPro, limits, signOut
├── lib/
│   ├── pokemon-api.ts          # Pokémon TCG API wrapper and types
│   ├── collection-store.ts     # Supabase collection CRUD operations
│   ├── csv-import.ts           # CSV parsing for bulk imports
│   ├── platform-icons.tsx      # Brand icon detection (eBay, Instagram, etc.)
│   ├── qrcode.ts               # QR code generation utility
│   ├── stripe-config.ts        # Stripe product/price config
│   └── utils.ts                # Tailwind class merging helpers
├── pages/
│   ├── Landing.tsx             # Marketing homepage with hero + features
│   ├── Dashboard.tsx           # Collection management + profile editor
│   ├── Explore.tsx             # Advanced card search with filters
│   ├── Profile.tsx             # Public-facing profile page (/u/:slug)
│   ├── Auth.tsx                # Login/signup page
│   └── NotFound.tsx            # 404 page
├── integrations/
│   └── supabase/               # Auto-generated Supabase client + types
└── supabase/
    └── functions/              # Edge functions (checkout, subscription, portal)
```

---

## Database Schema

### `profiles`
| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid | References auth user |
| display_name | text | Profile display name |
| slug | text | URL slug for public profile |
| bio | text | Short bio |
| avatar_url | text | Avatar image URL |
| is_published | boolean | Whether profile is publicly listed |

### `collection_cards`
| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid | Card owner |
| tcg_api_id | text | Pokémon TCG API card ID |
| name, set_name, set_id, card_number, rarity | text | Card metadata |
| condition | text | Card condition (NM, LP, etc.) |
| quantity | integer | Number of copies |
| manual_price / market_price | numeric | User-set or API-fetched price |
| for_sale | boolean | Whether card is listed for sale |
| sale_price | numeric | Asking price when for sale |
| image_small / image_large | text | Card image URLs |

### `user_links`
| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid | Link owner |
| label | text | Display label (e.g. "eBay", "Instagram") |
| url | text | Link URL |
| sort_order | integer | Display order |

### `user_roles`
| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid | User reference |
| role | app_role enum | admin, moderator, or user |

---

## Core Features

### 1. Navigation & Layout

- **Consistent nav bar** across Dashboard and Explore pages with PokeVault logo, Dashboard link, Explore link
- **Profile avatar dropdown** (top-right) consolidates: account info, Upgrade to Pro, My Profile link, Share QR Code, theme toggle (light/dark), and Sign Out
- **No back button on dashboard** — users navigate via the nav bar to stay on-platform
- Landing page has its own floating pill nav with Explore, Dashboard, Get Started, and theme toggle

### 2. Card Discovery & Search (Explore)

- Full-text search against the Pokémon TCG API
- **Sidebar filters**: Product line (TCG/Pocket), Set, Rarity, Energy Type
- **Sort options**: Newest, name, card number
- **View modes**: Grid and List toggle
- **Live prices**: TCGplayer market and low prices displayed per card
- **Pagination**: Full page navigation with ellipsis
- Same nav bar + avatar dropdown as Dashboard

### 3. Collection Management (Dashboard)

- **Stats bar**: Total Value, Cards count, Sets count
- **Search**: Filter your collection by name, set, or rarity
- **Add cards**: Via Explore page or CSV import
- **CSV Import**: Parses TCGPlayer exports, resolves cards via API, bulk imports with progress bar
- **Card actions**: Remove, change condition, adjust quantity
- **For-sale toggle**: Mark individual cards for sale with a dollar sign button
- **Tabs**: Collection tab + My Page tab (profile editor)

### 4. For-Sale System

- Cards can be marked "for sale" via the dashboard collection
- **Green dot indicator**: Appears on the public profile page (top-left corner of each for-sale card) with `z-10` to render above card images
- **Contact seller icon**: Green message bubble (top-right of public profile) with pulsing animation — only shows when cards are for sale AND user has links configured
- **Popover**: Clicking the contact icon reveals all the seller's social/marketplace links
- Contact is off-platform (Instagram DM, eBay, Discord, etc.) to avoid platform liability

### 5. Public Profiles (/u/:slug)

- **Linktree-style** shareable profile at `/u/:slug`
- Displays: avatar, display name, bio, collection value, external links, card gallery
- **Brand icons** on links: Auto-detected from label/URL (eBay, Instagram, Discord, YouTube, TCGPlayer, etc.) using react-icons Simple Icons
- **QR code sharing**: "Share via QR" button generates scannable QR code
- **Infinite scroll**: Cards load 20 at a time with IntersectionObserver, spinner shown while loading more
- **Private badge**: If `is_published` is false, a lock icon + "Private Profile" badge appears (but page remains accessible)
- **Contact icon**: Green floating message button (top-right) with popover showing seller's links

### 6. Link Manager (Dashboard → My Page)

- **Platform dropdown**: Pre-populated with top platforms (eBay, TCGPlayer, Instagram, Discord, YouTube, Twitch, TikTok, X, Facebook, Etsy, Shopify, PayPal, WhatsApp, Telegram, Reddit, Patreon, GitHub) with brand icons
- **Custom option**: "Custom" choice reveals a free-text label field
- **Drag-to-reorder**: Links can be reordered via drag handles
- **Free tier limit**: Configurable max links for free users with upgrade prompt

### 7. Platform Icon System (`platform-icons.tsx`)

- `getPlatformIcon(labelOrUrl, className)` — auto-detects platform from text and returns the brand SVG icon with correct brand color
- `detectPlatform(labelOrUrl)` — returns platform info (icon, color, name) or null
- `PLATFORM_PRESETS` — exported array for the link manager dropdown
- Supports 17+ platforms with fallback to Globe icon for unrecognized links

### 8. Authentication & Authorization

- Email/password auth via Supabase Auth
- Auto-creates profile on signup (via `handle_new_user` trigger)
- Role-based access via `user_roles` table + `has_role()` security definer function
- Admin auto-assignment on signup for designated email

### 9. Pro/Free Tier System

- **Free tier**: Limited cards and links
- **Pro tier**: Unlimited cards, links, custom slug
- Stripe integration via edge functions: `create-checkout`, `check-subscription`, `customer-portal`
- Pro status checked via `useAuth()` context (`isPro`, `limits`)

### 10. Theme System

- Light/dark mode via `next-themes`
- Theme toggle accessible from avatar dropdown (Dashboard/Explore) and landing page nav
- Semantic design tokens in `index.css` for consistent theming

---

## RLS (Row-Level Security) Policies

| Table | Policy | Access |
|-------|--------|--------|
| collection_cards | Cards are publicly viewable | SELECT: true (restrictive) |
| collection_cards | Users can manage their own cards | ALL: auth.uid() = user_id |
| profiles | Public profiles are viewable by everyone | SELECT: true (restrictive) |
| profiles | Users can insert/update their own profile | INSERT/UPDATE: auth.uid() = user_id |
| user_links | Links are publicly viewable | SELECT: true (restrictive) |
| user_links | Users can manage their own links | ALL: auth.uid() = user_id |
| user_roles | Users can view their own roles | SELECT: auth.uid() = user_id |

---

## Edge Functions

| Function | Purpose |
|----------|---------|
| `create-checkout` | Creates Stripe checkout session for Pro upgrade |
| `check-subscription` | Verifies active Stripe subscription status |
| `customer-portal` | Redirects to Stripe customer portal for billing management |

---

## Storage

| Bucket | Public | Purpose |
|--------|--------|---------|
| avatars | Yes | User profile avatar uploads (WebP compressed client-side) |

---

## Key Environment Variables

| Variable | Description |
|----------|-------------|
| VITE_SUPABASE_URL | Supabase project URL |
| VITE_SUPABASE_PUBLISHABLE_KEY | Supabase anon key |
| STRIPE_SECRET_KEY | Stripe secret (edge function secret) |

---

## Routes

| Path | Page | Auth Required |
|------|------|---------------|
| `/` | Landing | No |
| `/auth` | Login/Signup | No |
| `/dashboard` | Collection + Profile Editor | Yes |
| `/explore` | Card Search & Discovery | No (add-to-collection requires auth) |
| `/u/:slug` | Public Profile | No |
