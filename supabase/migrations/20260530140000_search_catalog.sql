-- Unified, typo-tolerant catalog search backing the global search box.
--
-- Delivers three things in one function:
--   1. DB-backed search   — queries Postgres instead of scanning the 9.9MB
--      client index, so it's fast, always-fresh, and includes new-set cards.
--   2. Typo tolerance      — pg_trgm similarity() matches "charzard" → Charizard.
--   3. Sealed products too — UNIONs single cards (latest_card_prices) with
--      sealed products (sealed_products), so ETBs/booster boxes show up.
--
-- It's a plain RPC (run in the SQL editor — no edge-function deploy needed),
-- and the frontend calls it directly with a graceful fallback to the existing
-- client search if it isn't present yet.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes make both the ILIKE '%term%' and similarity() paths fast.
CREATE INDEX IF NOT EXISTS idx_lcp_name_trgm
  ON public.latest_card_prices USING gin (lower(card_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sealed_name_trgm
  ON public.sealed_products USING gin (lower(name) gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_catalog(p_query text, p_limit int DEFAULT 12)
RETURNS TABLE (id text, name text, set_name text, kind text, image text, score real)
LANGUAGE sql STABLE
AS $$
  WITH q AS (SELECT lower(trim(coalesce(p_query, ''))) AS t)
  SELECT * FROM (
    -- Single cards
    SELECT
      lcp.card_id   AS id,
      lcp.card_name AS name,
      lcp.set_name  AS set_name,
      'card'::text  AS kind,
      'https://images.scrydex.com/pokemon/' || lcp.card_id || '/small' AS image,
      (CASE WHEN lower(lcp.card_name) LIKE '%' || q.t || '%' THEN 1.0
            ELSE similarity(lower(lcp.card_name), q.t) END)::real AS score
    FROM public.latest_card_prices lcp, q
    WHERE lcp.card_id NOT LIKE 'sealed-%'
      -- Exclude ::variant rows (e.g. base1-4::unlimitedHolofoil). They duplicate
      -- the base card in results and produce invalid image URLs — the base id
      -- (base1-4) is the canonical, image-valid entry.
      AND lcp.card_id NOT LIKE '%::%'
      AND ( lower(lcp.card_name) LIKE '%' || q.t || '%'
            OR similarity(lower(lcp.card_name), q.t) > 0.25 )

    UNION ALL

    -- Sealed products
    SELECT
      sp.id,
      sp.name,
      sp.expansion_name,
      'sealed'::text,
      sp.image_small,
      (CASE WHEN lower(sp.name) LIKE '%' || q.t || '%' THEN 0.95
            ELSE similarity(lower(sp.name), q.t) END)::real
    FROM public.sealed_products sp, q
    WHERE lower(sp.name) LIKE '%' || q.t || '%'
       OR similarity(lower(sp.name), q.t) > 0.25
  ) r
  ORDER BY r.score DESC, r.name ASC
  LIMIT greatest(1, least(coalesce(p_limit, 12), 50));
$$;

GRANT EXECUTE ON FUNCTION public.search_catalog(text, int) TO anon, authenticated;
