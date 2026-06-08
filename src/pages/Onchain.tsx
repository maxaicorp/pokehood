import { useState, useEffect, useRef, useCallback } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ExternalLink, ArrowUpRight, ArrowDownLeft, Tag, Gavel, XCircle, RefreshCw, AlertTriangle } from "lucide-react";
import SEO from "@/components/SEO";
import { CC_REFERRAL_URL } from "@/components/CollectorCryptPromoItem";
import { formatTradePrice, useSolPrice, type PriceInfo } from "@/lib/onchain-price";
import { useUrlState } from "@/lib/use-url-state";

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

type OnchainTab = "activity" | "marketplace" | "top-sales";
const ONCHAIN_TABS: { value: OnchainTab; label: string; description: string }[] = [
  { value: "activity", label: "Activity", description: "Live sales and listings" },
  { value: "top-sales", label: "Top Sales", description: "Highest USD sales" },
  { value: "marketplace", label: "Marketplace", description: "Active listings" },
];

// Top Sales time-window pills. The DB-backed endpoint computes price_usd at
// ingest (USDC trades use splPrice; SOL trades use spot SOL/USD), so the
// leaderboard is consistent across both currencies. Sorted desc by price_usd.
type TopSalesWindow = 1 | 7 | 30;
const TOP_SALES_WINDOWS: { value: TopSalesWindow; label: string }[] = [
  { value: 1,  label: "24h" },
  { value: 7,  label: "7d" },
  { value: 30, label: "30d" },
];
// Small noise filter — skip $1 test trades that pollute the leaderboard.
// Time-window leaderboards do the real work; this is just sanity floor.
const TOP_SALES_MIN_USD = 10;
const TOP_SALES_LIMIT = 50;

// Marketplace sort options. The get_onchain_listings RPC sorts both price
// directions natively, so each option maps straight to a `sort` param.
type MarketplaceSort = "price-asc" | "price-desc" | "recent";
const MARKETPLACE_SORTS: { value: MarketplaceSort; label: string }[] = [
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "recent", label: "Recently Listed" },
];

// Marketplace listing sources. Each ingest owns its own `collection` value so
// they never delist each other's rows. CC API (collector_crypt_cc) is the full
// inventory; Magic Eden (collector_crypt) is the subset listed on ME.
type MarketplaceSource = "cc" | "me";
const MARKETPLACE_COLLECTION: Record<MarketplaceSource, string> = {
  cc: "collector_crypt_cc",
  me: "collector_crypt",
};
const MARKETPLACE_SOURCES: { value: MarketplaceSource; label: string }[] = [
  { value: "cc", label: "Collector Crypt" },
  { value: "me", label: "Magic Eden" },
];

// Infinite-scroll batch size + per-session cap. 1000 was chosen so the entire
// session stays under ~50 ME requests per tab (well within the free tier's
// limits) and the user gets ~50 screens of scroll before hitting the wall.
const BATCH = 20;
const ITEM_CAP = 1000;

export default function OnchainPage() {
  // Each tab is its own URL so clicking forces a full route change and a
  // fresh component mount, instead of just flipping local state. Prior
  // tab-as-state design got into stuck loading states the user couldn't
  // recover from without a hard refresh. URL-routed tabs sidestep that.
  //   /onchain              → redirect to /onchain/activity
  //   /onchain/activity     → activity feed
  //   /onchain/marketplace  → marketplace browse
  const params = useParams<{ tab?: string }>();
  const tab = params.tab as OnchainTab | undefined;
  if (!tab) return <Navigate to="/onchain/activity" replace />;
  if (tab !== "activity" && tab !== "marketplace" && tab !== "top-sales") {
    return <Navigate to="/onchain/activity" replace />;
  }
  // key={tab} forces a FULL remount when the tab changes (the route param
  // alone doesn't remount the component). This guarantees each tab starts with
  // fresh queries instead of leaning on react-query's enabled/refetch dance —
  // which is what left tabs showing stale data "most of the time" on switch.
  return <Onchain key={tab} activeTab={tab} />;
}

