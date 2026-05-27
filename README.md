# Solana Trading Dashboard

React-first MVP for a simple Robinhood-style Solana token trading app. The current build uses mock portfolio/token data, with the business logic isolated in `packages/core` so it can be reused later by a React Native app.

## Current Features

- Trading dashboard with portfolio value, chart, token list, and buying power.
- Verified-token-only market list with search and URL-based token selection.
- Two-way Jupiter swap ticket with wallet, balance, same-token, and SOL gas validation.
- Real chart history for supported verified tokens with a local fallback when provider data is unavailable.
- Wallet connect surface for Phantom, Solflare, Backpack, and Jupiter Wallet using injected/standard wallet detection.
- Admin token verification queue scaffold with Supabase-ready storage.
- Security checks for token verification, slippage, price impact, RPC status, and non-custodial signing.
- Helius RPC and Jupiter quote endpoint configuration.
- Shared core models and helpers for tokens, trade previews, portfolio math, and formatting.

## Environment

Copy `.env.example` to `.env.local` and set:

```bash
VITE_HELIUS_API_KEY=your-helius-api-key
VITE_SOLANA_CLUSTER=mainnet-beta
VITE_JUPITER_API_KEY=your-jupiter-api-key
VITE_ADMIN_EMAILS=admin@example.com
VITE_ADMIN_WALLETS=your-admin-wallet-address
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Important: Vite `VITE_*` variables are exposed to the browser. This is fine for a phase-1 Helius browser key if it is domain-restricted in Helius, but production should proxy RPC and admin actions through a backend.

If Supabase variables are missing, the app falls back to local seed tokens and mock review data.

## Supabase Setup

Create a Supabase project, then run the migration in `supabase/migrations/20260526000001_verified_tokens.sql`.

The first table stores verified/pending token metadata. The second table stores manual review records. The frontend reads from Supabase through the public REST API when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured.

## Run Locally

```bash
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173`.

## Build

```bash
npm.cmd run build
```

## What I Need From You Next

1. Add Supabase project URL and anon key to `.env.local`.
2. Run the Supabase migration.
3. Decide whether token approval writes should happen directly through Supabase RLS or through an edge function.
4. Add trade history and audit logs once the review flow is persisted.

## What Supabase Is For

Supabase is not required for the UI, wallet detection, or Jupiter quote preview.

Supabase becomes useful when the app needs persistent backend features:

- Admin email auth and session handling.
- Postgres tables for tokens, reviews, trades, wallets, and audit logs.
- Row-level security so only admins can approve/reject tokens.
- Server-side functions for Helius/Jupiter calls that should not expose private credentials.
- Realtime updates for token review status and transaction activity.

## Suggested Next Build Step

Wire admin approve/reject actions to Supabase, then deploy a private test build.
