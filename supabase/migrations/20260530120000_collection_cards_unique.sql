-- Prevent duplicate collection rows for the same (user, card, condition).
--
-- Background (mega-audit H1): addToCollection uses a lookup-then-insert pattern
-- that is not atomic. Two rapid "Add" clicks can both pass the existence check
-- and insert two rows for the same card+condition. There is no DB constraint
-- stopping it. The frontend was hardened to tolerate existing duplicates
-- (limit(1) instead of maybeSingle), but only this unique index actually
-- prevents NEW duplicates and lets the app move to an atomic UPSERT.
--
-- Step 1: collapse any duplicates that already exist, summing their quantity
-- onto the earliest row, then delete the rest. (A plain CREATE UNIQUE INDEX
-- would fail outright if duplicates are present.)
WITH ranked AS (
  SELECT
    id,
    user_id, tcg_api_id, condition,
    quantity,
    added_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, tcg_api_id, condition
      ORDER BY added_at ASC, id ASC
    ) AS rn,
    SUM(quantity) OVER (PARTITION BY user_id, tcg_api_id, condition) AS total_qty
  FROM public.collection_cards
)
UPDATE public.collection_cards c
SET quantity = r.total_qty
FROM ranked r
WHERE c.id = r.id AND r.rn = 1 AND r.total_qty <> c.quantity;

DELETE FROM public.collection_cards c
USING (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, tcg_api_id, condition
      ORDER BY added_at ASC, id ASC
    ) AS rn
  FROM public.collection_cards
) d
WHERE c.id = d.id AND d.rn > 1;

-- Step 2: enforce uniqueness going forward.
CREATE UNIQUE INDEX IF NOT EXISTS collection_cards_uniq
  ON public.collection_cards (user_id, tcg_api_id, condition);
