import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  getMarketSets,
  getMarketPrice,
  formatPrice,
  PokemonCard,
  PokemonSet,
  hydrateCardsFromLatestPrices,
} from "@/lib/pokemon-api";
import { addToCollection } from "@/lib/collection-store";
import { formatPct, getLatestSnapshotPage } from "@/lib/price-snapshots";
import { recordCollectionAdd } from "@/lib/card-stats-store";
import { getSetSentiment, castVote, type SetSentiment, type VoteType } from "@/lib/sentiment-store";
import AppHeader from "@/components/AppHeader";
import SetSentimentBadge from "@/components/SetSentimentBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, TrendingUp, TrendingDown, ArrowUp, ArrowDown, ArrowUpDown, Flame, Trophy, Eye, Package } from "lucide-react";
import SealedTab from "@/components/SealedTab";
import { SEALED_TYPES } from "@/lib/sealed-store";
import { getMostViewed, CardStatRow } from "@/lib/card-stats-store";
import { toast } from "sonner";
import { motion } from "framer-motion";
import ViewToggle, { type ViewMode } from "@/components/ViewToggle";
import CardGridView from "@/components/CardGridView";
import SEO from "@/components/SEO";

type MarketTab = "top" | "trending" | "gainers" | "losers" | "most-visited" | "sealed";

const VISIBLE_PAGE_SIZE = 10;
// Hard cap on how deep "Recent X" filters scroll before stopping — the tail
// is sub-dollar commons that nobody is browsing for. Cap is per-filter so
// recent10 (~2× the sets) gets a proportionally larger budget.
const RECENT_CAPS: Record<string, number> = { recent5: 300, recent10: 500 };