function Onchain({ activeTab }: { activeTab: OnchainTab }) {
  const navigate = useNavigate();
  // Sub-filters are URL-driven (useUrlState) too — same reason as the tabs: a
  // click is a deterministic navigation, and the filtered view is shareable.
  const [typeFilter, setTypeFilter] = useUrlState<string>("type", "");
  const [marketplaceSort, setMarketplaceSort] = useUrlState<MarketplaceSort>("sort", "price-asc");
  // Two distinct listing sources, each owns its own `collection` value so the
  // ingests never delete each other's rows: CC API (collector_crypt_cc) vs
  // Magic Eden (collector_crypt). Default to CC — it's the fuller inventory.
  const [marketplaceSource, setMarketplaceSource] = useUrlState<MarketplaceSource>("source", "cc");
  const activeTypeFilter = TYPE_FILTERS.some((filter) => filter.value === typeFilter) ? typeFilter : "";
  const activeMarketplaceSource = MARKETPLACE_SOURCES.some((source) => source.value === marketplaceSource)
    ? marketplaceSource
    : "cc";
  const activeMarketplaceSort = MARKETPLACE_SORTS.some((sort) => sort.value === marketplaceSort)
    ? marketplaceSort
    : "price-asc";
  const marketplaceCollection = MARKETPLACE_COLLECTION[activeMarketplaceSource];

  // Active listing count for the selected source — shown in the header.
  const { data: listedCount } = useQuery({
    queryKey: ["onchain-listed-count", activeMarketplaceSource],
    queryFn: async () => {
      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/onchain_listings?collection=eq.${marketplaceCollection}&delisted_at=is.null&select=token_mint`,
        { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Prefer: "count=exact", Range: "0-0" } },
      );
      return Number((r.headers.get("content-range") || "").split("/")[1]) || 0;
    },
    enabled: activeTab === "marketplace",
    refetchInterval: activeTab === "marketplace" ? 30_000 : false,
  });
  // Window is a number (1|7|30) but URL params are strings — store the string,
  // expose a numeric value + a number-taking setter so the pills stay unchanged.
  const [windowStr, setWindowStr] = useUrlState<"1" | "7" | "30">("window", "7");
  const activeWindowStr = TOP_SALES_WINDOWS.some((window) => String(window.value) === windowStr) ? windowStr : "7";
  const topSalesWindow = Number(activeWindowStr) as TopSalesWindow;
  const setTopSalesWindow = (w: TopSalesWindow) => setWindowStr(String(w) as "1" | "7" | "30");
  const queryClient = useQueryClient();

  // Hard refresh — invalidates the cache for BOTH activity and listings
  // queries, then refetches the active one. Used by the Refresh button so
  // users have an escape hatch when something feels stale. A plain
  // refetch() reuses the React Query cache; invalidateQueries clears it.
  const hardRefresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["onchain-activity"] }),
      queryClient.invalidateQueries({ queryKey: ["onchain-listings"] }),
      queryClient.invalidateQueries({ queryKey: ["onchain-top-sales"] }),
      queryClient.invalidateQueries({ queryKey: ["onchain-listed-count"] }),
      queryClient.invalidateQueries({ queryKey: ["sol-price"] }),
    ]);
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
    queryKey: ["onchain-activity", activeTypeFilter],
    queryFn: async ({ pageParam }) => {
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onchain-activity`;
      const params = new URLSearchParams({
        collection: "collector_crypt",
        offset: String(pageParam * BATCH),
        limit: String(BATCH),
      });
      if (activeTypeFilter) params.set("type", activeTypeFilter);
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
      if (activeTypeFilter) {
        const leaked = raw.filter((a) => a.type !== activeTypeFilter);
        if (leaked.length > 0) {
          console.warn(`[onchain] ${leaked.length}/${raw.length} events leaked through ${activeTypeFilter} filter (types: ${[...new Set(leaked.map(l => l.type))].join(",")})`);
        }
        return raw.filter((a) => a.type === activeTypeFilter);
      }
      // Bids are bot noise — never surface them in the unfiltered feed.
      return raw.filter((a) => a.type !== "bid");
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

  // ─── Top Sales: backed by /onchain-top-sales DB-RPC endpoint ───────────
  //
  // The ingest cron computes price_usd at write time, so this is a single
  // indexed SELECT — no client-side USD math, no infinite scroll. The
  // endpoint returns the top N sales by USD value within the selected
  // time window (1d / 7d / 30d), already sorted desc.
  interface TopSaleItem extends Omit<Activity, "price"> {
    price: number;
    priceUsd: number | null;
  }
  const {
    data: topSalesData,
    isLoading: isTopSalesLoading,
    isFetching: isTopSalesFetching,
    isError: isTopSalesError,
    refetch: refetchTopSales,
  } = useQuery({
    queryKey: ["onchain-top-sales", topSalesWindow],
    queryFn: async () => {
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onchain-top-sales`;
      const params = new URLSearchParams({
        collection: "collector_crypt",
        window: String(topSalesWindow),
        limit: String(TOP_SALES_LIMIT),
        min_usd: String(TOP_SALES_MIN_USD),
      });
      const res = await fetch(`${baseUrl}?${params}`, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });
      if (!res.ok) throw new Error(`Top sales unavailable (${res.status})`);
      const json = (await res.json()) as { items: TopSaleItem[]; window: number; count: number };
      return json;
    },
    enabled: activeTab === "top-sales",
    refetchInterval: activeTab === "top-sales" ? 60_000 : false,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const topSales: TopSaleItem[] = topSalesData?.items ?? [];

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
  // Reads from the onchain-listings edge fn, which is backed by the
  // get_onchain_listings DB RPC and sorts BOTH price directions natively. So
  // every sort is plain forward pagination: offset = page * BATCH, render the
  // items as returned. (The old Magic-Eden-era "walk offsets from the end +
  // include_total + reverse each page" gymnastics are gone — ME isn't on this
  // path anymore.)
  const {
    data: listingsPages,
    isLoading: listingsLoading,
    isFetching: listingsFetching,
    isError: listingsError,
    fetchNextPage: fetchNextListings,
    hasNextPage: hasNextListings,
    isFetchingNextPage: isFetchingMoreListings,
  } = useInfiniteQuery({
    // sort + source in the key so switching either resets the list and
    // refetches from page 0.
    queryKey: ["onchain-listings", activeMarketplaceSort, activeMarketplaceSource],
    queryFn: async ({ pageParam }) => {
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onchain-listings`;
      // The edge fn / get_onchain_listings RPC accept these sort tokens
      // directly and sort natively in the DB — no offset-from-end math.
      const params = new URLSearchParams({
        collection: marketplaceCollection,
        offset: String(pageParam * BATCH),
        limit: String(BATCH),
        sort: activeMarketplaceSort, // "price-asc" | "price-desc" | "recent"
      });
      const res = await fetch(`${baseUrl}?${params}`, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });
      if (!res.ok) throw new Error(`Marketplace unavailable (${res.status})`);
      const body = (await res.json()) as { items?: Listing[] };

      // Thin client safety net only. Merch is filtered server-side by the RPC
      // (is_merch_name); this catches the rare un-indexed straggler. Keep items
      // with no name — they may be legit listings whose metadata isn't indexed
      // yet, and dropping them blanked the page once (2026-05-21).
      const items = (body.items ?? []).filter((l) => {
        const nm = (l.name ?? "").trim().toLowerCase();
        return nm !== "moonbirds physical collectible";
      });
      return { items };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
      if (loaded >= ITEM_CAP) return undefined;
      if (lastPage.items.length < BATCH) return undefined;
      return allPages.length;
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
  const activeFetching =
    activeTab === "activity"
      ? isFetching
      : activeTab === "top-sales"
      ? isTopSalesFetching
      : listingsFetching;

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
                href={CC_REFERRAL_URL}
                target="_blank"
                rel="noopener noreferrer sponsored"
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
            disabled={activeFetching}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${activeFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="grid gap-3 mb-6 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              View
            </label>
            <Select value={activeTab} onValueChange={(value) => navigate(`/onchain/${value as OnchainTab}`)}>
              <SelectTrigger className="mt-1 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ONCHAIN_TABS.map((tab) => (
                  <SelectItem key={tab.value} value={tab.value}>
                    <span className="font-medium">{tab.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{tab.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {activeTab === "activity" && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Activity Type
              </label>
              <Select value={activeTypeFilter || "all"} onValueChange={(value) => setTypeFilter(value === "all" ? "" : value)}>
                <SelectTrigger className="mt-1 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_FILTERS.map((filter) => (
                    <SelectItem key={filter.value || "all"} value={filter.value || "all"}>
                      {filter.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {activeTab === "top-sales" && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Window
              </label>
              <Select value={String(topSalesWindow)} onValueChange={(value) => setTopSalesWindow(Number(value) as TopSalesWindow)}>
                <SelectTrigger className="mt-1 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOP_SALES_WINDOWS.map((window) => (
                    <SelectItem key={window.value} value={String(window.value)}>
                      {window.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

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
                <Skeleton className="w-32 sm:w-44 aspect-[3/4] rounded-md" />
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
                    className="w-32 sm:w-44 aspect-[3/4] object-contain bg-muted shrink-0"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="w-32 sm:w-44 aspect-[3/4] bg-muted flex items-center justify-center text-muted-foreground text-xs shrink-0">
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

        {/* ─── Top Sales branch ───────────────────────────────────────────
            Leaderboard of the top sales by USD value within a rolling
            window. All filtering + USD math happens server-side in the
            get_onchain_top_sales RPC, so the client just renders. */}
        {activeTab === "top-sales" && (<>
          <div className="text-xs text-muted-foreground mb-4">
            Top {TOP_SALES_LIMIT} sales in the last{" "}
            {TOP_SALES_WINDOWS.find((w) => w.value === topSalesWindow)?.label} by USD value.
          </div>

          {isTopSalesError && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive mb-4">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Failed to load top sales</p>
                <p className="text-xs opacity-80 mt-0.5">The onchain feed is temporarily unavailable. Try refreshing.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchTopSales()} className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10">
                Retry
              </Button>
            </div>
          )}

          <div className="space-y-3">
            {isTopSalesLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border/50">
                  <Skeleton className="w-32 sm:w-44 aspect-[3/4] rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-56" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-6 w-20" />
                </div>
              ))
            ) : topSales.length > 0 ? (
              topSales.map((a, i) => (
                <a
                  key={a.signature}
                  href={`https://solscan.io/tx/${a.signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border/50 hover:border-primary/30 hover:bg-card/80 transition-colors group"
                >
                  {/* Rank badge — gold/silver/bronze for top 3, muted otherwise */}
                  <div className={`shrink-0 w-8 text-center text-sm font-bold tabular-nums ${
                    i === 0 ? "text-yellow-500"
                    : i === 1 ? "text-zinc-400"
                    : i === 2 ? "text-amber-700"
                    : "text-muted-foreground"
                  }`}>
                    #{i + 1}
                  </div>
                  {a.image ? (
                    <img
                      src={a.image}
                      alt=""
                      className="w-32 sm:w-44 aspect-[3/4] object-contain bg-muted shrink-0"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="w-32 sm:w-44 aspect-[3/4] bg-muted flex items-center justify-center text-muted-foreground text-xs shrink-0">
                      NFT
                    </div>
                  )}
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
                    {a.name ? (
                      <p className="text-sm font-semibold text-foreground mt-1 truncate" title={a.name}>
                        {a.name}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-1 font-mono truncate">
                        Mint: {shortenAddress(a.tokenMint)}
                      </p>
                    )}
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap">
                      {a.buyer && (
                        <span>Buyer: <span className="font-mono">{shortenAddress(a.buyer)}</span></span>
                      )}
                      {a.seller && (
                        <span>Seller: <span className="font-mono">{shortenAddress(a.seller)}</span></span>
                      )}
                      <span>{timeAgo(a.blockTime)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0 self-start">
                    {/* Top Sales leads with USD because the leaderboard IS ranked by USD —
                        showing SOL primary would confuse "why is this one above that one". */}
                    {a.priceUsd != null ? (
                      <>
                        <div className="text-lg font-bold tabular-nums text-foreground">
                          ${a.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                        {(() => {
                          const fmt = formatTradePrice(a.price, a.priceInfo, solUsd);
                          return fmt.primary ? (
                            <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
                              {fmt.primary}
                            </div>
                          ) : null;
                        })()}
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">—</div>
                    )}
                    <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto mt-1" />
                  </div>
                </a>
              ))
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No sales in this window yet. The ingest cron may still be filling the table —
                check back in a minute.
              </div>
            )}
          </div>
        </>)}

        {/* ─── Marketplace branch ─────────────────────────────────────────── */}
        {activeTab === "marketplace" && (<>
          {/* Sort dropdown above the grid. Same three options Magic Eden's
              own UI shows. Changing the selection resets the infinite scroll
              (because marketplaceSort is in the query key). */}
          <div className="grid gap-3 mb-4 sm:grid-cols-[1fr_220px_220px] sm:items-end">
            <span className="text-sm text-muted-foreground tabular-nums sm:pb-2">
              {listedCount != null ? `${listedCount.toLocaleString()} listed` : " "}
            </span>
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Source
              </label>
              <Select value={activeMarketplaceSource} onValueChange={(v) => setMarketplaceSource(v as MarketplaceSource)}>
                <SelectTrigger className="mt-1 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETPLACE_SOURCES.map((source) => (
                    <SelectItem key={source.value} value={source.value}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Sort
              </label>
              <Select value={activeMarketplaceSort} onValueChange={(v) => setMarketplaceSort(v as MarketplaceSort)}>
                <SelectTrigger className="mt-1 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETPLACE_SORTS.map((sort) => (
                    <SelectItem key={sort.value} value={sort.value}>
                      {sort.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
                  className="bg-card border border-border/50 p-3 hover:border-primary/30 hover:bg-card/80 transition-colors group block"
                >
                  {/* 3:4 portrait aspect — physical TCG cards are taller than
                      they are wide. Square was leaving large empty bands on
                      every tile and making the card art look tiny. */}
                  {l.image ? (
                    <img
                      src={l.image}
                      alt=""
                      className="aspect-[3/4] w-full object-contain bg-muted"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="aspect-[3/4] w-full bg-muted flex items-center justify-center text-muted-foreground text-xs">
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
