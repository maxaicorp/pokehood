-- Graded price: (1) un-cap the tiles RPC, (2) admin override (mirrors the raw
-- card_price_overrides system).
--
-- (1) get_graded_tiles_for_card hard-capped grade IN (10,9) from the old fixed
--     6-tile layout, but GradedPriceTiles was rebuilt to list ALL grades per
--     company in a dropdown. The cap hides every non-10/9 grade. Return all.
--
-- (2) graded_price_overrides = the source of truth for a (card, company, grade)
--     market: written as today's official graded snapshot AND overlaid by
--     refresh_latest_graded_prices on every rebuild, so the daily cron can't
--     overwrite a pin. Same durability contract as the raw override.

-- ─── (1) Un-cap the tiles RPC ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_graded_tiles_for_card(p_card_id TEXT)
RETURNS TABLE (
  company  TEXT,
  grade    NUMERIC,
  market   NUMERIC,
  low      NUMERIC,
  mid      NUMERIC,
  high     NUMERIC,
  currency TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT company, grade, market, low, mid, high, currency
  FROM public.latest_graded_prices
  WHERE card_id = p_card_id
    AND company IN ('PSA','BGS','CGC')   -- all grades now; the component picks
  ORDER BY company, grade DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_graded_tiles_for_card(TEXT) TO anon, authenticated;

-- ─── (2) Override table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.graded_price_overrides (
  card_id  TEXT NOT NULL,
  company  TEXT NOT NULL,
  grade    NUMERIC NOT NULL,
  low      NUMERIC,
  mid      NUMERIC,
  market   NUMERIC NOT NULL,
  high     NUMERIC,
  currency TEXT NOT NULL DEFAULT 'USD',
  note     TEXT,
  set_by   UUID,
  set_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, company, grade)
);

ALTER TABLE public.graded_price_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "graded overrides admin read" ON public.graded_price_overrides;
CREATE POLICY "graded overrides admin read"
  ON public.graded_price_overrides FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ─── Set / update a graded override ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_graded_price(
  p_card_id TEXT,
  p_company TEXT,
  p_grade   NUMERIC,
  p_market  NUMERIC,
  p_low     NUMERIC DEFAULT NULL,
  p_mid     NUMERIC DEFAULT NULL,
  p_high    NUMERIC DEFAULT NULL,
  p_note    TEXT    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_co  TEXT := upper(trim(p_company));
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_market IS NULL OR p_market <= 0 THEN
    RAISE EXCEPTION 'market must be a positive number';
  END IF;

  -- 1) Durable override (honored by every refresh forever).
  INSERT INTO public.graded_price_overrides
    (card_id, company, grade, low, mid, market, high, currency, note, set_by, set_at)
  VALUES (p_card_id, v_co, p_grade, p_low, p_mid, p_market, p_high, 'USD', p_note, v_uid, now())
  ON CONFLICT (card_id, company, grade) DO UPDATE SET
    low=EXCLUDED.low, mid=EXCLUDED.mid, market=EXCLUDED.market, high=EXCLUDED.high,
    note=EXCLUDED.note, set_by=EXCLUDED.set_by, set_at=now();

  -- 2) Today's official graded snapshot (history anchor).
  INSERT INTO public.graded_price_snapshots
    (card_id, company, grade, is_perfect, is_signed, is_error, low, mid, market, high, currency, recorded_at)
  VALUES (p_card_id, v_co, p_grade, FALSE, FALSE, FALSE, p_low, p_mid, p_market, p_high, 'USD', CURRENT_DATE)
  ON CONFLICT (card_id, company, grade, is_perfect, is_signed, is_error, recorded_at) DO UPDATE SET
    low=EXCLUDED.low, mid=EXCLUDED.mid, market=EXCLUDED.market, high=EXCLUDED.high;

  -- 3) Immediate read cache (don't wait for the next refresh).
  INSERT INTO public.latest_graded_prices
    (card_id, company, grade, low, mid, market, high, currency, updated_at)
  VALUES (p_card_id, v_co, p_grade, p_low, p_mid, p_market, p_high, 'USD', now())
  ON CONFLICT (card_id, company, grade) DO UPDATE SET
    low=EXCLUDED.low, mid=EXCLUDED.mid, market=EXCLUDED.market, high=EXCLUDED.high, updated_at=now();
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.admin_set_graded_price(TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT)
  TO authenticated;

-- ─── Clear a graded override ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_clear_graded_override(
  p_card_id TEXT, p_company TEXT, p_grade NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_co TEXT := upper(trim(p_company));
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  DELETE FROM public.graded_price_overrides WHERE card_id = p_card_id AND company = v_co AND grade = p_grade;
  DELETE FROM public.graded_price_snapshots
    WHERE card_id = p_card_id AND company = v_co AND grade = p_grade AND recorded_at = CURRENT_DATE;
  PERFORM public.refresh_latest_graded_prices();
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_clear_graded_override(TEXT, TEXT, NUMERIC) TO authenticated;

-- ─── Make the graded refresh override-aware (durability guarantee) ────────────
CREATE OR REPLACE FUNCTION public.refresh_latest_graded_prices()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INT;
BEGIN
  TRUNCATE public.latest_graded_prices;

  INSERT INTO public.latest_graded_prices (
    card_id, company, grade, low, mid, market, high, currency, updated_at
  )
  SELECT DISTINCT ON (card_id, company, grade)
    card_id, company, grade, low, mid, market, high, currency, now()
  FROM public.graded_price_snapshots
  WHERE is_perfect = FALSE
    AND is_signed  = FALSE
    AND is_error   = FALSE
    AND market IS NOT NULL
    AND market > 0
  ORDER BY card_id, company, grade, recorded_at DESC;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  -- Overlay admin graded overrides — the source of truth. Wins regardless of
  -- what the latest Scrydex graded snapshot said (or if it's missing).
  INSERT INTO public.latest_graded_prices
    (card_id, company, grade, low, mid, market, high, currency, updated_at)
  SELECT card_id, company, grade, low, mid, market, high, currency, now()
  FROM public.graded_price_overrides
  ON CONFLICT (card_id, company, grade) DO UPDATE SET
    low=EXCLUDED.low, mid=EXCLUDED.mid, market=EXCLUDED.market,
    high=EXCLUDED.high, currency=EXCLUDED.currency, updated_at=now();

  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_latest_graded_prices() TO service_role;

-- Repopulate now so the un-cap + any existing override take effect immediately.
SELECT public.refresh_latest_graded_prices();

NOTIFY pgrst, 'reload schema';
