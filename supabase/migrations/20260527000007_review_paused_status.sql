alter table public.token_reviews
  drop constraint if exists token_reviews_status_check;

alter table public.token_reviews
  add constraint token_reviews_status_check
  check (status in ('pending', 'approved', 'rejected', 'paused'));
