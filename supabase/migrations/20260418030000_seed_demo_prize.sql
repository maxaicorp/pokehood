-- Demo prize so the prize column on /games/card-match has something to render.
-- Safe to delete or replace once admin tooling is in place.
INSERT INTO public.prizes (
  game,
  week_start,
  week_end,
  title,
  description,
  image_url,
  estimated_value_usd,
  status,
  created_by
)
SELECT
  'card-match',
  public.current_week_start(),
  public.current_week_start() + 6,
  'Teal Mask Ogerpon ex — Special Illustration Rare',
  'Top score on the Card Match leaderboard this week takes home this Special Illustration Rare from Surging Sparks. Tiebreaker is earliest completion.',
  '/data/card-pool/sv8pt5-145.png',
  250.00,
  'active',
  id
FROM auth.users
WHERE email = 'collectiblezxyz@gmail.com'
LIMIT 1
ON CONFLICT (game, week_start) DO NOTHING;
