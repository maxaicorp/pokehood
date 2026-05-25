-- Onchain ingest tables — mirror the price_snapshots architecture for the
-- /onchain page. Background crons pull from Magic Eden + Helius and write
-- here; the read edge functions then serve flat SELECTs. Decouples API cost
-- from page traffic and unlocks DB-side sort/filter (Top Sales by USD,
-- historical "all-time top", etc.).
--
-- Three tables:
--   onchain_activities  — append-only event log (buyNow/list/delist/bid/cancelBid)
--   onchain_listings    — current active listings, soft-deleted via delisted_at
--   nft_names           — mint → human name cache, shared across activities + PSA

-- ─── nft_names ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nft_names (
  mint        TEXT PRIMARY KEY,
  name        TEXT,
  -- cert_number reserved for the upcoming PSA flow — populated when Helius
  -- metadata exposes a "Certificate #" attribute or similar. NULL until then.
  cert_number TEXT,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.nft_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read nft_names"
  ON public.nft_names FOR SELECT USING (true);

-- Only the service role writes; no policy needed for INSERT/UPDATE (RLS
-- bypassed by service role automatically).

-- ─── onchain_activities ──────────────────────────────────────────────────────
-- Each row is an immutable Magic Eden event. signature is the on-chain tx
-- signature and acts as a natural primary key.
CREATE TABLE IF NOT EXISTS public.onchain_activities (
  signature    TEXT PRIMARY KEY,
  collection   TEXT NOT NULL,
  type         TEXT NOT NULL,                -- buyNow | list | delist | bid | cancelBid
  source       TEXT NOT NULL DEFAULT 'magiceden_v2',
  token_mint   TEXT,
  block_time   BIGINT NOT NULL,              -- unix seconds, ME's native format
  buyer        TEXT,
  seller       TEXT,
  price        NUMERIC,                      -- raw SOL price from ME (preserved verbatim)
  price_usd    NUMERIC,                      -- computed at ingest using spot SOL/USD or USDC splPrice
  price_info   JSONB,                        -- full ME priceInfo object so reads can recompute if needed
  image        TEXT,
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.onchain_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read onchain_activities"
  ON public.onchain_activities FOR SELECT USING (true);

-- Activity feed scrolls newest-first within a collection, optionally filtered
-- by type. This composite covers both unfiltered and type-filtered paths.
CREATE INDEX IF NOT EXISTS idx_onchain_activities_collection_time
  ON public.onchain_activities (collection, block_time DESC);

CREATE INDEX IF NOT EXISTS idx_onchain_activities_collection_type_time
  ON public.onchain_activities (collection, type, block_time DESC);

-- Top Sales reads order by price_usd desc within a time window — needs
-- price_usd in the index for the planner to skip a sort.
CREATE INDEX IF NOT EXISTS idx_onchain_activities_top_sales
  ON public.onchain_activities (collection, type, block_time DESC, price_usd DESC)
  WHERE price_usd IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_onchain_activities_token_mint
  ON public.onchain_activities (token_mint);

-- ─── onchain_listings ────────────────────────────────────────────────────────
-- Each row represents a listing on Magic Eden. When a listing disappears from
-- ME's response, the ingest cron stamps delisted_at instead of deleting — we
-- keep historical listings so e.g. "average days listed" can be computed
-- later. Active listings = delisted_at IS NULL.
CREATE TABLE IF NOT EXISTS public.onchain_listings (
  pda_address      TEXT PRIMARY KEY,
  collection       TEXT NOT NULL,
  token_mint       TEXT NOT NULL,
  seller           TEXT NOT NULL,
  price            NUMERIC NOT NULL,
  price_usd        NUMERIC,
  price_info       JSONB,
  rarity_rank      INT,
  name             TEXT,                    -- ME provides this; cached anyway
  image            TEXT,
  marketplace_url  TEXT,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  delisted_at      TIMESTAMPTZ
);

ALTER TABLE public.onchain_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read onchain_listings"
  ON public.onchain_listings FOR SELECT USING (true);

-- Marketplace tab sorts active listings by price asc/desc. Partial index on
-- active-only rows keeps the marketplace query small even after months of
-- historical delisted rows accumulate.
CREATE INDEX IF NOT EXISTS idx_onchain_listings_active_price_asc
  ON public.onchain_listings (collection, price ASC)
  WHERE delisted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_onchain_listings_active_price_desc
  ON public.onchain_listings (collection, price DESC)
  WHERE delisted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_onchain_listings_active_recent
  ON public.onchain_listings (collection, first_seen_at DESC)
  WHERE delisted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_onchain_listings_token_mint
  ON public.onchain_listings (token_mint);

-- ─── RPC: get_onchain_top_sales ──────────────────────────────────────────────
-- Top sales by USD value within a rolling window. window_days drives the
-- block_time floor; p_min_usd skips noise like $1 test trades. Joined to
-- nft_names so the response includes the latest cached name even if the row
-- was ingested before its mint was Helius-enriched.
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
  ORDER BY a.price_usd DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_onchain_top_sales(TEXT, INT, NUMERIC, INT) TO anon, authenticated;

-- ─── RPC: get_onchain_activity ───────────────────────────────────────────────
-- Newest-first activity feed for a collection, optionally type-filtered.
-- Pagination via limit/offset to match the frontend's useInfiniteQuery shape.
CREATE OR REPLACE FUNCTION public.get_onchain_activity(
  p_collection TEXT DEFAULT 'collector_crypt',
  p_type       TEXT DEFAULT NULL,        -- NULL = all types
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
  ORDER BY a.block_time DESC
  OFFSET p_offset
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_onchain_activity(TEXT, TEXT, INT, INT) TO anon, authenticated;

-- ─── RPC: get_onchain_listings ───────────────────────────────────────────────
-- Active listings only, sorted per p_sort. Mirrors Magic Eden's three sort
-- options but with NO offset trickery: DB sort handles both directions
-- natively (unlike ME's listings endpoint which is ascending-only).
CREATE OR REPLACE FUNCTION public.get_onchain_listings(
  p_collection TEXT DEFAULT 'collector_crypt',
  p_sort       TEXT DEFAULT 'price-asc',  -- price-asc | price-desc | recent
  p_limit      INT  DEFAULT 20,
  p_offset     INT  DEFAULT 0
)
RETURNS TABLE (
  pda_address     TEXT,
  collection      TEXT,
  token_mint      TEXT,
  seller          TEXT,
  price           NUMERIC,
  price_usd       NUMERIC,
  price_info      JSONB,
  rarity_rank     INT,
  name            TEXT,
  image           TEXT,
  marketplace_url TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    l.pda_address, l.collection, l.token_mint, l.seller,
    l.price, l.price_usd, l.price_info, l.rarity_rank,
    l.name, l.image, l.marketplace_url
  FROM public.onchain_listings l
  WHERE l.collection = p_collection
    AND l.delisted_at IS NULL
  ORDER BY
    CASE WHEN p_sort = 'price-asc'  THEN l.price END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN l.price END DESC NULLS LAST,
    CASE WHEN p_sort = 'recent'     THEN l.first_seen_at END DESC NULLS LAST
  OFFSET p_offset
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_onchain_listings(TEXT, TEXT, INT, INT) TO anon, authenticated;
