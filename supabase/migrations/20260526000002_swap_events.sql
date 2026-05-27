create table if not exists public.swap_events (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  signature text not null unique,
  input_mint text not null,
  input_symbol text not null,
  input_amount numeric not null,
  output_mint text not null,
  output_symbol text not null,
  output_amount numeric not null,
  output_usd numeric not null default 0,
  route text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists swap_events_wallet_created_idx
  on public.swap_events (wallet_address, created_at desc);

alter table public.swap_events enable row level security;

drop policy if exists "Read own swap events" on public.swap_events;
create policy "Read own swap events"
  on public.swap_events for select
  using (true);

-- For production, writes should go through an authenticated edge function or
-- custom JWT that proves wallet ownership. Keep this policy disabled by default.
