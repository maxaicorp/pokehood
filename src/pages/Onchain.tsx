import { useState, useEffect, useRef, useCallback } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import AppHeader from "@/components/AppHeader";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExternalLink, ArrowUpRight, ArrowDownLeft, Tag, Gavel, XCircle, RefreshCw, AlertTriangle, Activity as ActivityIcon, Store } from "lucide-react";
import SEO from "@/components/SEO";
import { formatTradePrice, useSolPrice, type PriceInfo } from "@/lib/onchain-price";

interface Activity {
  signature: string;
  type: string;
  source: string;
  tokenMint: string;
  collection: string;
  blockTime: number;
  buyer?: string;
  seller?: string;
  price: number;
  image?: string;
  // Full priceInfo so we can detect USDC trades vs SOL trades.
  priceInfo?: PriceInfo;
  // Card name — injected by the onchain-activity edge function via Helius
  // getAssetBatch. ME's /activities response doesn't include the human
  // name, only tokenMint. Optional because Helius enrichment is
  // best-effort; if it fails, we fall back to rendering the mint address.
  name?: string;
}

const TYPE_FILTERS = [
  { value: "", label: "All" },
  { value: "buyNow", label: "Sales" },
  { value: "list", label: "Listings" },
  { value: "bid", label: "Bids" },
];

const typeIcon = (type: string) => {
  switch (type) {
    case "buyNow": return <ArrowUpRight className="w-4 h-4 text-emerald-500" />;
    case "list": return <Tag className="w-4 h-4 text-sky-500" />;
    case "delist": return <XCircle className="w-4 h-4 text-muted-foreground" />;
    case "bid": return <Gavel className="w-4 h-4 text-yellow-500" />;
    case "cancelBid": return <XCircle className="w-4 h-4 text-muted-foreground" />;
    default: return <ArrowDownLeft className="w-4 h-4 text-muted-foreground" />;
  }
};

const typeLabel = (type: string) => {
  switch (type) {
    case "buyNow": return "Sale";
    case "list": return "Listed";
    case "delist": return "Delisted";
    case "bid": return "Bid";
    case "cancelBid": return "Bid Cancelled";
    default: return type;
  }
};

const shortenAddress = (addr: string) =>
  addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : "—";

const timeAgo = (ts: number) => {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

interface Listing {
  pdaAddress: string;
  tokenMint: string;
  collection: string;
  seller: string;
  price: number;
  priceInfo?: PriceInfo;
  name?: string;
  image?: string;
  rarityRank?: number | null;
  marketplaceUrl: string;
}

type OnchainTab = "activity" | "marketplace";

// Marketplace sort options. Magic Eden's listings endpoint only supports
// ascending order, so "Price: High to Low" is implemented by walking offsets
// from the end of the listings array (we need the total count first, which
// the edge function returns when ?include_total=1 is set).
type MarketplaceSort = "price-asc" | "price-desc" | "recent";
const MARKETPLACE_SORTS: { value: MarketplaceSort; label: string }[] = [
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "recent", label: "Recently Listed" },
];

// Infinite-scroll batch size + per-session cap. 1000 was chosen so the entire
// session stays under ~50 ME requests per tab (well within the free tier's
// limits) and the user gets ~50 screens of scroll before hitting the wall.
const BATCH = 20;
const ITEM_CAP = 1000;

export default function OnchainPage() {
  // Public as of 2026-05-21 — the admin gate came off when the feature was
  // ready enough to show to everyone. Data is all from Magic Eden's public
  // API anyway, no privacy concern. Wrapper kept as the default export so
  // future re-gating is a one-line change.
  return (
    <>
      <Onchain />
    </>
  );
}

