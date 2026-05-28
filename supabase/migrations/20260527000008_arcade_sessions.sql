create table if not exists public.arcade_sessions (
  id uuid primary key default gen_random_uuid(),
  wallet_address text,
  game_key text not null default 'number_drop',
  score integer not null default 0,
  points_earned integer not null default 0,
  max_combo integer not null default 0,
  correct_count integer not null default 0,
  missed_count integer not null default 0,
  wrong_count integer not null default 0,
  duration_seconds integer not null default 60,
  seed text not null default '',
  created_at timestamptz not null default now(),
  constraint arcade_sessions_score_check check (score >= 0),
  constraint arcade_sessions_points_check check (points_earned >= 0),
  constraint arcade_sessions_duration_check check (duration_seconds between 1 and 600)
);

alter table public.arcade_sessions enable row level security;

drop policy if exists "Read arcade sessions" on public.arcade_sessions;
create policy "Read arcade sessions"
  on public.arcade_sessions
  for select
  using (true);

drop policy if exists "Insert arcade sessions" on public.arcade_sessions;
create policy "Insert arcade sessions"
  on public.arcade_sessions
  for insert
  with check (
    score >= 0
    and points_earned >= 0
    and duration_seconds between 1 and 600
  );

create or replace function public.record_arcade_reward(
  wallet_address_input text,
  points_input integer
)
returns void
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
  )
  values (
    wallet_address_input,
    greatest(points_input, 0),
    0,
    0,
    now()
  )
  on conflict (wallet_address) do update set
    points = public.user_rewards.points + greatest(points_input, 0),
    updated_at = now();
end;
$$;

grant execute on function public.record_arcade_reward(text, integer) to anon;
