-- Admin manual price overrides — the durable "source of truth" escape hatch.
--
-- WHY THIS EXISTS
-- Scrydex occasionally has no NM market for a sparse chase card and the pipeline
-- either dropped it (the recurring "prices vanish" bug) or, worse, fabricated a
-- low number from a played-condition fallback (the Mega Gengar ex / me2pt5-284
-- bug — a price that appears nowhere on Scrydex's own page). Backfilling was
-- always symptomatic: the next daily snapshot re-introduced the bad value.
--
-- This table ends that loop. An admin-set price is treated as the SOURCE OF
-- TRUTH: it is written as today's official price_snapshot AND it is overlaid on
-- top of latest_card_prices by EVERY refresh, so no future Scrydex snapshot can
-- ever clobber it. It stays until an admin clears it.
--
-- The whole public read path (get_latest_price_page / get_all_latest_prices /
-- get_top_movers) reads latest_card_prices, so overlaying there fixes Market,
-- Explore, and the Movers tab in one shot.

-- ─── Override table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.card_price_overrides (
  card_id    TEXT PRIMARY KEY,
  price      NUMERIC NOT NULL,
  price_1d   NUMERIC,
  price_7d   NUMERIC,
  price_30d  NUMERIC,
  card_name  TEXT NOT NULL DEFAULT '',
  set_name   TEXT NOT NULL DEFAULT '',
  note       TEXT,
  set_by     UUID,
  set_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.card_price_overrides ENABLE ROW LEVEL SECURITY;

-- Admins read directly (the AdminPrices UI shows which cards are pinned).
-- All WRITES go through the SECURITY DEFINER RPCs below, never the client.
DROP POLICY IF EXISTS "price overrides admin read" ON public.card_price_overrides;
CREATE POLICY "price overrides admin read"
  ON public.card_price_overrides FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ─── Set / update an override ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_set_card_price(
  p_card_id   TEXT,
  p_price     NUMERIC,
  p_price_1d  NUMERIC DEFAULT NULL,
  p_price_7d  NUMERIC DEFAULT NULL,
  p_price_30d NUMERIC DEFAULT NULL,
  p_note      TEXT    DEFAULT NULL,
  p_card_name TEXT    DEFAULT NULL,
  p_set_name  TEXT    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_name TEXT;
  v_set  TEXT;
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'price must be a positive number';
  END IF;

  -- Resolve a display name/set: explicit param wins, else reuse whatever the
  -- catalog already knows for this card so the row never goes nameless.
  SELECT card_name, set_name INTO v_name, v_set
  FROM public.latest_card_prices WHERE card_id = p_card_id;
  IF v_name IS NULL THEN
    SELECT card_name, set_name INTO v_name, v_set
    FROM public.price_snapshots WHERE card_id = p_card_id
    ORDER BY recorded_at DESC LIMIT 1;
  END IF;
  v_name := COALESCE(NULLIF(p_card_name, ''), v_name, '');
  v_set  := COALESCE(NULLIF(p_set_name, ''),  v_set,  '');

  -- 1) Durable override (the thing every refresh honors forever).
  INSERT INTO public.card_price_overrides
    (card_id, price, price_1d, price_7d, price_30d, card_name, set_name, note, set_by, set_at)
  VALUES
    (p_card_id, p_price, p_price_1d, p_price_7d, p_price_30d, v_name, v_set, p_note, v_uid, now())
  ON CONFLICT (card_id) DO UPDATE SET
    price     = EXCLUDED.price,
    price_1d  = EXCLUDED.price_1d,
    price_7d  = EXCLUDED.price_7d,
    price_30d = EXCLUDED.price_30d,
    card_name = COALESCE(NULLIF(EXCLUDED.card_name, ''), card_price_overrides.card_name),
    set_name  = COALESCE(NULLIF(EXCLUDED.set_name, ''),  card_price_overrides.set_name),
    note      = EXCLUDED.note,
    set_by    = EXCLUDED.set_by,
    set_at    = now();

  -- 2) Write it as today's OFFICIAL snapshot so history + future deltas are
  --    anchored to the corrected value (user requirement: it's the truth).
  INSERT INTO public.price_snapshots (card_id, card_name, set_name, price, recorded_at)
  VALUES (p_card_id, v_name, v_set, p_price, CURRENT_DATE)
  ON CONFLICT (card_id, recorded_at) DO UPDATE SET
    price     = EXCLUDED.price,
    card_name = COALESCE(NULLIF(EXCLUDED.card_name, ''), price_snapshots.card_name),
    set_name  = COALESCE(NULLIF(EXCLUDED.set_name, ''),  price_snapshots.set_name);

  -- 3) Reflect immediately in the read cache (don't wait for the 07:00 refresh).
  INSERT INTO public.latest_card_prices
    (card_id, card_name, set_name, price, recorded_at, price_1d, price_7d, price_30d, updated_at)
  VALUES
    (p_card_id, v_name, v_set, p_price, CURRENT_DATE, p_price_1d, p_price_7d, p_price_30d, now())
  ON CONFLICT (card_id) DO UPDATE SET
    card_name   = COALESCE(NULLIF(EXCLUDED.card_name, ''), latest_card_prices.card_name),
    set_name    = COALESCE(NULLIF(EXCLUDED.set_name, ''),  latest_card_prices.set_name),
    price       = EXCLUDED.price,
    recorded_at = EXCLUDED.recorded_at,
    price_1d    = EXCLUDED.price_1d,
    price_7d    = EXCLUDED.price_7d,
    price_30d   = EXCLUDED.price_30d,
    updated_at  = now();
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.admin_set_card_price(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT)
  TO authenticated;

-- ─── Clear an override ────────────────────────────────────────────────────────
-- Removes the pin AND the manual snapshot we wrote for today, then rebuilds the
-- cache so the card reverts to whatever real Scrydex history exists.

CREATE OR REPLACE FUNCTION public.admin_clear_card_price_override(p_card_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  DELETE FROM public.card_price_overrides WHERE card_id = p_card_id;
  -- Drop the manual same-day snapshot so the pipeline's value (if any) returns.
  DELETE FROM public.price_snapshots
    WHERE card_id = p_card_id AND recorded_at = CURRENT_DATE;

  PERFORM public.refresh_latest_card_prices();
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_clear_card_price_override(TEXT) TO authenticated;

-- ─── Make the refresh override-aware (the durability guarantee) ───────────────
-- Identical to the prior body, plus a final overlay pass: every admin override
-- is upserted on top of the snapshot-derived rows, so it wins regardless of
-- what the daily Scrydex snapshot recorded.

CREATE OR REPLACE FUNCTION public.refresh_latest_card_prices()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INT;
BEGIN
  TRUNCATE TABLE public.latest_card_prices;

  INSERT INTO public.latest_card_prices
    (card_id, card_name, set_name, price, recorded_at, price_1d, price_7d, price_30d, updated_at)
  WITH latest AS (
    SELECT DISTINCT ON (card_id)
      card_id, card_name, set_name, price, recorded_at
    FROM public.price_snapshots
    ORDER BY card_id, recorded_at DESC
  )
  SELECT
    l.card_id, l.card_name, l.set_name, l.price, l.recorded_at,
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at <= l.recorded_at - INTERVAL '1 day'
       ORDER BY ps.recorded_at DESC LIMIT 1)  AS price_1d,
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at <= l.recorded_at - INTERVAL '7 days'
       ORDER BY ps.recorded_at DESC LIMIT 1)  AS price_7d,
    (SELECT ps.price FROM public.price_snapshots ps
       WHERE ps.card_id = l.card_id
         AND ps.recorded_at <= l.recorded_at - INTERVAL '30 days'
       ORDER BY ps.recorded_at DESC LIMIT 1)  AS price_30d,
    NOW()
  FROM latest l;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  -- Overlay admin overrides — the source of truth. Upsert so a pinned card
  -- always exists and always carries the admin's price + deltas, even if the
  -- latest snapshot for it is the wrong (or missing) Scrydex value.
  INSERT INTO public.latest_card_prices
    (card_id, card_name, set_name, price, recorded_at, price_1d, price_7d, price_30d, updated_at)
  SELECT
    o.card_id,
    COALESCE(NULLIF(o.card_name, ''), ''),
    COALESCE(NULLIF(o.set_name, ''), ''),
    o.price, CURRENT_DATE, o.price_1d, o.price_7d, o.price_30d, NOW()
  FROM public.card_price_overrides o
  ON CONFLICT (card_id) DO UPDATE SET
    card_name   = COALESCE(NULLIF(EXCLUDED.card_name, ''), latest_card_prices.card_name),
    set_name    = COALESCE(NULLIF(EXCLUDED.set_name, ''),  latest_card_prices.set_name),
    price       = EXCLUDED.price,
    price_1d    = EXCLUDED.price_1d,
    price_7d    = EXCLUDED.price_7d,
    price_30d   = EXCLUDED.price_30d,
    recorded_at = GREATEST(latest_card_prices.recorded_at, EXCLUDED.recorded_at),
    updated_at  = NOW();

  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_latest_card_prices() TO service_role;

-- Repopulate now so any existing override takes effect immediately.
SELECT public.refresh_latest_card_prices();

NOTIFY pgrst, 'reload schema';
