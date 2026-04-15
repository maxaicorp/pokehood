
-- Rename column
ALTER TABLE public.set_sentiment_votes RENAME COLUMN set_id TO card_id;

-- Drop old unique constraint and create new one
ALTER TABLE public.set_sentiment_votes DROP CONSTRAINT IF EXISTS set_sentiment_votes_user_id_set_id_key;
ALTER TABLE public.set_sentiment_votes ADD CONSTRAINT set_sentiment_votes_user_id_card_id_key UNIQUE (user_id, card_id);

-- Replace the RPC function to use card_id
CREATE OR REPLACE FUNCTION public.get_set_sentiment(p_set_ids text[])
 RETURNS TABLE(set_id text, upvotes bigint, downvotes bigint, score bigint, current_user_vote set_sentiment_vote)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH requested AS (
    SELECT unnest(p_set_ids) AS card_id
  ),
  aggregate_votes AS (
    SELECT
      r.card_id,
      COUNT(*) FILTER (WHERE ssv.vote_type = 'up') AS upvotes,
      COUNT(*) FILTER (WHERE ssv.vote_type = 'down') AS downvotes
    FROM requested r
    LEFT JOIN public.set_sentiment_votes ssv
      ON ssv.card_id = r.card_id
    GROUP BY r.card_id
  ),
  my_votes AS (
    SELECT card_id, vote_type
    FROM public.set_sentiment_votes
    WHERE user_id = auth.uid()
      AND card_id = ANY(p_set_ids)
  )
  SELECT
    a.card_id AS set_id,
    a.upvotes,
    a.downvotes,
    a.upvotes - a.downvotes AS score,
    mv.vote_type AS current_user_vote
  FROM aggregate_votes a
  LEFT JOIN my_votes mv
    ON mv.card_id = a.card_id;
$function$;

-- Update RLS policies to reference card_id
DROP POLICY IF EXISTS "Users can create their own set votes" ON public.set_sentiment_votes;
DROP POLICY IF EXISTS "Users can delete their own set votes" ON public.set_sentiment_votes;
DROP POLICY IF EXISTS "Users can update their own set votes" ON public.set_sentiment_votes;
DROP POLICY IF EXISTS "Users can view their own set votes" ON public.set_sentiment_votes;

CREATE POLICY "Users can create their own set votes" ON public.set_sentiment_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own set votes" ON public.set_sentiment_votes FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own set votes" ON public.set_sentiment_votes FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own set votes" ON public.set_sentiment_votes FOR SELECT USING (auth.uid() = user_id);
