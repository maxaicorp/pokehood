-- get_onchain_activity: exclude bids from the unfiltered ("All") feed.
--
-- Bug: the Activity feed dropped 'bid' events CLIENT-SIDE after fetching, but
-- pagination (limit/offset) ran in this RPC over ALL rows including bids. Recent
-- activity is dominated by bot bids (~5 of every 6 events), so a 20-row page
-- became ~3 rows after the client filter, and the infinite-scroll "is there
-- more?" check (lastPage.length < BATCH) concluded "no more" and stopped — the
-- feed cut off at ~3 events even though 5,830 non-bid events exist.
--
-- Fix: exclude bid/cancelBid HERE when no explicit type is requested, so
-- limit/offset paginate over real activity and pages come back full. An explicit
-- ?type= (Sales/Listings) is unaffected. (Everything else — the image/name
-- fallback, merch filter — is preserved verbatim from 20260531120000.)
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
    -- explicit type → exact match; no type → exclude bot bids so the feed
    -- paginates over real activity (the fix).
    AND (
      (p_type IS NOT NULL AND a.type = p_type)
      OR (p_type IS NULL AND a.type NOT IN ('bid', 'cancelBid'))
    )
    AND (n.name IS NULL OR NOT public.is_merch_name(n.name))
  ORDER BY a.block_time DESC
  OFFSET p_offset
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_onchain_activity(TEXT, TEXT, INT, INT) TO anon, authenticated;
