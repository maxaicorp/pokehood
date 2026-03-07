# PokeVault Codebase Guide

## Overview

**PokeVault** is a modern React application built using Vite, TypeScript, Tailwind CSS, and shadcn/ui. It serves as a comprehensive Pokémon TCG (Trading Card Game) portfolio tracker, allowing users to search for cards, manage their collections, track market values, and share their portfolios publicly.

## Tech Stack

- **Frontend Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Routing**: React Router (v6)
- **Styling**: Tailwind CSS + shadcn/ui + Framer Motion (for animations)
- **Data Fetching**: `@tanstack/react-query`
- **Icons**: Lucide React
- **API**: [Pokémon TCG API v2](https://pokemontcg.io/)

## Project Structure

```text
src/
├── components/      # Reusable UI elements (CardSearch, CollectionList, PhoneMockup)
├── hooks/           # Custom React hooks (use-mobile, use-toast)
├── lib/             # Core business logic and integrations
│   ├── pokemon-api.ts      # Pokemon TCG API integration and types
│   ├── collection-store.ts # Local Storage state management for collections
│   ├── csv-import.ts       # CSV parsing for TCGPlayer exports
│   └── utils.ts            # General utility functions (e.g., Tailwind class merging)
├── pages/           # Route views
│   ├── Landing.tsx         # Homepage with hero section and features breakdown
│   ├── Explore.tsx         # Advanced card search, filters, and CSV import interface
│   ├── Dashboard.tsx       # Personal collection management and portfolio stats
│   ├── Profile.tsx         # Public-facing linktree-style portfolio view
│   └── NotFound.tsx        # 404 Error page
├── App.tsx          # Application routing and provider setup
└── main.tsx         # Entry point
```

## Core Functionalities

### 1. Card Discovery & Search (`Explore.tsx`, `CardSearch.tsx`)

- Users can search the entire Pokémon TCG database using the `pokemon-api.ts` wrapper.
- **Advanced Filtering**: Filter by Set, Rarity, and Energy Types. Sort by release date, name, or card number.
- **View Modes**: Toggle between Grid and List views.
- **Live Prices**: Extracts TCGplayer market and low prices directly from the API response to show real-time value and price trends.

### 2. Collection Management (`Dashboard.tsx`, `collection-store.ts`)

- The user's collection is purely client-side, persisted in the browser's `localStorage` via `collection-store.ts`.
- **Add/Remove Cards**: Users can add queried cards to their personal "Vault" and remove them.
- **Quantity Tracking**: The app groups identical cards (same ID and condition) and tracks the quantity.
- **Value Calculation**: Dynamically computes the total portfolio value based on individual card quantities and their current market prices.
- **Stats**: Real-time display of total portfolio value, total cards owned, and unique sets collected.

### 3. Public Profiles (`Profile.tsx`)

- Inspired by "Linktree", the app provides a shareable public profile page (`/u/:slug`).
- Displays the user's total collection value and showcases top cards.
- Provides static outbound links to marketplaces like eBay, TCGplayer, Mercari, or socials like Instagram and Discord.

### 4. CSV Import (`csv-import.ts`, `Explore.tsx`)

- Users can import their existing TCGplayer collections via CSV upload.
- The app parses the CSV, queries the Pokémon TCG API to resolve the exact cards, and bulk-imports them into local storage.
- Interactive progress bar and feedback using `sonner` toasts during the import.

## API Integration Details

All external interactions go through `src/lib/pokemon-api.ts`:

- **Base URL**: `https://api.pokemontcg.io/v2`
- **Key Methods**:
  - `searchCards()` / `searchCardsAdvanced()`: Queries cards with Lucene-like query string parameters.
  - `getSets()`: Retrieves all available Pokémon sets.
  - `getLatestCards()`: Fetches the newest Pokémon cards by descending release date.

## State Management

Rather than a complex global state manager (like Redux), PokeVault relies on:

- **React Query**: For server-state (caching and deduping Pokémon TCG API requests).
- **Local Storage (`collection-store.ts`)**: For client-state (persisting the user's collection without requiring a backend database).
- **React Context / Local State**: Provided by Shadcn for components like Dialogs, Tabs, and Toasts.
