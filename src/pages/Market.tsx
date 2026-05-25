// ─── MARKET RENDERING CONTRACT ───────────────────────────────────────────────
//
// READ THIS BEFORE EDITING. The same bug has been "fixed" ~100 times because
// well-meaning edits add a caching layer that hides fresh data behind stale
// data. The contract below is the only working version. Changing it WILL
// reintroduce the stale-prices bug.
//
// 1. Data source: get_latest_price_page RPC. That RPC reads from the
//    precomputed latest_card_prices table (NOT from price_snapshots and NOT
//    via live aggregation). Both the table and the RPC live in
//    supabase/migrations/20260519010000_latest_card_prices_table.sql.
//
// 2. Cache strategy: NONE on the browser side. No localStorage. No
//    in-memory shadow that survives across mounts. The DB read is ~30-50ms;
//    a brief skeleton on first paint is correct behavior.
//
// 3. Refresh triggers (any of these re-fetches):
//      a. Component mount / filter change (selectedSetId, refreshToken deps)
//      b. document.visibilitychange  — user returns to the tab
//      c. window 'storage' event with key "collectiblez:force-refresh"
//         (admin Master Refresh broadcasts this)
//      d. Supabase Realtime INSERT on price_snapshots (debounced ~3s)
//
// 4. Errors are LOUD. If the RPC fails, we toast the user. We do NOT silently
//    .catch() and leave stale rows on screen — that hides outages for weeks.
//
// 5. The precomputed table is refreshed by snapshot-prices/index.ts at the
//    end of every successful daily/full/sets/chunk run. If "the site looks
//    stale," check the AdminHealth page first (snapshot ran?) and then the
//    latest_card_prices row count (refresh ran?). Don't add a cache here.
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
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
import { cardPath, cardPathFromApiId } from "@/lib/slug";
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
// Scroll-load pages are larger than the first paint. The first paint stays at 10
// for fast time-to-content; once the user is scrolling, fetching 25 at a time
// cuts the round-trip count by ~60% over the same scroll distance. The expensive
// part of get_latest_price_page is the per-row LATERAL JOINs for 1d/7d/30d
// prices, so doubling-plus the page size doesn't double the cost.
const SCROLL_PAGE_SIZE = 25;
// Hard cap on how deep multi-set filters scroll before stopping — the tail
// is sub-dollar commons that nobody is browsing for. Cap is per-filter so
// each option gets a budget proportional to its set count.
// Verified 2026-05-18: at modern=500, the 500th card by price is ~$13;
// the 1000th is still ~$4, so 500 leaves plenty of headroom above the
// "should be > $2" rule of thumb if we ever want to bump it.
const RECENT_CAPS: Record<string, number> = { recent5: 300, recent10: 500, modern: 500 };

// "Modern Era" = Scarlet & Violet onward (S&V + Mega Evolution series).
// Series strings come from the Scrydex `expansion.series` field and must
// match exactly — we use these to build the set ID list at render time so
// new sets in either series get picked up automatically without a code change.
const MODERN_ERA_SERIES = new Set(["Scarlet & Violet", "Mega Evolution"]);

