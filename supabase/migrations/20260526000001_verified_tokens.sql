create table if not exists public.verified_tokens (
  mint text primary key,
  symbol text not null,
  name text not null,
  logo_url text,
  decimals integer not null check (decimals >= 0),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected', 'paused')),
  price_usd numeric,
  change_24h numeric,
  balance numeric not null default 0,
  liquidity_usd numeric not null default 0,
  risk_level text not null default 'medium' check (risk_level in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.token_reviews (
  id uuid primary key default gen_random_uuid(),
  mint text not null references public.verified_tokens(mint) on delete cascade,
  submitted_by text not null,
  submitted_at timestamptz not null default now(),
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz
);

create index if not exists verified_tokens_status_liquidity_idx
  on public.verified_tokens (status, liquidity_usd desc);

create index if not exists token_reviews_status_submitted_idx
  on public.token_reviews (status, submitted_at desc);

create unique index if not exists token_reviews_one_pending_per_mint_idx
  on public.token_reviews (mint)
  where status = 'pending';

alter table public.verified_tokens enable row level security;
alter table public.token_reviews enable row level security;

drop policy if exists "Read verified tokens" on public.verified_tokens;
create policy "Read verified tokens"
  on public.verified_tokens for select
  using (status = 'verified' or status = 'pending');

drop policy if exists "Read pending reviews" on public.token_reviews;
create policy "Read pending reviews"
  on public.token_reviews for select
  using (status = 'pending');
