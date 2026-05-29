-- Filter non-Pokémon "merch" (sports cards, NFTs, swag) out of the onchain
-- feed + marketplace + Top Sales.
--
-- The Collector Crypt collection on Magic Eden is mixed: Pokémon graded slabs
-- alongside Panini/Upper Deck/Prizm sports cards, Moonbirds, "VanEck Gold
-- Digger Hat", etc. We only want Pokémon. CC slabs carry a clean
-- `Category=Pokemon` attribute, BUT most listing mints aren't Helius-enriched
-- yet (enrichment only runs for activity mints), so the reliable signal today
-- is the listing/NFT NAME. Sports + merch self-label with brand names Pokémon
-- cards never use, so a name blocklist is high-precision.
--
-- Generalizes the earlier single-keyword moonbirds filter into one shared
-- helper used by every read path. One place to maintain the list.

-- ─── Shared blocklist ─────────────────────────────────────────────────────────
-- Returns true if a name looks like non-Pokémon merch. Word-boundaried league
-- codes (nba/nfl/...) avoid clobbering Pokémon names; the rest are brand names
-- that never appear on Pokémon cards. Extend the alternation as new junk shows.
CREATE OR REPLACE FUNCTION public.is_merch_name(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p_name IS NOT NULL AND p_name ~* (
    'moonbirds|panini|topps|bowman|prizm|donruss|fleer|upper[ -]?deck|'
    || 'collector''?s edge|vaneck|\mnba\M|\mnfl\M|\mmlb\M|\mnhl\M|fifa|'
    || 'basketball|football|baseball|hockey|soccer'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_merch_name(TEXT) TO anon, authenticated;

-- ─── Activity feed ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_onchain_activity(
  p_collection TEXT DEFAULT 'collector_crypt',
  p_type       TEXT DEFAULT NULL,
  p_limit      INT  DEFAULT 20,
  p_offset     INT  DEFAULT 0
)
RETURNS TABLE (
  signature TEXT, type TEXT, source TEXT, token_mint TEXT, collection TEXT,
  block_time BIGINT, buyer TEXT, seller TEXT, price NUMERIC, price_usd NUMERIC,
  price_info JSONB, image TEXT, name TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    a.signature, a.type, a.source, a.token_mint, a.collection,
    a.block_time, a.buyer, a.seller, a.price, a.price_usd, a.price_info,
    a.image, COALESCE(n.name, NULL) AS name
  FROM public.onchain_activities a
  LEFT JOIN public.nft_names n ON n.mint = a.token_mint
  WHERE a.collection = p_collection
    AND (p_type IS NULL OR a.type = p_type)
    -- Hide known merch by name. Unnamed mints pass through so the feed never
    -- waits on Helius enrichment to populate.
    AND (n.name IS NULL OR NOT public.is_merch_name(n.name))
  ORDER BY a.block_time DESC
  OFFSET p_offset
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_onchain_activity(TEXT, TEXT, INT, INT) TO anon, authenticated;

-- ─── Top Sales ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_onchain_top_sales(
  p_collection  TEXT DEFAULT 'collector_crypt',
  p_window_days INT  DEFAULT 7,
  p_min_usd     NUMERIC DEFAULT 10,
  p_limit       INT  DEFAULT 50
)
RETURNS TABLE (
  signature TEXT, type TEXT, source TEXT, token_mint TEXT, collection TEXT,
  block_time BIGINT, buyer TEXT, seller TEXT, price NUMERIC, price_usd NUMERIC,
  price_info JSONB, image TEXT, name TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    a.signature, a.type, a.source, a.token_mint, a.collection,
    a.block_time, a.buyer, a.seller, a.price, a.price_usd, a.price_info,
    a.image, COALESCE(n.name, NULL) AS name
  FROM public.onchain_activities a
  LEFT JOIN public.nft_names n ON n.mint = a.token_mint
  WHERE a.collection = p_collection
    AND a.type = 'buyNow'
    AND a.block_time >= EXTRACT(EPOCH FROM (now() - (p_window_days || ' days')::interval))::bigint
    AND a.price_usd IS NOT NULL
    AND a.price_usd >= p_min_usd
    AND (n.name IS NULL OR NOT public.is_merch_name(n.name))
  ORDER BY a.price_usd DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_onchain_top_sales(TEXT, INT, NUMERIC, INT) TO anon, authenticated;

-- ─── Marketplace listings ─────────────────────────────────────────────────────
-- Listings carry their own display name, so filter on that directly (these
-- mints are largely un-enriched, so n.name wouldn't help here).
CREATE OR REPLACE FUNCTION public.get_onchain_listings(
  p_collection TEXT DEFAULT 'collector_crypt',
  p_sort       TEXT DEFAULT 'price-asc',
  p_limit      INT  DEFAULT 20,
  p_offset     INT  DEFAULT 0
)
RETURNS TABLE (
  pda_address TEXT, collection TEXT, token_mint TEXT, seller TEXT,
  price NUMERIC, price_usd NUMERIC, price_info JSONB, rarity_rank INT,
  name TEXT, image TEXT, marketplace_url TEXT
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT
    l.pda_address, l.collection, l.token_mint, l.seller,
    l.price, l.price_usd, l.price_info, l.rarity_rank,
    l.name, l.image, l.marketplace_url
  FROM public.onchain_listings l
  WHERE l.collection = p_collection
    AND l.delisted_at IS NULL
    AND NOT public.is_merch_name(l.name)
  ORDER BY
    CASE WHEN p_sort = 'price-asc'  THEN l.price END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN l.price END DESC NULLS LAST,
    CASE WHEN p_sort = 'recent'     THEN l.first_seen_at END DESC NULLS LAST
  OFFSET p_offset
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_onchain_listings(TEXT, TEXT, INT, INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