export default function Market() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedSetId, setSelectedSetId] = useState("modern");
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
  const isRecentFilter =
    selectedSetId === "recent5" || selectedSetId === "recent10" || selectedSetId === "modern";

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
    if (selectedSetId === "modern") {
      // Every Scarlet & Violet + Mega Evolution set (promos included — the user
      // wants pull-rate promos in this view since they often have chase cards).
      return new Set(
        physicalSets.filter((s) => MODERN_ERA_SERIES.has(s.series)).map((s) => s.id),
      );
    }
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
    // Clear the old set's cards immediately so the dropdown change feels like a
    // fresh load instead of "old prices flicker, then jump to new prices."
    // Without this, switching from "Recent 10" to "sv8" leaves sv-unrelated
    // cards on screen for ~200ms while the new fetch runs.
    setCards([]);
    setSentimentMap(new Map());
    setSortCol(null);
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
          const remaining = cap !== undefined ? Math.max(0, cap - cards.length) : SCROLL_PAGE_SIZE;
          const pageLimit = Math.min(SCROLL_PAGE_SIZE, remaining);
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
      // Prefetch deep: kick off the next page when the sentinel is 800px from the
      // viewport, not 200px. The fetch then happens DURING the scroll instead of
      // after the user has already hit the bottom, which hides the round-trip
      // latency behind their existing scroll motion.
      { rootMargin: "800px" },
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

  // Multi-set filters: empty (All), recent5/10, and modern. Anything else is
  // a single set ID and gets the compact "Set Total" layout without the Set column.
  const isSingleSet =
    !!selectedSetId && selectedSetId !== "modern" && !selectedSetId.startsWith("recent");

  // Server-computed total for the badge in the header. Replaces the previous
  // client-side reduce over loaded cards, which ratcheted upward as the user
  // scrolled (a "Top 30 Value" that should have read "Top 500 Value"). The
  // new RPC reads the precomputed latest_card_prices table and returns
  // {card_count, total_value} for the filter in one round-trip. The badge
  // stays hidden until this query resolves so the displayed number is final,
  // not an intermediate sum.
  const filterCap = RECENT_CAPS[selectedSetId] ?? 500;
  const summarySetIds = (() => {
    if (!setsData) return null;
    if (selectedSetId === "modern") {
      const ids = setsData.data
        .filter((s) => !s.isOnlineOnly && MODERN_ERA_SERIES.has(s.series))
        .map((s) => s.id);
      return ids.length ? ids : null;
    }
    if (selectedSetId === "recent5" || selectedSetId === "recent10") {
      const n = selectedSetId === "recent5" ? 5 : 10;
      const ids = setsData.data.filter((s) => !s.isOnlineOnly).slice(0, n).map((s) => s.id);
      return ids.length ? ids : null;
    }
    return selectedSetId ? [selectedSetId] : null;
  })();
  const { data: summary } = useQuery({
    queryKey: ["market-filter-summary", selectedSetId, filterCap, refreshToken, summarySetIds?.join(",") ?? ""],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_filter_summary", {
        p_set_ids: summarySetIds,
        p_top_n: filterCap,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        cardCount: Number(row?.card_count ?? 0),
        totalValue: Number(row?.total_value ?? 0),
      };
    },
    enabled: !!setsData,
    staleTime: 5 * 60 * 1000,
  });
  // Round up to whole dollars per user request.
  const totalValue = summary ? Math.ceil(summary.totalValue) : 0;
  const totalCount = summary?.cardCount ?? 0;

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
        path="/"
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
              {/* Hidden until the server-computed total arrives, so the
                  number never ratchets as the user scrolls. */}
              {summary && totalValue > 0 && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    {isSingleSet ? "Set Total" : `Top ${totalCount} Value`}
                  </p>
                  <p className="text-lg font-bold text-foreground tabular-nums">
                    ${totalValue.toLocaleString("en-US")}
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
                  <SelectItem value="modern">Modern Era</SelectItem>
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
                    onClick={() => navigate(cardPathFromApiId(stat.tcg_api_id, stat.name, stat.set_name))}
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
                    onClick={() => navigate(cardPathFromApiId(stat.tcg_api_id, stat.name, stat.set_name))}
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
                    onClick={() => navigate(cardPath(card.set, card))}
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

                    {/* Mobile: real card layout (Option A — 2026-05-19).
                        Bigger portrait image, info stacked vertically with
                        breathing room, vote + add on their own action row
                        with proper touch targets. No more cramming everything
                        onto one line. Strictly mobile — desktop grid above
                        is untouched. */}
                    <div className="sm:hidden p-4">
                      <div className="flex gap-3">
                        {/* Card image with rank pill in the corner */}
                        <div className="relative shrink-0">
                          <span className="absolute -top-1.5 -left-1.5 z-10 text-[10px] font-mono font-semibold text-foreground bg-background/95 backdrop-blur px-1.5 py-0.5 rounded-full border border-border/60 tabular-nums shadow-sm">
                            {i + 1}
                          </span>
                          <img
                            src={card.images.small}
                            alt={card.name}
                            className="w-20 aspect-[3/4] rounded-lg shadow-md object-cover bg-muted"
                            loading="lazy"
                          />
                        </div>

                        {/* Details column */}
                        <div className="flex-1 min-w-0 flex flex-col">
                          {/* Title + price */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-base font-semibold text-foreground leading-tight truncate">{card.name}</p>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">{card.set.name}</p>
                              <p className="text-[11px] text-muted-foreground/60 mt-0.5 tabular-nums">
                                #{card.number}/{card.set.printedTotal || card.set.total}
                              </p>
                            </div>
                            <p className="text-base font-bold text-foreground tabular-nums shrink-0">
                              {formatPrice(price)}
                            </p>
                          </div>

                          {/* Stat chips — 24h and 7d each as a labeled pair */}
                          <div className="flex items-center gap-4 text-[11px] mt-2">
                            <div className="flex items-center gap-1">
                              <span className="text-muted-foreground">24h</span>
                              <span className={`font-medium tabular-nums ${pct24h.className}`}>{pct24h.text}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-muted-foreground">7d</span>
                              <span className={`font-medium tabular-nums ${pct7d.className}`}>{pct7d.text}</span>
                            </div>
                          </div>

                          {/* Action row — vote chips + add button. Bigger
                              touch targets than the old icon-only layout. */}
                          <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-border/30">
                            {isRecentFilter ? (
                              <SetSentimentBadge
                                upvotes={sentiment?.upvotes ?? 0}
                                downvotes={sentiment?.downvotes ?? 0}
                                score={sentiment?.score ?? 0}
                                currentUserVote={sentiment?.currentUserVote ?? null}
                                onVote={(vt) => handleVote(card.id, vt)}
                                compact
                              />
                            ) : (
                              <span aria-hidden />
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-3 rounded-full border border-border/50 hover:border-primary hover:text-primary"
                              disabled={addingCards.has(card.id)}
                              onClick={(e) => handleAdd(e, card)}
                            >
                              <Plus className="w-3.5 h-3.5 mr-1" />
                              <span className="text-xs font-medium">Add</span>
                            </Button>
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
                      onClick={() => navigate(cardPath(card.set, card))}
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
