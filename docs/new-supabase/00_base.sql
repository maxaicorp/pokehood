-- ============================================================================
-- 00_base.sql — Lovable's BASE schema (never exported to repo migrations).
-- The 77 repo migrations are incremental ON TOP of this. Reconstructed from
-- src/integrations/supabase/types.ts (exact columns + nullability) plus the
-- standard Lovable boilerplate for the well-known base functions/triggers.
-- RUN THIS FIRST, then (re)run the repo migrations.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── enum: app_role ──────────────────────────────────────────────────────────
do $$ begin
  create type public.app_role as enum ('admin','moderator','user');
exception when duplicate_object then null; end $$;

-- ── updated_at trigger fn ───────────────────────────────────────────────────
create or replace function public.update_updated_at_column()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  display_name text,
  avatar_url text,
  bio text,
  slug text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Profiles are publicly readable" on public.profiles for select using (true);
create policy "Users insert own profile" on public.profiles for insert with check (auth.uid() = user_id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = user_id);
create trigger update_profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at_column();

-- ── user_roles + has_role() ─────────────────────────────────────────────────
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  unique (user_id, role)
);
alter table public.user_roles enable row level security;
create policy "Users read own roles" on public.user_roles for select using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

-- ── auth.users → profile on signup ──────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (user_id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── user_links ──────────────────────────────────────────────────────────────
create table if not exists public.user_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  label text not null,
  url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.user_links enable row level security;
create policy "User links publicly readable" on public.user_links for select using (true);
create policy "Users manage own links" on public.user_links for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── collection_cards ────────────────────────────────────────────────────────
create table if not exists public.collection_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  tcg_api_id text not null,
  name text not null,
  set_id text not null,
  set_name text not null,
  card_number text not null,
  rarity text not null default 'Unknown',
  image_small text not null,
  image_large text not null,
  condition text not null default 'NM',
  quantity integer not null default 1,
  product_type text not null default 'card',
  for_sale boolean not null default false,
  market_price numeric,
  manual_price numeric,
  sale_price numeric,
  added_at timestamptz not null default now()
);
alter table public.collection_cards enable row level security;
create policy "Collections publicly readable" on public.collection_cards for select using (true);
create policy "Users manage own collection" on public.collection_cards for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
