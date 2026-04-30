-- Make giveaway entry email matching case-insensitive.
-- Without this, "Test@x.com" and "test@x.com" both insert into the same
-- (giveaway_id, email) unique constraint because Postgres text comparison
-- is case-sensitive by default. The edge function lowercases on submit
-- but historical data and any hand-inserted rows could still slip through.

-- Lowercase any existing rows so the new index won't conflict.
UPDATE public.giveaway_entries
SET email = lower(email)
WHERE email <> lower(email);

-- Drop the case-sensitive unique constraint and replace with a functional
-- expression index on lower(email).
ALTER TABLE public.giveaway_entries
  DROP CONSTRAINT IF EXISTS giveaway_entries_giveaway_id_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS giveaway_entries_giveaway_email_lower_idx
  ON public.giveaway_entries (giveaway_id, lower(email));