function Onchain() {
  const [activeTab, setActiveTab] = useState<OnchainTab>("activity");
  const [typeFilter, setTypeFilter] = useState("");
  const [marketplaceSort, setMarketplaceSort] = useState<MarketplaceSort>("price-asc");
  const queryClient = useQueryClient();

  // Hard refresh — invalidates the cache for BOTH activity and listings
  // queries, then refetches the active one. Used by the Refresh button so
  // users have an escape hatch when something feels stale. A plain
  // refetch() reuses the React Query cache; invalidateQueries clears it.
  const hardRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["onchain-activity"] });
    await queryClient.invalidateQueries({ queryKey: ["onchain-listings"] });
  };

  // Spot SOL/USD price for converting SOL trades into a USD subtitle. Returns
  // null if both Jupiter and CoinGecko are down — the UI just hides the USD
  // line in that case instead of blocking the page.
  const { solUsd } = useSolPrice();

  // Activity feed — infinite scroll, 1000-event cap. Magic Eden returns events
  // newest-first by default, so each page=N gives the next 20 older events.
  const {
    data: activityPages,
    isLoading,
    isFetching,
    isError,
    refetch,
    fetchNextPage: fetchNextActivity,
    hasNextPage: hasNextActivity,
    isFetchingNextPage: isFetchingMoreActivity,
  } = useInfiniteQuery({
    queryKey: ["onchain-activity", typeFilter],
    queryFn: async ({ pageParam }) => {
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onchain-activity`;
      const params = new URLSearchParams({
        collection: "collector_crypt",
        offset: String(pageParam * BATCH),
        limit: String(BATCH),
      });
      if (typeFilter) params.set("type", typeFilter);
      const res = await fetch(`${baseUrl}?${params}`, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });
      if (!res.ok) throw new Error(`Activity feed unavailable (${res.status})`);
      const raw = (await res.json()) as Activity[];
      // Defensive client-side filter — multi-layer:
      //   1. ME's ?type= filter (server-side, primary)
      //   2. Edge function strict re-filter (server-side, also primary)
      //   3. This client-side filter (defense in depth — never trust upstream)
      // The "Sales tab shows Bids" bug recurred so many times that bypassing
      // any of these is unacceptable. Hard guard: if a typeFilter is set, the
      // ONLY allowed type in the rendered list is exactly that string.
      if (typeFilter) {
        const leaked = raw.filter((a) => a.type !== typeFilter);
        if (leaked.length > 0) {
          console.warn(`[onchain] ${leaked.length}/${raw.length} events leaked through ${typeFilter} filter (types: ${[...new Set(leaked.map(l => l.type))].join(",")})`);
        }
        return raw.filter((a) => a.type === typeFilter);
      }
      return raw;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.length, 0);
      if (loaded >= ITEM_CAP) return undefined;        // hit our 1000 cap
      if (lastPage.length < BATCH) return undefined;   // ME ran out
      return allPages.length;
    },
    refetchInterval: activeTab === "activity" ? 30_000 : false,
    enabled: activeTab === "activity",
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const activities = activityPages?.pages.flat() ?? [];

  // Sentinel-based scroll trigger: when this div enters the viewport, load
  // the next page. rootMargin gives us 600px of warning so the fetch starts
  // before the user reaches the bottom and we don't show empty space.
  const activitySentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeTab !== "activity") return;
    const el = activitySentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextActivity && !isFetchingMoreActivity) {
          fetchNextActivity();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeTab, hasNextActivity, isFetchingMoreActivity, fetchNextActivity, activities.length]);

  // Marketplace — infinite scroll, 1000-listing cap, sortable.
  //
  // The "Price: High to Low" sort is implemented by walking offsets from the
  // end of the collection's listings array, because Magic Eden's listings
  // endpoint only supports ascending sort. The first page fetched in this
  // mode asks the edge function to attach the total listings count
  // (?include_total=1), and subsequent pages compute their offsets from it.
  // Each page's items are reversed before display so the user sees the
  // most-expensive first.
  //
  // For "Price: Low to High" and "Recently Listed" the math is simpler —
  // pageParam * 20 is the offset, items render as ME returns them.
  const {
    data: listingsPages,
    isLoading: listingsLoading,
    isFetching: listingsFetching,
    isError: listingsError,
    fetchNextPage: fetchNextListings,
    hasNextPage: hasNextListings,
    isFetchingNextPage: isFetchingMoreListings,
  } = useInfiniteQuery({
    // marketplaceSort in the key so switching the dropdown resets the list
    // and refetches from page 0 with the new sort.
    queryKey: ["onchain-listings", marketplaceSort],
    queryFn: async ({ pageParam }) => {
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onchain-listings`;
      const sortField = marketplaceSort === "recent" ? "createdAt" : "listPrice";
      const isReverse = marketplaceSort === "price-desc";
      // For Price: High to Low we need the total count to compute offset from
      // the end. We learn it on page 0 via ?include_total=1; subsequent pages
      // pass it along in pageParam.total so we don't re-query stats.
      let offset = pageParam.page * BATCH;
      let total: number | null = pageParam.total;
      if (isReverse && total != null) {
        offset = Math.max(0, total - (pageParam.page + 1) * BATCH);
      }
      const params = new URLSearchParams({
        collection: "collector_crypt",
        offset: String(offset),
        limit: String(BATCH),
        sort: sortField,
      });
      if (isReverse && total == null) params.set("include_total", "1");
      const res = await fetch(`${baseUrl}?${params}`, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });
      if (!res.ok) throw new Error(`Marketplace unavailable (${res.status})`);
      const body = (await res.json()) as { items?: Listing[]; totalListings?: number | null };

      // Client-side blocklist as defense-in-depth — even when the edge function
      // hasn't deployed the latest filter, the page never shows these. Same list
      // as supabase/functions/onchain-listings/index.ts NAME_BLOCKLIST.
      const filterBlocked = (items: Listing[]) =>
        items.filter((l) => {
          const nm = (l.name ?? "").trim().toLowerCase();
          if (!nm) return false;
          if (nm === "moonbirds physical collectible") return false;
          return true;
        });

      if (isReverse && total == null && body.totalListings != null) {
        total = body.totalListings;
        // First reverse-sort fetch landed at offset 0 (default). Now that we
        // know total, recompute and refetch from the actual end. Cheap — a
        // single extra request and only on the first page of this sort.
        if (offset === 0 && total > BATCH) {
          const realOffset = Math.max(0, total - BATCH);
          const reparams = new URLSearchParams({
            collection: "collector_crypt",
            offset: String(realOffset),
            limit: String(BATCH),
            sort: sortField,
          });
          const r2 = await fetch(`${baseUrl}?${reparams}`, {
            headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          });
          if (r2.ok) {
            const b2 = (await r2.json()) as { items?: Listing[] };
            const items = filterBlocked((b2.items ?? []).slice().reverse());
            return { items, total };
          }
        }
      }
      const raw = body.items ?? [];
      const items = filterBlocked(isReverse ? raw.slice().reverse() : raw);
      return { items, total };
    },
    initialPageParam: { page: 0, total: null as number | null },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
      if (loaded >= ITEM_CAP) return undefined;
      if (lastPage.items.length < BATCH) return undefined;
      // For reverse, also stop when we've hit offset 0.
      if (marketplaceSort === "price-desc" && lastPage.total != null) {
        const nextOffset = Math.max(0, lastPage.total - (allPages.length + 1) * BATCH);
        if (nextOffset === 0 && allPages.length > 0) return undefined;
      }
      return { page: allPages.length, total: lastPage.total };
    },
    enabled: activeTab === "marketplace",
    refetchInterval: activeTab === "marketplace" ? 60_000 : false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const listings = listingsPages?.pages.flatMap((p) => p.items) ?? [];

  // Sentinel for marketplace infinite scroll, mirror of activity's setup.
  const listingsSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeTab !== "marketplace") return;
    const el = listingsSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextListings && !isFetchingMoreListings) {
          fetchNextListings();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeTab, hasNextListings, isFetchingMoreListings, fetchNextListings, listings.length]);

  // Manual "Retry" handler kept for the error states.
  const refetchListings = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["onchain-listings"] });
  }, [queryClient]);

  return (
    <div className="min-h-screen pb-20">
      <SEO
        title="Onchain Activity — Phygital Pokémon Cards | Collectiblez"
        description="Live activity feed for phygital NFC and QR-tagged Pokémon trading cards: trades, listings, and transfers."
        path="/onchain"
      />
      <AppHeader activePage="onchain">
        <div />
      </AppHeader>

      <div className="container px-4 sm:px-8 py-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground tracking-tight">
              Onchain Activity
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live trading activity for tokenized Pokémon cards on Solana via{" "}
              <a
                href="https://collectorcrypt.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Collector Crypt <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={hardRefresh}
            disabled={activeTab === "activity" ? isFetching : listingsFetching}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${(activeTab === "activity" ? isFetching : listingsFetching) ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Section tabs — keeps the page extensible for Top Sales / Spins later. */}
        <div className="flex gap-2 mb-4 border-b border-border/50">
          {([
            { v: "activity",    label: "Activity",    Icon: ActivityIcon },
            { v: "marketplace", label: "Marketplace", Icon: Store },
          ] as const).map(({ v, label, Icon }) => (
            <button
              key={v}
              onClick={() => setActiveTab(v)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === v
                  ? "text-foreground border-primary"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {/* Activity-only filter pills */}
        {activeTab === "activity" && (
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                typeFilter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        )}

        {/* Activity branch — original feed unchanged below; wrapped so it
            doesn't render when the Marketplace tab is active. */}
        {activeTab === "activity" && (<>

        {/* Error state */}
        {isError && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive mb-4">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">Failed to load activity</p>
              <p className="text-xs opacity-80 mt-0.5">The onchain feed is temporarily unavailable. Try refreshing.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10">
              Retry
            </Button>
          </div>
        )}

        {/* Activity Feed */}
        <div className="space-y-3">
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border/50">
                <Skeleton className="w-24 sm:w-32 aspect-[3/4] rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-6 w-20" />
              </div>
            ))
          ) : activities && activities.length > 0 ? (
            activities.map((a) => (
              <a
                key={a.signature}
                href={`https://solscan.io/tx/${a.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border/50 hover:border-primary/30 hover:bg-card/80 transition-colors group"
              >
                {/* Card Image — sized for actual card visibility (collectible cards
                    have a roughly 3:4 aspect ratio, so we use a portrait box). */}
                {a.image ? (
                  <img
                    src={a.image}
                    alt=""
                    className="w-24 sm:w-32 aspect-[3/4] rounded-md object-cover bg-muted shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-24 sm:w-32 aspect-[3/4] rounded-md bg-muted flex items-center justify-center text-muted-foreground text-xs shrink-0">
                    NFT
                  </div>
                )}

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {typeIcon(a.type)}
                    <span className="text-base font-semibold text-foreground">
                      {typeLabel(a.type)}
                    </span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                      {a.source.replace("magiceden_v2", "Magic Eden")}
                    </Badge>
                  </div>
                  {/* Card name (Helius-enriched) — falls back to mint
                      address if Helius didn't return a name for this mint. */}
                  {a.name ? (
                    <p
                      className="text-sm font-semibold text-foreground mt-1 truncate"
                      title={a.name}
                    >
                      {a.name}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-1 font-mono truncate">
                      Mint: {shortenAddress(a.tokenMint)}
                    </p>
                  )}
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap">
                    {a.buyer && (
                      <span>
                        Buyer: <span className="font-mono">{shortenAddress(a.buyer)}</span>
                      </span>
                    )}
                    {a.seller && (
                      <span>
                        Seller: <span className="font-mono">{shortenAddress(a.seller)}</span>
                      </span>
                    )}
                    <span>{timeAgo(a.blockTime)}</span>
                  </div>
                </div>

                {/* Price — USDC primary when the trade was in USDC, else SOL
                    primary with USD subtitle. See lib/onchain-price.ts. */}
                <div className="text-right shrink-0 self-start">
                  {(() => {
                    const fmt = formatTradePrice(a.price, a.priceInfo, solUsd);
                    return (
                      <>
                        <div className={`text-lg font-bold tabular-nums ${fmt.isUsdc ? "text-emerald-400" : "text-foreground"}`}>
                          {fmt.primary}
                        </div>
                        {fmt.secondary && (
                          <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
                            {fmt.secondary}
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto mt-1" />
                </div>
              </a>
            ))
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              No activity found
            </div>
          )}
        </div>

        {/* Pagination */}
        {/* Infinite-scroll sentinel + tail state. Renders a fixed-height div
            the IntersectionObserver watches, plus a small status line below
            so users get visible feedback when more pages are loading vs when
            the cap or end has been hit. */}
        {!isError && (
          <>
            <div ref={activitySentinelRef} className="h-1" aria-hidden />
            <div className="py-6 text-center text-xs text-muted-foreground">
              {isFetchingMoreActivity
                ? "Loading more…"
                : !hasNextActivity && activities.length > 0
                ? activities.length >= ITEM_CAP
                  ? `Showing the most recent ${ITEM_CAP.toLocaleString()} events.`
                  : "End of activity feed."
                : ""}
            </div>
          </>
        )}
        </>)}

        {/* ─── Marketplace branch ─────────────────────────────────────────── */}
        {activeTab === "marketplace" && (<>
          {/* Sort dropdown above the grid. Same three options Magic Eden's
              own UI shows. Changing the selection resets the infinite scroll
              (because marketplaceSort is in the query key). */}
          <div className="flex justify-end mb-4">
            <Select value={marketplaceSort} onValueChange={(v) => setMarketplaceSort(v as MarketplaceSort)}>
              <SelectTrigger className="w-[200px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MARKETPLACE_SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {listingsError && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive mb-4">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Failed to load listings</p>
                <p className="text-xs opacity-80 mt-0.5">Magic Eden may be rate-limiting. Try refreshing in a moment.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchListings()} className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10">
                Retry
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {listingsLoading ? (
              Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="rounded-lg bg-card border border-border/50 p-3 space-y-2">
                  <Skeleton className="aspect-[3/4] rounded-md" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))
            ) : listings && listings.length > 0 ? (
              listings.map((l) => (
                <a
                  key={l.pdaAddress}
                  href={l.marketplaceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-card border border-border/50 p-3 hover:border-primary/30 hover:bg-card/80 transition-colors group block"
                >
                  {/* 3:4 portrait aspect — physical TCG cards are taller than
                      they are wide. Square was leaving large empty bands on
                      every tile and making the card art look tiny. */}
                  {l.image ? (
                    <img
                      src={l.image}
                      alt=""
                      className="aspect-[3/4] w-full rounded-md object-cover bg-muted"
                      loading="lazy"
                    />
                  ) : (
                    <div className="aspect-[3/4] w-full rounded-md bg-muted flex items-center justify-center text-muted-foreground text-xs">
                      NFT
                    </div>
                  )}
                  {/* Card title — from Magic Eden's token.name (e.g.
                      "2023 #001 Squirtle CGC 10 ..."). Two lines max, clamped
                      so long names don't blow out the grid row height. */}
                  {l.name && (
                    <p
                      className="text-sm font-semibold text-foreground mt-2 leading-tight line-clamp-2"
                      title={l.name}
                    >
                      {l.name}
                    </p>
                  )}
                  <div className="mt-2 flex items-start justify-between gap-2">
                    {(() => {
                      const fmt = formatTradePrice(l.price, l.priceInfo, solUsd);
                      return (
                        <div className="min-w-0">
                          <div className={`text-sm font-semibold tabular-nums ${fmt.isUsdc ? "text-emerald-400" : "text-foreground"}`}>
                            {fmt.primary}
                          </div>
                          {fmt.secondary && (
                            <div className="text-[10px] text-muted-foreground tabular-nums">
                              {fmt.secondary}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {l.rarityRank != null && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                        #{l.rarityRank}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 font-mono truncate">
                    by {shortenAddress(l.seller)}
                  </p>
                </a>
              ))
            ) : (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                No active listings
              </div>
            )}
          </div>

          {!listingsError && (
            <>
              <div ref={listingsSentinelRef} className="h-1" aria-hidden />
              <div className="py-6 text-center text-xs text-muted-foreground">
                {isFetchingMoreListings
                  ? "Loading more…"
                  : !hasNextListings && listings.length > 0
                  ? listings.length >= ITEM_CAP
                    ? `Showing ${ITEM_CAP.toLocaleString()} listings.`
                    : "End of listings."
                  : ""}
              </div>
            </>
          )}
        </>)}
      </div>
    </div>
  );
}