export default function Market() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedSetId, setSelectedSetId] = useState("recent5");
  const [addingCards, setAddingCards] = useState(new Set<string>());
  const [sortCol, setSortCol] = useState<"price" | "24h" | "7d" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState<MarketTab>("top");
  const [mostVisitedCards, setMostVisitedCards] = useState<CardStatRow[]>([]);
  const [mostVisitedLoading, setMostVisitedLoading] = useState(false);
  const [sealedType, setSealedType] = useState("Elite Trainer Box");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Sentiment voting state
  const [sentimentMap, setSentimentMap] = useState<Map<string, SetSentiment>>(new Map());
  const isRecentFilter = selectedSetId === "recent5" || selectedSetId === "recent10";

  // Always fetch fresh from the DB on mount/focus. No localStorage cache — it was
  // the silent source of "site shows three-week-old prices" complaints. The DB's
  // get_all_latest_prices RPC is already fast (~150ms paginated), so the brief
  // first-paint skeleton is preferable to potentially-stale data.
  const [cards, setCards] = useState<PokemonCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const [hasMore, setHasMore] = useState(true);
  const [setsData, setSetsData] = useState<{ data: PokemonSet[] } | null>(null);
  const [pricesReady, setPricesReady] = useState(false);
  // Bumping this re-triggers the data-loading effect — used by window-focus
  // refresh and by the admin Master Refresh broadcast.
  const [refreshToken, setRefreshToken] = useState(0);

  const resolveMarketSetIds = useCallback(() => {
    const physicalSets = (setsData?.data ?? []).filter((s: PokemonSet) => !s.isOnlineOnly);
    if (selectedSetId === "recent5") return new Set(physicalSets.slice(0, 5).map((s) => s.id));
    if (selectedSetId === "recent10") return new Set(physicalSets.slice(0, 10).map((s) => s.id));
    if (selectedSetId) return new Set([selectedSetId]);
    return new Set(physicalSets.map((s) => s.id));
  }, [selectedSetId, setsData]);

  // Load most visited when tab is active
  useEffect(() => {
    if (activeTab !== "most-visited") return;
    setMostVisitedLoading(true);
    getMostViewed(10).then((rows) => {
      setMostVisitedCards(rows);
      setMostVisitedLoading(false);
    });
  }, [activeTab]);

  // Step 1: Load lightweight set metadata; do not block first paint on the full card index.
  useEffect(() => {
    getMarketSets().then((r) => {
      setSetsData(r);
      setPricesReady(true);
    });
  }, []);

  // Step 2: Load only the first visible price page, then append more pages on scroll.
  useEffect(() => {
    if (!pricesReady || !setsData) return;
    let cancelled = false;
    setIsLoading(true);
    setVisibleCount(VISIBLE_PAGE_SIZE);

    setHasMore(true);
    loadingMoreRef.current = true;
    const setIds = resolveMarketSetIds();

    const cap = RECENT_CAPS[selectedSetId];

    getLatestSnapshotPage({ setIds, limit: VISIBLE_PAGE_SIZE, offset: 0 }).then(hydrateCardsFromLatestPrices).then((result) => {
      if (!cancelled) {
        setCards(result);
        setIsLoading(false);
        const reachedCap = cap !== undefined && result.length >= cap;
        setHasMore(result.length === VISIBLE_PAGE_SIZE && !reachedCap);
        loadingMoreRef.current = false;
      }
    }).catch((err) => {
      if (!cancelled) {
        setIsLoading(false);
        loadingMoreRef.current = false;
        // Surface failures instead of silently leaving an empty grid on screen.
        // Without this toast, a broken DB query looked identical to "no cards in this set".
        console.error("Market price fetch failed:", err);
        toast.error("Could not load latest prices. Pull to refresh or try again.");
      }
    });

    return () => { cancelled = true; };
  }, [pricesReady, resolveMarketSetIds, selectedSetId, setsData, refreshToken]);

  // Refresh on tab focus and on a custom "collectiblez:force-refresh" event
  // (broadcast by the admin Master Refresh button via localStorage). Without
  // this, a user with the tab in the background sees stale prices indefinitely.
  useEffect(() => {
    const bump = () => setRefreshToken((n) => n + 1);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "collectiblez:force-refresh") bump();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Realtime push: when the snapshot-prices cron writes a new row to the
  // price_snapshots table, every open Market tab gets notified within ~1s and
  // re-fetches. This is the "backend updates the frontend immediately" wire —
  // no polling, no cache invalidation, no Master Refresh click needed.
  // Debounced because a single cron run writes thousands of rows in a burst.
  useEffect(() => {
    let pendingBump: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("price-snapshots-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "price_snapshots" },
        () => {
          if (pendingBump) clearTimeout(pendingBump);
          // Wait 3s of quiet (no more inserts) before refetching — keeps us from
          // hammering the RPC mid-cron-run.
          pendingBump = setTimeout(() => setRefreshToken((n) => n + 1), 3000);
        },
      )
      .subscribe();
    return () => {
      if (pendingBump) clearTimeout(pendingBump);
      supabase.removeChannel(channel);
    };
  }, []);

  // Fetch sentiment for visible cards when filter is recent5/recent10
  useEffect(() => {
    if (!isRecentFilter || cards.length === 0) return;
    const cardIds = cards.map((c) => c.id);
    getSetSentiment(cardIds).then(setSentimentMap);
  }, [isRecentFilter, cards]);

  const handleVote = async (cardId: string, voteType: VoteType) => {
    if (!user) {
      navigate("/auth");
      return;
    }
    const current = sentimentMap.get(cardId);
    const currentVote = current?.currentUserVote ?? null;
    const newVote = currentVote === voteType ? null : voteType;

    // Optimistic update
    setSentimentMap((prev) => {
      const next = new Map(prev);
      const old = prev.get(cardId) || { setId: cardId, upvotes: 0, downvotes: 0, score: 0, currentUserVote: null };
      const upvotes = Math.max(0, old.upvotes + (voteType === "up" ? (currentVote === "up" ? -1 : 1) : (currentVote === "up" ? -1 : 0)));
      const downvotes = Math.max(0, old.downvotes + (voteType === "down" ? (currentVote === "down" ? -1 : 1) : (currentVote === "down" ? -1 : 0)));
      next.set(cardId, { ...old, upvotes, downvotes, score: upvotes - downvotes, currentUserVote: newVote });
      return next;
    });

    await castVote(cardId, user.id, currentVote, voteType);
  };

  // Infinite scroll observer
  useEffect(() => {
    // Defer attaching until the initial load is done. Otherwise the observer
    // can fire while loadingMoreRef.current is still true (set by the data
    // loader at the start of its fetch), the callback bails, and no new
    // intersection event ever arrives — leaving the page stuck at 10 rows
    // until the component re-mounts.
    if (isLoading) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loadingMoreRef.current && activeTab !== "sealed" && activeTab !== "most-visited") {
          const cap = RECENT_CAPS[selectedSetId];
          // Clamp the request so we never fetch past the cap, even if the user
          // scrolls fast enough to trigger a load right at the boundary.
          const remaining = cap !== undefined ? Math.max(0, cap - cards.length) : VISIBLE_PAGE_SIZE;
          const pageLimit = Math.min(VISIBLE_PAGE_SIZE, remaining);
          if (pageLimit <= 0) { setHasMore(false); return; }

          loadingMoreRef.current = true;
          getLatestSnapshotPage({ setIds: resolveMarketSetIds(), limit: pageLimit, offset: cards.length })
            .then(hydrateCardsFromLatestPrices)
            .then((nextCards) => {
              setCards((prev) => [...prev, ...nextCards]);
              setVisibleCount((prev) => prev + nextCards.length);
              const reachedCap = cap !== undefined && (cards.length + nextCards.length) >= cap;
              setHasMore(nextCards.length === pageLimit && !reachedCap);
              loadingMoreRef.current = false;
            })
            .catch(() => { loadingMoreRef.current = false; });
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, cards.length, hasMore, resolveMarketSetIds, selectedSetId, isLoading]);

  const handleSort = (col: "price" | "24h" | "7d") => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const handleAdd = async (e: React.MouseEvent, card: PokemonCard) => {
    e.stopPropagation();
    if (!user) {
      navigate("/auth");
      return;
    }
    if (addingCards.has(card.id)) return;
    setAddingCards((prev) => new Set(prev).add(card.id));
    const result = await addToCollection(card, user.id);
    setAddingCards((prev) => {
      const next = new Set(prev);
      next.delete(card.id);
      return next;
    });
    if (result) {
      toast.success(`${card.name} added to collection!`);
      recordCollectionAdd({ id: card.id, name: card.name, setName: card.set.name, imageSmall: card.images.small });
      queryClient.invalidateQueries({ queryKey: ["collection"] });
    } else {
      toast.error("Failed to add card.");
    }
  };

  const selectedSet = setsData?.data?.find((s: PokemonSet) => s.id === selectedSetId);

  const getPcts = (card: PokemonCard) => {
    const avgs = card.cardmarketAvgs;
    const trend = avgs?.trend ?? null;
    const raw24h = trend != null && avgs?.avg1 != null && avgs.avg1 !== 0 ? ((trend - avgs.avg1) / avgs.avg1) * 100 : null;
    const raw7d = trend != null && avgs?.avg7 != null && avgs.avg7 !== 0 ? ((trend - avgs.avg7) / avgs.avg7) * 100 : null;
    const raw30d = trend != null && avgs?.avg30 != null && avgs.avg30 !== 0 ? ((trend - avgs.avg30) / avgs.avg30) * 100 : null;
    return { raw24h, raw7d, raw30d };
  };

  const rawPricedCards = (cards || []).filter((c) => getMarketPrice(c) !== null);
  const unpricedCards = (cards || []).filter((c) => getMarketPrice(c) === null);

  // Apply tab-based default sorting, then allow manual column sort to override
  const getTabSortedCards = () => {
    let sorted = [...rawPricedCards];

    if (sortCol) {
      return sorted.sort((a, b) => {
        let va: number | null, vb: number | null;
        if (sortCol === "price") {
          va = getMarketPrice(a);
          vb = getMarketPrice(b);
        } else {
          const pa = getPcts(a);
          const pb = getPcts(b);
          va = sortCol === "24h" ? pa.raw24h : pa.raw7d;
          vb = sortCol === "24h" ? pb.raw24h : pb.raw7d;
        }
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return sortDir === "asc" ? va - vb : vb - va;
      });
    }

    switch (activeTab) {
      case "top":
        return sorted.sort((a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0));
      case "trending":
        return sorted
          .filter((c) => getPcts(c).raw24h !== null)
          .sort((a, b) => Math.abs(getPcts(b).raw24h ?? 0) - Math.abs(getPcts(a).raw24h ?? 0));
      case "gainers":
        return sorted
          .filter((c) => (getPcts(c).raw24h ?? 0) > 0)
          .sort((a, b) => (getPcts(b).raw24h ?? 0) - (getPcts(a).raw24h ?? 0));
      case "losers":
        return sorted
          .filter((c) => (getPcts(c).raw24h ?? 0) < 0)
          .sort((a, b) => (getPcts(a).raw24h ?? 0) - (getPcts(b).raw24h ?? 0));
      default:
        return sorted;
    }
  };

  const pricedCards = getTabSortedCards();
  const visibleCards = pricedCards.slice(0, visibleCount);

  const isSingleSet = selectedSetId && !selectedSetId.startsWith("recent");
  const totalValue = rawPricedCards.reduce((sum, c) => sum + (getMarketPrice(c) ?? 0), 0);

  const gridClasses = isSingleSet
    ? "sm:grid-cols-[32px_1fr_100px_80px_80px_36px]"
    : isRecentFilter
      ? "sm:grid-cols-[32px_1fr_160px_100px_80px_80px_96px_36px]"
      : "sm:grid-cols-[32px_1fr_160px_100px_80px_80px_36px]";

  const SortIcon = ({ col }: { col: "price" | "24h" | "7d" }) => {
    if (sortCol !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  // Helper: get sentiment for a card
  const getCardSentiment = (card: PokemonCard): SetSentiment | undefined => {
    if (!isRecentFilter) return undefined;
    return sentimentMap.get(card.id);
  };

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <SEO
        title="Pokémon TCG Market Prices & Trends — Collectiblez"
        description="Live market prices, 24h/7d trends, gainers, losers, and sealed product values for every Pokémon TCG expansion."
        path="/market"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Pokémon TCG Market",
          url: "https://collectiblez.app/market",
          description: "Live market prices and trends for Pokémon TCG cards and sealed products.",
        }}
      />
      <AppHeader activePage="market" />

      <div className="container py-6 px-4 sm:px-8">
        {/* Tabs + Set selector */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
          <div className="flex items-center gap-1 border-b border-border/50 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-none">
            {([
              { key: "top", label: "Top", icon: Trophy },
              { key: "sealed", label: "Sealed", icon: Package },
              { key: "trending", label: "Movers", icon: Flame },
              { key: "gainers", label: "Gainers", icon: TrendingUp },
              { key: "losers", label: "Losers", icon: TrendingDown },
              { key: "most-visited", label: "Most Visited", icon: Eye },
            ] as const).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => { setActiveTab(key); setSortCol(null); }}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {activeTab === "sealed" ? (
            <div className="flex items-center gap-3 justify-between sm:justify-end">
              <Select value={sealedType} onValueChange={setSealedType}>
                <SelectTrigger className="w-[180px] sm:w-[200px] bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEALED_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ViewToggle value={viewMode} onChange={setViewMode} />
            </div>
          ) : activeTab === "most-visited" ? (
            <div className="flex items-center gap-3 justify-between sm:justify-end">
              <ViewToggle value={viewMode} onChange={setViewMode} />
            </div>
          ) : (
            <div className="flex items-center gap-3 justify-between sm:justify-end">
              {!isLoading && totalValue > 0 && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    {isSingleSet ? "Set Total" : `Top ${pricedCards.length} Value`}
                  </p>
                  <p className="text-lg font-bold text-foreground">
                    {formatPrice(totalValue)}
                  </p>
                </div>
              )}
              <Select
                value={selectedSetId || "all"}
                onValueChange={(v) => setSelectedSetId(v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-[180px] sm:w-[200px] bg-background">
                  <SelectValue placeholder="All Sets" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sets</SelectItem>
                  <SelectItem value="recent5">Recent Sets (5)</SelectItem>
                  <SelectItem value="recent10">Recent Sets (10)</SelectItem>
                  {setsData?.data
                    ?.filter((s: PokemonSet) => !s.isOnlineOnly)
                    .map((s: PokemonSet) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ViewToggle value={viewMode} onChange={setViewMode} />
            </div>
          )}
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Table header — hidden when Sealed/Most Visited tab is active or grid mode */}
          {activeTab !== "sealed" && activeTab !== "most-visited" && viewMode === "list" && (
            <div className={`hidden sm:grid ${gridClasses} gap-2 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground items-center`}>
              <span>#</span>
              <span>Card</span>
              {!isSingleSet && <span>Set</span>}
              <button onClick={() => handleSort("price")} className="flex items-center justify-end gap-1 whitespace-nowrap hover:text-foreground transition-colors">
                Price <SortIcon col="price" />
              </button>
              <button onClick={() => handleSort("24h")} className="flex items-center justify-end gap-1 whitespace-nowrap hover:text-foreground transition-colors">
                24h % <SortIcon col="24h" />
              </button>
              <button onClick={() => handleSort("7d")} className="flex items-center justify-end gap-1 whitespace-nowrap hover:text-foreground transition-colors">
                7d % <SortIcon col="7d" />
              </button>
              {isRecentFilter && <span className="text-right">Vote</span>}
              <span />
            </div>
          )}

          {activeTab === "sealed" ? (
            <SealedTab typeFilter={sealedType} viewMode={viewMode} />
          ) : activeTab === "most-visited" ? (
            mostVisitedLoading ? (
              <div>
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                    <Skeleton className="h-4 w-6 shrink-0" />
                    <Skeleton className="w-10 h-14 rounded-md shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                    <Skeleton className="h-5 w-16 ml-auto" />
                  </div>
                ))}
              </div>
            ) : mostVisitedCards.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                No visit data yet. Browse some cards to populate this list!
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-3">
                {mostVisitedCards.map((stat, i) => (
                  <motion.div
                    key={stat.tcg_api_id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    className="group relative rounded-xl overflow-hidden bg-card border border-border/50 hover:border-primary/40 cursor-pointer transition-all hover:shadow-lg hover:shadow-primary/5"
                    onClick={() => navigate(`/card/${stat.tcg_api_id}`)}
                  >
                    <div className="aspect-[5/7] relative overflow-hidden bg-muted">
                      {stat.image_small ? (
                        <img src={stat.image_small} alt={stat.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Eye className="w-8 h-8 text-muted-foreground/30" />
                        </div>
                      )}
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-background/90 backdrop-blur-sm border border-border/50 flex items-center gap-1">
                        <Eye className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs font-bold text-foreground tabular-nums">{stat.view_count}</span>
                      </div>
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-semibold text-foreground truncate">{stat.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{stat.set_name}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div>
                {mostVisitedCards.map((stat, i) => (
                  <motion.div
                    key={stat.tcg_api_id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    className="grid grid-cols-[24px_1fr_auto] sm:grid-cols-[40px_1fr_160px_100px_44px] gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 border-b border-border/50 last:border-0 items-center hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => navigate(`/card/${stat.tcg_api_id}`)}
                  >
                    <span className="text-sm font-mono text-muted-foreground tabular-nums">{i + 1}</span>
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      {stat.image_small && (
                        <img src={stat.image_small} alt={stat.name} className="w-9 sm:w-10 rounded-md shrink-0 shadow-sm" loading="lazy" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{stat.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{stat.set_name}</p>
                      </div>
                    </div>
                    <p className="hidden sm:block text-sm text-muted-foreground truncate">{stat.set_name}</p>
                    <div className="flex items-center justify-end gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground tabular-nums">{stat.view_count}</span>
                    </div>
                    <span />
                  </motion.div>
                ))}
              </div>
            )
          ) : isLoading && cards.length === 0 ? (
            <div>
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0"
                >
                  <Skeleton className="h-4 w-6 shrink-0" />
                  <Skeleton className="w-10 h-14 rounded-md shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                  <Skeleton className="h-5 w-16 ml-auto" />
                </div>
              ))}
            </div>
          ) : pricedCards.length === 0 && !isLoading ? (
            <div className="py-16 text-center text-muted-foreground">
              No pricing data available right now.
            </div>
          ) : viewMode === "grid" ? (
            <div>
              <CardGridView
                cards={visibleCards}
                getPcts={getPcts}
                onAdd={handleAdd}
                addingCards={addingCards}
                sentimentMap={isRecentFilter ? sentimentMap : undefined}
                onVote={handleVote}
              />
              <div ref={sentinelRef} className="h-1" />
            </div>
          ) : (
            <div>
              {visibleCards.map((card, i) => {
                const price = getMarketPrice(card);
                const { raw24h, raw7d } = getPcts(card);
                const pct24h = formatPct(raw24h);
                const pct7d = formatPct(raw7d);
                const sentiment = getCardSentiment(card);
                return (
                  <motion.div
                    key={card.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.008, 0.3) }}
                    className="border-b border-border/50 last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => navigate(`/card/${card.id}`)}
                  >
                    {/* Desktop: grid row */}
                    <div className={`hidden sm:grid ${gridClasses} gap-2 px-4 py-2.5 items-center`}>
                      <span className="text-sm font-mono text-muted-foreground tabular-nums">{i + 1}</span>
                      <div className="flex items-center gap-3 min-w-0">
                        <img src={card.images.small} alt={card.name} className="w-10 rounded-md shrink-0 shadow-sm" loading="lazy" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{card.name}</p>
                          <p className="text-[10px] text-muted-foreground/60 truncate">#{card.number}/{card.set.printedTotal || card.set.total}</p>
                        </div>
                      </div>
                      {!isSingleSet && <p className="text-sm text-muted-foreground truncate">{card.set.name}</p>}
                      <p className="text-sm font-bold text-foreground text-right tabular-nums">{formatPrice(price)}</p>
                      <p className={`text-xs font-medium text-right tabular-nums ${pct24h.className}`}>{pct24h.text}</p>
                      <p className={`text-xs font-medium text-right tabular-nums ${pct7d.className}`}>{pct7d.text}</p>
                      {isRecentFilter && (
                        <div className="flex justify-end">
                          <SetSentimentBadge
                            upvotes={sentiment?.upvotes ?? 0}
                            downvotes={sentiment?.downvotes ?? 0}
                            score={sentiment?.score ?? 0}
                            currentUserVote={sentiment?.currentUserVote ?? null}
                            onVote={(vt) => handleVote(card.id, vt)}
                            compact
                          />
                        </div>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 rounded-full border border-border/50 hover:border-primary hover:text-primary shrink-0"
                        disabled={addingCards.has(card.id)}
                        onClick={(e) => handleAdd(e, card)}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    {/* Mobile: stacked layout */}
                    <div className="sm:hidden px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground tabular-nums w-4 shrink-0 text-right">{i + 1}</span>
                        <img src={card.images.small} alt={card.name} className="w-11 rounded-md shrink-0 shadow-sm" loading="lazy" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-sm font-semibold text-foreground truncate">{card.name}</p>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 rounded-full border border-border/50 hover:border-primary hover:text-primary shrink-0"
                              disabled={addingCards.has(card.id)}
                              onClick={(e) => handleAdd(e, card)}
                            >
                              <Plus className="w-3 h-3" />
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{card.set.name} · #{card.number}/{card.set.printedTotal || card.set.total}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs font-bold text-foreground tabular-nums">{formatPrice(price)}</span>
                            <span className={`text-[10px] font-medium tabular-nums ${pct24h.className}`}>{pct24h.text}</span>
                            <span className={`text-[10px] font-medium tabular-nums ${pct7d.className}`}>{pct7d.text}</span>
                            {isRecentFilter && (
                              <SetSentimentBadge
                                upvotes={sentiment?.upvotes ?? 0}
                                downvotes={sentiment?.downvotes ?? 0}
                                score={sentiment?.score ?? 0}
                                currentUserVote={sentiment?.currentUserVote ?? null}
                                onVote={(vt) => handleVote(card.id, vt)}
                                compact
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}

              {/* Unpriced cards in set view */}
              {isSingleSet && unpricedCards.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-muted/30 border-t border-border text-xs text-muted-foreground">
                    {unpricedCards.length} card{unpricedCards.length !== 1 ? "s" : ""} with no pricing data
                  </div>
                  {unpricedCards.map((card, i) => (
                    <motion.div
                      key={card.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.005, 0.2) }}
                      className={`grid grid-cols-[24px_1fr_auto] ${gridClasses} gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 border-b border-border/50 last:border-0 items-center hover:bg-muted/30 cursor-pointer transition-colors opacity-50`}
                      onClick={() => navigate(`/card/${card.id}`)}
                    >
                      <span className="text-sm font-mono text-muted-foreground">—</span>
                      <div className="flex items-center gap-3 min-w-0">
                        <img src={card.images.small} alt={card.name} className="w-9 sm:w-10 rounded-md shrink-0 shadow-sm" loading="lazy" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{card.name}</p>
                          <p className="text-[10px] text-muted-foreground/60 truncate">#{card.number}/{card.set.printedTotal || card.set.total}</p>
                        </div>
                      </div>
                      {!isSingleSet && <p className="hidden sm:block text-sm text-muted-foreground truncate">{card.set.name}</p>}
                      <p className="hidden sm:block text-sm text-muted-foreground text-right">N/A</p>
                      <p className="hidden sm:block text-xs text-muted-foreground text-right">—</p>
                      <p className="hidden sm:block text-xs text-muted-foreground text-right">—</p>
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-sm text-muted-foreground sm:hidden">N/A</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 rounded-full border border-border/50 hover:border-primary hover:text-primary shrink-0"
                          disabled={addingCards.has(card.id)}
                          onClick={(e) => handleAdd(e, card)}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </>
              )}
              {/* Sentinel for infinite scroll */}
              <div ref={sentinelRef} className="h-1" />
              {isLoading && cards.length > 0 && (
                <div className="flex items-center justify-center py-4 gap-2 text-sm text-muted-foreground">
                  <span className="w-4 h-4 animate-spin border-2 border-primary border-t-transparent rounded-full" />
                  Loading more cards…
                </div>
              )}
            </div>
          )}
        </div>

        {!isLoading && activeTab !== "sealed" && (
          <p className="text-xs text-muted-foreground text-center mt-4">
            {isSingleSet
              ? `${pricedCards.length} of ${(cards || []).length} cards have pricing`
              : `Showing top ${pricedCards.length} cards`}
          </p>
        )}
      </div>
    </div>
  );
}
