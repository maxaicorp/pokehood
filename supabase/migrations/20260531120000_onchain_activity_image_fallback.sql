-- Onchain activity + top-sales: fall back to the listing image/name when the
-- activity row has none.
--
-- CC-native sales (ingest-cc-native) write image=null and rely on nft_names for
-- the name, because the on-chain BuyPnft tx carries no card metadata. Result:
-- the Activity + Top Sales feeds showed grey "NFT" tiles (and often no name)
-- for collector_crypt_native rows. The card's art + name DO exist in
-- onchain_listings (the cc-marketplace ingest stores frontImage + itemName), so
-- borrow them by token_mint via a SCALAR subquery — one value per mint, so the
-- LEFT JOIN can't multiply activity rows.

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
    COALESCE(a.image, (SELECT ol.image FROM public.onchain_listings ol
                       WHERE ol.token_mint = a.token_mint AND ol.image IS NOT NULL
                       LIMIT 1)) AS image,
    COALESCE(n.name, (SELECT ol.name FROM public.onchain_listings ol
                      WHERE ol.token_mint = a.token_mint AND ol.name IS NOT NULL
                      LIMIT 1)) AS name
  FROM public.onchain_activities a
  LEFT JOIN public.nft_names n ON n.mint = a.token_mint
  WHERE a.collection = p_collection
    AND (p_type IS NULL OR a.type = p_type)
    AND (n.name IS NULL OR NOT public.is_merch_name(n.name))
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
  signature TEXT, type TEXT, source TEXT, token_mint TEXT, collection TEXT,
  block_time BIGINT, buyer TEXT, seller TEXT, price NUMERIC, price_usd NUMERIC,
  price_info JSONB, image TEXT, name TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    a.signature, a.type, a.source, a.token_mint, a.collection,
    a.block_time, a.buyer, a.seller, a.price, a.price_usd, a.price_info,
    COALESCE(a.image, (SELECT ol.image FROM public.onchain_listings ol
                       WHERE ol.token_mint = a.token_mint AND ol.image IS NOT NULL
                       LIMIT 1)) AS image,
    COALESCE(n.name, (SELECT ol.name FROM public.onchain_listings ol
                      WHERE ol.token_mint = a.token_mint AND ol.name IS NOT NULL
                      LIMIT 1)) AS name
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
