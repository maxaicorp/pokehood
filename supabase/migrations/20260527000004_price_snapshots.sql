create table if not exists public.price_snapshots (
  id uuid primary key default gen_random_uuid(),
  mint text not null references public.verified_tokens(mint) on delete cascade,
  symbol text not null,
  price_usd numeric not null,
  liquidity_usd numeric,
  change_24h numeric,
  source text not null default 'jupiter',
  recorded_minute timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (mint, recorded_minute)
);

create index if not exists price_snapshots_mint_recorded_idx
  on public.price_snapshots (mint, recorded_at desc);

alter table public.price_snapshots enable row level security;

drop policy if exists "Read price snapshots" on public.price_snapshots;
create policy "Read price snapshots"
  on public.price_snapshots for select
  using (
    exists (
      select 1
      from public.verified_tokens token
      where token.mint = price_snapshots.mint
        and token.status = 'verified'
    )
  );

drop policy if exists "Insert verified Jupiter snapshots" on public.price_snapshots;
create policy "Insert verified Jupiter snapshots"
  on public.price_snapshots for insert
  with check (
    source = 'jupiter'
    and exists (
      select 1
      from public.verified_tokens token
      where token.mint = price_snapshots.mint
        and token.status = 'verified'
    )
  );
