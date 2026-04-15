CREATE TYPE public.set_sentiment_vote AS ENUM ('up', 'down');

CREATE TABLE public.set_sentiment_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  set_id TEXT NOT NULL,
  vote_type public.set_sentiment_vote NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, set_id)
);

CREATE INDEX idx_set_sentiment_votes_set_id ON public.set_sentiment_votes (set_id);
CREATE INDEX idx_set_sentiment_votes_user_id ON public.set_sentiment_votes (user_id);
CREATE INDEX idx_set_sentiment_votes_set_vote_type ON public.set_sentiment_votes (set_id, vote_type);

ALTER TABLE public.set_sentiment_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own set votes"
ON public.set_sentiment_votes
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own set votes"
ON public.set_sentiment_votes
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own set votes"
ON public.set_sentiment_votes
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own set votes"
ON public.set_sentiment_votes
FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER update_set_sentiment_votes_updated_at
BEFORE UPDATE ON public.set_sentiment_votes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.get_set_sentiment(p_set_ids TEXT[])
RETURNS TABLE (
  set_id TEXT,
  upvotes BIGINT,
  downvotes BIGINT,
  score BIGINT,
  current_user_vote public.set_sentiment_vote
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH requested AS (
    SELECT unnest(p_set_ids) AS set_id
  ),
  aggregate_votes AS (
    SELECT
      r.set_id,
      COUNT(*) FILTER (WHERE ssv.vote_type = 'up') AS upvotes,
      COUNT(*) FILTER (WHERE ssv.vote_type = 'down') AS downvotes
    FROM requested r
    LEFT JOIN public.set_sentiment_votes ssv
      ON ssv.set_id = r.set_id
    GROUP BY r.set_id
  ),
  my_votes AS (
    SELECT set_id, vote_type
    FROM public.set_sentiment_votes
    WHERE user_id = auth.uid()
      AND set_id = ANY(p_set_ids)
  )
  SELECT
    a.set_id,
    a.upvotes,
    a.downvotes,
    a.upvotes - a.downvotes AS score,
    mv.vote_type AS current_user_vote
  FROM aggregate_votes a
  LEFT JOIN my_votes mv
    ON mv.set_id = a.set_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_set_sentiment(TEXT[]) TO anon, authenticated;