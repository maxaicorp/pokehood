# PokeVault Codebase Guide

## Overview

**PokeVault** is a modern React application built using Vite, TypeScript, Tailwind CSS, and shadcn/ui. It serves as a comprehensive Pokémon TCG (Trading Card Game) portfolio tracker, allowing users to search for cards, manage their collections, create wishlists, track market values, and share their portfolios publicly via Linktree-style profiles.

## Tech Stack

- **Frontend Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Routing**: React Router (v6)
- **Styling**: Tailwind CSS + shadcn/ui + Framer Motion (for animations)
- **Data Fetching**: `@tanstack/react-query`
- **Icons**: Lucide React
- **Backend**: Supabase (Auth, Database, Edge Functions)
- **Billing**: Stripe (Free / Pro tiers)
- **Card Data**: Local-first TCGdex JSON files (downloaded into `/public/data/`)

## Project Structure

```text
src/
├── assets/          # Static assets (fonts, images)
├── components/      # Reusable UI elements
│   ├── AnalyticsDashboard.tsx  # Profile views + link clicks analytics
│   ├── AppHeader.tsx           # Shared app header
│   ├── BackgroundLayer.tsx     # Ambient background effects
│   ├── CardSlider.tsx          # Card carousel for landing page
│   ├── CollectionList.tsx      # Card collection display
│   ├── LinkManager.tsx         # Manage outbound profile links
│   ├── PhoneMockup.tsx         # Phone preview component
│   ├── ProfilePageEditor.tsx   # Profile customization editor
│   ├── ProfileSettings.tsx     # Profile settings form
│   ├── QRCodeModal.tsx         # QR code sharing modal
│   ├── ThemeToggle.tsx         # Light/dark mode toggle
│   ├── WishlistDashboard.tsx   # Wishlist management UI
│   └── ui/                    # shadcn/ui primitives (49 components)
├── contexts/
│   └── AuthContext.tsx         # Supabase auth + Stripe subscription context
├── hooks/           # Custom React hooks (use-mobile, use-toast)
├── integrations/
│   ├── supabase/
│   │   ├── client.ts           # Supabase client instance
│   │   └── types.ts            # Generated DB types
│   └── lovable/                # Lovable integration metadata
├── lib/             # Core business logic
│   ├── pokemon-api.ts          # Local TCGdex data layer (card/set search)
│   ├── collection-store.ts     # Supabase-backed collection CRUD
│   ├── wishlist-store.ts       # Supabase-backed wishlist CRUD
│   ├── csv-import.ts           # CSV parsing for TCGPlayer exports
│   ├── analytics-themes.ts     # 4 analytics dashboard themes
│   ├── stripe-config.ts        # Stripe product/price IDs + tier limits
│   ├── platform-icons.tsx      # Platform icon mapping for links
│   ├── qrcode.ts               # QR code generation
│   └── utils.ts                # General utility functions
├── pages/           # Route views
│   ├── Landing.tsx         # Homepage with hero, features, card slider
│   ├── Auth.tsx            # Sign in / sign up page
│   ├── Explore.tsx         # Card search with filters, grid/list views
│   ├── Dashboard.tsx       # Collection + wishlist management, CSV import
│   ├── Profile.tsx         # Public-facing Linktree-style portfolio
│   ├── DemoProfile.tsx     # Demo version of the profile page
│   ├── Privacy.tsx         # Privacy policy
│   ├── Terms.tsx           # Terms of service
│   └── NotFound.tsx        # 404 Error page
├── test/            # Test files
├── App.tsx          # Application routing and provider setup
└── main.tsx         # Entry point

supabase/
├── functions/       # Edge functions
│   ├── check-subscription/   # Verify Stripe subscription status
│   ├── create-checkout/      # Create Stripe checkout session
│   └── customer-portal/      # Open Stripe customer portal
└── migrations/      # Database migrations (profiles, links, wishlists, analytics)

public/
└── data/            # Local TCGdex JSON files (~200 sets)
    ├── sets-list.json
    └── sets/        # Individual set JSON files with card data
```

