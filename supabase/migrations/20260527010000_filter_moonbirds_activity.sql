-- Filter moonbirds out of the activity + top-sales RPCs.
--
-- Background: ingest-onchain-listings already drops "moonbirds physical
-- collectible" listings at insert time (NAME_BLOCKLIST in that function),
-- so the Marketplace tab has always been clean. But ingest-onchain-activity
-- writes every event regardless of mint name — the Helius name resolution
-- happens in a separate pass and isn't always complete at the moment of
-- ingest. The old live-proxy version of onchain-activity (pre-2026-05-24
-- DB rewrite) filtered moonbirds at read time; that filter was lost in the
-- migration to DB-backed reads.
--
-- Applying the filter here, in the RPCs, means:
--   - No re-ingest needed; existing rows remain in onchain_activities
--   - One place to maintain the blocklist
--   - Events for mints we DON'T have a name for yet are PRESERVED (we
--     can't tell if they're moonbirds — better to show than hide).

CREATE OR REPLACE FUNCTION public.get_onchain_activity(
  p_collection TEXT DEFAULT 'collector_crypt',
  p_type       TEXT DEFAULT NULL,
  p_limit      INT  DEFAULT 20,
  p_offset     INT  DEFAULT 0
)
RETURNS TABLE (
  signature   TEXT,
  type        TEXT,
  source      TEXT,
  token_mint  TEXT,
  collection  TEXT,
  block_time  BIGINT,
  buyer       TEXT,
  seller      TEXT,
  price       NUMERIC,
  price_usd   NUMERIC,
  price_info  JSONB,
  image       TEXT,
  name        TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    a.signature, a.type, a.source, a.token_mint, a.collection,
    a.block_time, a.buyer, a.seller, a.price, a.price_usd, a.price_info,
    a.image,
    COALESCE(n.name, NULL) AS name
  FROM public.onchain_activities a
  LEFT JOIN public.nft_names n ON n.mint = a.token_mint
  WHERE a.collection = p_collection
    AND (p_type IS NULL OR a.type = p_type)
    -- Hide moonbirds when we know the mint's name. Unnamed mints pass
    -- through so the feed never goes empty waiting on Helius enrichment.
    AND (n.name IS NULL OR LOWER(n.name) NOT LIKE '%moonbirds physical collectible%')
  ORDER BY a.block_time DESC
  OFFSET p_offset
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_onchain_activity(TEXT, TEXT, INT, INT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_onchain_top_sales(
  p_collection  TEXT DEFAULT 'collector_crypt',
  p_window_days INT  DEFAULT 7,
  p_min_usd     NUMERIC DEFAULT 10,
  p_limit       INT  DEFAULT 50
)
RETURNS TABLE (
  signature   TEXT,
  type        TEXT,
  source      TEXT,
  token_mint  TEXT,
  collection  TEXT,
  block_time  BIGINT,
  buyer       TEXT,
  seller      TEXT,
  price       NUMERIC,
  price_usd   NUMERIC,
  price_info  JSONB,
  image       TEXT,
  name        TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    a.signature, a.type, a.source, a.token_mint, a.collection,
    a.block_time, a.buyer, a.seller, a.price, a.price_usd, a.price_info,
    a.image,
    COALESCE(n.name, NULL) AS name
  FROM public.onchain_activities a
  LEFT JOIN public.nft_names n ON n.mint = a.token_mint
  WHERE a.collection = p_collection
    AND a.type = 'buyNow'
    AND a.block_time >= EXTRACT(EPOCH FROM (now() - (p_window_days || ' days')::interval))::bigint
    AND a.price_usd IS NOT NULL
    AND a.price_usd >= p_min_usd
    -- Same moonbirds filter as get_onchain_activity. For Top Sales this
    -- matters more — high-priced moonbirds would dominate the leaderboard
    -- and bury the real Pokémon chase sales.
    AND (n.name IS NULL OR LOWER(n.name) NOT LIKE '%moonbirds physical collectible%')
  ORDER BY a.price_usd DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_onchain_top_sales(TEXT, INT, NUMERIC, INT) TO anon, authenticated;
