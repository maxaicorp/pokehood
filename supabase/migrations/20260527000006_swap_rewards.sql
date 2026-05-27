create table if not exists public.user_rewards (
  wallet_address text primary key,
  points integer not null default 0,
  swap_volume_usd numeric not null default 0,
  swap_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.user_rewards enable row level security;

drop policy if exists "Read user rewards" on public.user_rewards;
create policy "Read user rewards"
  on public.user_rewards for select
  using (true);

drop policy if exists "Insert swap events" on public.swap_events;
create policy "Insert swap events"
  on public.swap_events for insert
  with check (
    wallet_address <> ''
    and signature <> ''
    and input_mint <> output_mint
    and input_amount > 0
    and output_amount > 0
  );

create or replace function public.record_swap_reward(
  wallet_address_input text,
  output_usd_input numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_rewards (
    wallet_address,
    points,
    swap_volume_usd,
    swap_count,
    updated_at
  ) values (
    wallet_address_input,
    floor(greatest(output_usd_input, 0))::integer,
    greatest(output_usd_input, 0),
    1,
    now()
  )
  on conflict (wallet_address) do update set
    points = public.user_rewards.points + floor(greatest(output_usd_input, 0))::integer,
    swap_volume_usd = public.user_rewards.swap_volume_usd + greatest(output_usd_input, 0),
    swap_count = public.user_rewards.swap_count + 1,
    updated_at = now();
end;
$$;

grant execute on function public.record_swap_reward(text, numeric) to anon;
