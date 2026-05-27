drop policy if exists "Submit pending verified tokens" on public.verified_tokens;
create policy "Submit pending verified tokens"
  on public.verified_tokens for insert
  with check (status = 'pending');

drop policy if exists "Submit pending token reviews" on public.token_reviews;
create policy "Submit pending token reviews"
  on public.token_reviews for insert
  with check (status = 'pending');