## Core Functionalities

### 1. Authentication & Billing (`Auth.tsx`, `AuthContext.tsx`, `stripe-config.ts`)

- **Supabase Auth**: Email/password sign in and sign up.
- **Session Management**: Auth state via React Context, auto-refreshing.
- **Admin Roles**: Checked via Supabase RPC (`has_role`).
- **Stripe Subscriptions**: Free tier (20 cards, 2 links, 1 wishlist) and Pro tier ($20/yr, unlimited everything). Subscription status polled every 60s.

### 2. Card Discovery & Search (`Explore.tsx`, `pokemon-api.ts`)

- Card data is loaded from local TCGdex JSON files in `/public/data/`, eliminating API rate limits and CORS issues.
- **Advanced Filtering**: Filter by Product (TCG vs Pocket), Set, Rarity, and Energy Types. Sort by release date, name, or card number.
- **View Modes**: Toggle between Grid and List views.
- **Wishlist Integration**: Heart icon to add cards to wishlists directly from search results.

### 3. Collection Management (`Dashboard.tsx`, `collection-store.ts`)

- Collections are stored in **Supabase** (`collection_cards` table) with Row Level Security per user.
- **Add/Remove Cards**: Add cards from Explore, remove from Dashboard.
- **Quantity & Condition Tracking**: Edit quantity and condition (NM/LP/MP/HP/DMG) per card.
- **For-Sale Tagging**: Toggle cards as for-sale with optional sale price.
- **Value Calculation**: Portfolio value based on manual or market prices × quantity.
- **CSV Import**: Import from TCGPlayer CSV exports with progress feedback.

### 4. Wishlists (`WishlistDashboard.tsx`, `wishlist-store.ts`)

- Create, rename, and delete named wishlists (Supabase `wishlists` + `wishlist_cards` tables).
- Add/remove cards from wishlists with duplicate detection.
- Free tier limited to 1 wishlist with 20 cards; Pro tier unlimited.

### 5. Public Profiles (`Profile.tsx`, `ProfilePageEditor.tsx`)

- Shareable profile at `/u/:slug` displaying collection, bio, and custom links.
- **Profile Editor**: Customize display name, bio, avatar URL, and slug.
- **Link Manager**: Add/reorder/delete outbound links (eBay, TCGplayer, Discord, etc.).
- **QR Code Sharing**: Generate and share QR codes for profile URLs.

### 6. Analytics (`AnalyticsDashboard.tsx`, `analytics-themes.ts`)

- Track profile views and link clicks (Supabase `profile_views` + `link_clicks` tables).
- 4 visual themes: Dark Pro, Card Collector, Minimal Mono, Retro Pokémon.

## Data Layer

### Card Data (Local-First)

All card/set data comes from TCGdex JSON files downloaded into `/public/data/`. The `pokemon-api.ts` module:

- Loads the set list from `/data/sets-list.json`
- Fetches individual set data from `/data/sets/{setId}.json`
- Maps TCGdex format → `PokemonCard`/`PokemonSet` interfaces
- Caches in memory + attempts localStorage caching (may exceed 5MB limit)

> **Note**: TCGdex data does not include TCGplayer pricing. Market prices are currently `null` for all cards. A future integration with Scrydex is planned to restore pricing.

### User Data (Supabase)

All user-specific data is stored in Supabase with Row Level Security:

- `collection_cards` — user card collections
- `profiles` — user profiles with unique slugs
- `user_links` — custom profile links
- `wishlists` — wishlist containers
- `wishlist_cards` — cards within wishlists
- `profile_views` — profile view tracking
- `link_clicks` — link click tracking
- `user_roles` — admin/moderator roles

## State Management

- **React Query**: For server-state (caching and deduping card data + Supabase queries).
- **Supabase**: For persistent user data (collections, wishlists, profiles, links, analytics).
- **React Context** (`AuthContext`): For auth session, subscription status, and tier limits.
- **localStorage**: Analytics theme preference, card data cache (fallback).
