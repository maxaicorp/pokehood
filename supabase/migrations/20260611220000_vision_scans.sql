-- Vision card-scan log: one row per Scrydex Vision request (5 credits each).
-- Used to enforce the per-user free-scan limit and audit credit spend.
create table if not exists public.vision_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- What Vision saw (analysis block: raw/graded, grade details) + top match id.
  analysis jsonb,
  matched_card_id text,
  match_score numeric
);

create index if not exists vision_scans_user_idx
  on public.vision_scans (user_id, created_at desc);

alter table public.vision_scans enable row level security;

-- Users can read their own scan history (for "you've used X of Y scans" UI).
drop policy if exists "vision_scans_select_own" on public.vision_scans;
create policy "vision_scans_select_own" on public.vision_scans
  for select using (auth.uid() = user_id);

-- Writes happen only via the edge function (service role bypasses RLS).
