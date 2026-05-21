import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  const [page, setPage] = useState(0);
  const limit = 20;
  const queryClient = useQueryClient();

  const setActivityFilter = (value: string) => {
    queryClient.cancelQueries({ queryKey: ["onchain-activity"] });
    queryClient.removeQueries({ queryKey: ["onchain-activity"] });
    setTypeFilter(value);
    setPage(0);
  };

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

  // Activity feed — existing Magic Eden activities endpoint.
  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ["onchain-activity", typeFilter, page],
    queryFn: async () => {
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onchain-activity`;
      const params = new URLSearchParams({
        collection: "collector_crypt",
        offset: String(page * limit),
        limit: String(limit + 1), // fetch one extra to detect if there's a next page
        _ts: String(Date.now()),
      });
      if (typeFilter) params.set("type", typeFilter);

      const res = await fetch(`${baseUrl}?${params}`, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Activity feed unavailable (${res.status})`);
      const raw = (await res.json()) as Activity[];
      // Defensive client-side filter: Magic Eden's ?type= occasionally leaks
      // through neighboring event types (we saw Bids in a Sales-only filter).
      // Re-filter here so the displayed list matches the chip the user picked.
      const filtered = typeFilter ? raw.filter((a) => a.type === typeFilter) : raw;
      return {
        activities: filtered.slice(0, limit),
        hasMore: filtered.length > limit,
      };
    },
    // Aggressive refresh — user reported "stuck" data showing 5+ min old
    // events when ME's site had fresher ones. Force a fetch every mount,
    // every tab focus, and every 30s while the Activity tab is active.
    // staleTime: 0 is the React Query default but explicit beats implicit.
    refetchInterval: activeTab === "activity" ? 30_000 : false,
    enabled: activeTab === "activity",
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const activities = typeFilter
    ? data?.activities?.filter((activity) => activity.type === typeFilter)
    : data?.activities;
  const hasMore = data?.hasMore ?? false;

  // Marketplace listings — paginated, cheapest first.
  const {
    data: listingsData,
    isLoading: listingsLoading,
    isFetching: listingsFetching,
    isError: listingsError,
    refetch: refetchListings,
  } = useQuery({
    queryKey: ["onchain-listings", page],
    queryFn: async () => {
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onchain-listings`;
      const params = new URLSearchParams({
        collection: "collector_crypt",
        offset: String(page * limit),
        limit: String(limit + 1),
        sort: "listPrice",
        sortDirection: "asc",
      });
      const res = await fetch(`${baseUrl}?${params}`, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });
      if (!res.ok) throw new Error(`Marketplace unavailable (${res.status})`);
      const body = (await res.json()) as { items?: Listing[]; error?: string };
      // Defensive: edge function could return { error: "..." } with 200, OR
      // an unexpected shape if Magic Eden's response changes. Coerce to [] so
      // the page never blanks on a missing field.
      const items = Array.isArray(body.items) ? body.items : [];
      return {
        items: items.slice(0, limit),
        hasMore: items.length > limit,
      };
    },
    enabled: activeTab === "marketplace",
    refetchInterval: activeTab === "marketplace" ? 60_000 : false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const listings = listingsData?.items;
  const listingsHasMore = listingsData?.hasMore ?? false;

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
              onClick={() => { setActiveTab(v); setPage(0); }}
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
              onClick={() => setActivityFilter(f.value)}
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
                <Skeleton className="w-20 sm:w-24 aspect-[3/4] rounded-md" />
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
                    className="w-20 sm:w-24 aspect-[3/4] rounded-md object-cover bg-muted shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-20 sm:w-24 aspect-[3/4] rounded-md bg-muted flex items-center justify-center text-muted-foreground text-xs shrink-0">
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
                  <p className="text-sm text-muted-foreground mt-1 font-mono truncate">
                    Mint: {shortenAddress(a.tokenMint)}
                  </p>
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
        {(page > 0 || hasMore) && !isError && (
          <div className="flex justify-center gap-3 mt-6">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
        </>)}

        {/* ─── Marketplace branch ─────────────────────────────────────────── */}
        {activeTab === "marketplace" && (<>
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
                  <Skeleton className="aspect-square rounded-md" />
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
                  {l.image ? (
                    <img
                      src={l.image}
                      alt=""
                      className="aspect-square w-full rounded-md object-cover bg-muted"
                      loading="lazy"
                    />
                  ) : (
                    <div className="aspect-square w-full rounded-md bg-muted flex items-center justify-center text-muted-foreground text-xs">
                      NFT
                    </div>
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

          {(page > 0 || listingsHasMore) && !listingsError && (
            <div className="flex justify-center gap-3 mt-6">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!listingsHasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>)}
      </div>
    </div>
  );
}
