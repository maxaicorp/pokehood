-- Games + weekly prizes system
-- Reuses existing user_roles/has_role for admin gating (no is_admin column needed)

-- ─── Card pool: curated list the game picks from ──────────────────────────────
CREATE TABLE public.game_card_pool (
  card_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image_small TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.game_card_pool ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can read card pool" ON public.game_card_pool FOR SELECT USING (true);
-- writes only by service role

-- ─── Game sessions (server-authoritative state per play) ──────────────────────
CREATE TABLE public.game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game TEXT NOT NULL DEFAULT 'card-match',
  slots JSONB NOT NULL,                             -- array of 20 {card_id, image_small, name}
  matched_slots INT[] NOT NULL DEFAULT '{}',
  pending_flip INT,
  flips_count INT NOT NULL DEFAULT 0,
  wrong_flips INT NOT NULL DEFAULT 0,
  last_flip_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',            -- active | completed | expired
  score INT,
  period_key DATE                                   -- set to completed_at::date on completion
);

-- Only one active session per user+game
CREATE UNIQUE INDEX game_sessions_one_active
  ON public.game_sessions(user_id, game)
  WHERE status = 'active';

-- Leaderboard query index
CREATE INDEX game_sessions_lb
  ON public.game_sessions(game, period_key, score DESC)
  WHERE status = 'completed';

ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own sessions" ON public.game_sessions
  FOR SELECT USING (auth.uid() = user_id);
-- no client writes — edge functions use service role

-- ─── Prizes (admin-defined weekly giveaways) ──────────────────────────────────
CREATE TABLE public.prizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game TEXT NOT NULL DEFAULT 'card-match',
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  estimated_value_usd NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'scheduled',         -- scheduled | active | judged | cancelled
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(game, week_start)
);

ALTER TABLE public.prizes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads prizes" ON public.prizes FOR SELECT USING (true);
-- writes via admin edge functions only

-- ─── Prize winners ────────────────────────────────────────────────────────────
CREATE TABLE public.prize_winners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prize_id UUID NOT NULL UNIQUE REFERENCES public.prizes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  winning_score INT NOT NULL,
  announced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  ship_to JSONB,                                    -- {name,street,city,state,zip,country}
  tracking_number TEXT,
  tracking_url TEXT,
  carrier TEXT,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  admin_notes TEXT
);

ALTER TABLE public.prize_winners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads winners" ON public.prize_winners FOR SELECT USING (true);

-- Winners can update their own claim (ship_to + claimed_at only; enforced by trigger)
CREATE POLICY "winner updates own claim" ON public.prize_winners
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Block winners from modifying admin-managed fields
CREATE OR REPLACE FUNCTION public.guard_prize_winner_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Admins bypass
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  -- Winner may only set ship_to + claimed_at (once)
  IF OLD.prize_id IS DISTINCT FROM NEW.prize_id
     OR OLD.user_id IS DISTINCT FROM NEW.user_id
     OR OLD.winning_score IS DISTINCT FROM NEW.winning_score
     OR OLD.announced_at IS DISTINCT FROM NEW.announced_at
     OR OLD.tracking_number IS DISTINCT FROM NEW.tracking_number
     OR OLD.tracking_url IS DISTINCT FROM NEW.tracking_url
     OR OLD.carrier IS DISTINCT FROM NEW.carrier
     OR OLD.shipped_at IS DISTINCT FROM NEW.shipped_at
     OR OLD.delivered_at IS DISTINCT FROM NEW.delivered_at
     OR OLD.admin_notes IS DISTINCT FROM NEW.admin_notes THEN
    RAISE EXCEPTION 'Only ship_to and claimed_at may be updated by winner';
  END IF;
  IF OLD.claimed_at IS NOT NULL AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN
    RAISE EXCEPTION 'Claim already submitted';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prize_winner_guard
  BEFORE UPDATE ON public.prize_winners
  FOR EACH ROW EXECUTE FUNCTION public.guard_prize_winner_update();

-- ─── Leaderboard RPC ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_game_leaderboard(
  p_game TEXT,
  p_start DATE,
  p_end DATE
)
RETURNS TABLE(
  rank INT,
  user_id UUID,
  username TEXT,
  score INT,
  completed_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH best AS (
    SELECT DISTINCT ON (user_id) user_id, score, completed_at
    FROM public.game_sessions
    WHERE game = p_game
      AND status = 'completed'
      AND period_key BETWEEN p_start AND p_end
    ORDER BY user_id, score DESC, completed_at ASC
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY b.score DESC, b.completed_at ASC)::INT AS rank,
    b.user_id,
    COALESCE(p.username, 'anon') AS username,
    b.score,
    b.completed_at
  FROM best b
  LEFT JOIN public.profiles p ON p.user_id = b.user_id
  ORDER BY b.score DESC, b.completed_at ASC
  LIMIT 100;
$$;

-- ─── Helper: current week's Monday (UTC) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_week_start()
RETURNS DATE LANGUAGE sql IMMUTABLE AS $$
  SELECT (date_trunc('week', now() AT TIME ZONE 'UTC'))::date;
$$;

-- ─── Unclaimed win lookup for current user ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_unclaimed_wins()
RETURNS TABLE(
  prize_winner_id UUID,
  prize_id UUID,
  title TEXT,
  image_url TEXT,
  description TEXT,
  winning_score INT,
  announced_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pw.id, p.id, p.title, p.image_url, p.description, pw.winning_score, pw.announced_at
  FROM public.prize_winners pw
  JOIN public.prizes p ON p.id = pw.prize_id
  WHERE pw.user_id = auth.uid() AND pw.claimed_at IS NULL;
$$;
