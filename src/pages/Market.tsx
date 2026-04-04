import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  getTopPricedCards,
  getRecentSetCards,
  getSetCardsByPrice,
  getSets,
  getMarketPrice,
  formatPrice,
  PokemonCard,
  PokemonSet,
  TCGP_SERIES_IDS,
} from "@/lib/pokemon-api";
import { addToCollection } from "@/lib/collection-store";
import { formatPct } from "@/lib/price-snapshots";
import { recordCollectionAdd } from "@/lib/card-stats-store";
import AppHeader from "@/components/AppHeader";
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
import { getMostViewed, CardStatRow } from "@/lib/card-stats-store";
import { toast } from "sonner";
import { motion } from "framer-motion";

type MarketTab = "top" | "trending" | "gainers" | "losers" | "most-visited" | "sealed";

const VISIBLE_PAGE_SIZE = 50;

export default function Market() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedSetId, setSelectedSetId] = useState("recent5");
  const [addingCards, setAddingCards] = useState(new Set<string>());
  const [sortCol, setSortCol] = useState<"price" | "24h" | "7d" | "30d" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState<MarketTab>("top");
  const [mostVisitedCards, setMostVisitedCards] = useState<CardStatRow[]>([]);
  const [mostVisitedLoading, setMostVisitedLoading] = useState(false);

  // Progressive loading state
  const [cards, setCards] = useState<PokemonCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [setsData, setSetsData] = useState<{ data: PokemonSet[] } | null>(null);

  // Load most visited when tab is active
  useEffect(() => {
    if (activeTab !== "most-visited") return;
    setMostVisitedLoading(true);
    getMostViewed(10).then((rows) => {
      setMostVisitedCards(rows);
      setMostVisitedLoading(false);
    });
  }, [activeTab]);

  // Load sets once
  useEffect(() => {
    getSets().then((r) => setSetsData(r));
  }, []);

  // Fetch cards with progressive updates
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setCards([]);
    setVisibleCount(VISIBLE_PAGE_SIZE);

    const onProgress = (partialCards: PokemonCard[]) => {
      if (!cancelled) setCards([...partialCards]);
    };

    const fetchFn =
      selectedSetId === "recent5"
        ? () => getRecentSetCards(100, 5, onProgress)
        : selectedSetId === "recent10"
          ? () => getRecentSetCards(100, 10, onProgress)
          : selectedSetId
            ? () => getSetCardsByPrice(selectedSetId, onProgress)
            : () => getTopPricedCards(100, onProgress);

    fetchFn().then((finalCards) => {
      if (!cancelled) {
        setCards(finalCards);
        setIsLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [selectedSetId]);

  // Infinite scroll observer
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount((prev) => prev + VISIBLE_PAGE_SIZE);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cards.length]);

  const handleSort = (col: "price" | "24h" | "7d" | "30d") => {
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

    // If user clicked a column header, that takes priority
    if (sortCol) {
      return sorted.sort((a, b) => {
        let va: number | null, vb: number | null;
        if (sortCol === "price") {
          va = getMarketPrice(a);
          vb = getMarketPrice(b);
        } else {
          const pa = getPcts(a);
          const pb = getPcts(b);
          va = sortCol === "24h" ? pa.raw24h : sortCol === "7d" ? pa.raw7d : pa.raw30d;
          vb = sortCol === "24h" ? pb.raw24h : sortCol === "7d" ? pb.raw7d : pb.raw30d;
        }
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return sortDir === "asc" ? va - vb : vb - va;
      });
    }

    // Tab-based default sorting
    switch (activeTab) {
      case "top":
        return sorted.sort((a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0));
      case "trending": {
        // Cards with highest absolute 24h movement (either direction = activity)
        return sorted
          .filter((c) => getPcts(c).raw24h !== null)
          .sort((a, b) => Math.abs(getPcts(b).raw24h ?? 0) - Math.abs(getPcts(a).raw24h ?? 0));
      }
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
    ? "sm:grid-cols-[40px_1fr_100px_72px_72px_72px_44px]"
    : "sm:grid-cols-[40px_1fr_160px_100px_72px_72px_72px_44px]";

  const SortIcon = ({ col }: { col: "price" | "24h" | "7d" | "30d" }) => {
    if (sortCol !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <AppHeader activePage="market" />

      <div className="container py-6 px-4 sm:px-8">
        {/* Tabs + Set selector */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
          <div className="flex items-center gap-1 border-b border-border/50 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-none">
            {([
              { key: "top", label: "Top", icon: Trophy },
              { key: "sealed", label: "Sealed", icon: Package },
              { key: "trending", label: "Trending", icon: Flame },
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

          {activeTab !== "sealed" && (
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
                    ?.filter((s: PokemonSet) => !TCGP_SERIES_IDS.includes(s.series.toLowerCase()))
                    .map((s: PokemonSet) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Table header */}
          <div className={`hidden sm:grid ${gridClasses} gap-4 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground`}>
            <span>#</span>
            <span>Card</span>
            {!isSingleSet && <span>Set</span>}
            <button onClick={() => handleSort("price")} className="flex items-center justify-end hover:text-foreground transition-colors">
              Market Price <SortIcon col="price" />
            </button>
            <button onClick={() => handleSort("24h")} className="flex items-center justify-end hover:text-foreground transition-colors">
              24h % <SortIcon col="24h" />
            </button>
            <button onClick={() => handleSort("7d")} className="flex items-center justify-end hover:text-foreground transition-colors">
              7d % <SortIcon col="7d" />
            </button>
            <button onClick={() => handleSort("30d")} className="flex items-center justify-end hover:text-foreground transition-colors">
              30d % <SortIcon col="30d" />
            </button>
            <span />
          </div>

          {activeTab === "sealed" ? (
            <div className="py-16 text-center text-muted-foreground">
              <Package className="w-12 h-12 mx-auto mb-4 opacity-40" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Sealed Products</h3>
              <p className="text-sm max-w-md mx-auto">
                Sealed product tracking is coming soon. Browse booster boxes, ETBs, and more with live pricing.
              </p>
            </div>
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
          ) : (
            <div>
              {visibleCards.map((card, i) => {
                const price = getMarketPrice(card);
                const { raw24h, raw7d, raw30d } = getPcts(card);
                const pct24h = formatPct(raw24h);
                const pct7d = formatPct(raw7d);
                const pct30d = formatPct(raw30d);
                return (
                  <motion.div
                    key={card.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.008, 0.3) }}
                    className={`grid grid-cols-[24px_1fr_auto] ${gridClasses} gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 border-b border-border/50 last:border-0 items-center hover:bg-muted/30 cursor-pointer transition-colors`}
                    onClick={() => navigate(`/card/${card.id}`)}
                  >
                    {/* Rank */}
                    <span className="text-sm font-mono text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>

                    {/* Card image + name */}
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <img
                        src={card.images.small}
                        alt={card.name}
                        className="w-9 sm:w-10 rounded-md shrink-0 shadow-sm"
                        loading="lazy"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {card.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate sm:hidden">
                          {card.set.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 truncate">
                          #{card.number}/{card.set.printedTotal || card.set.total}
                        </p>
                      </div>
                    </div>

                    {/* Set — desktop only, not rendered in set-specific view */}
                    {!isSingleSet && (
                      <p className="hidden sm:block text-sm text-muted-foreground truncate">
                        {card.set.name}
                      </p>
                    )}

                    {/* Price */}
                    <p className="hidden sm:block text-sm font-bold text-foreground text-right tabular-nums">
                      {formatPrice(price)}
                    </p>

                    {/* 24h % */}
                    <p className={`hidden sm:block text-xs font-medium text-right tabular-nums ${pct24h.className}`}>
                      {pct24h.text}
                    </p>

                    {/* 7d % */}
                    <p className={`hidden sm:block text-xs font-medium text-right tabular-nums ${pct7d.className}`}>
                      {pct7d.text}
                    </p>

                    {/* 30d % */}
                    <p className={`hidden sm:block text-xs font-medium text-right tabular-nums ${pct30d.className}`}>
                      {pct30d.text}
                    </p>

                    {/* Mobile price + add button */}
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-sm font-bold text-foreground sm:hidden tabular-nums">
                        {formatPrice(price)}
                      </span>
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
                      <span className="text-sm font-mono text-muted-foreground">
                        —
                      </span>
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={card.images.small}
                          alt={card.name}
                          className="w-9 sm:w-10 rounded-md shrink-0 shadow-sm"
                          loading="lazy"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">
                            {card.name}
                          </p>
                          <p className="text-[10px] text-muted-foreground/60 truncate">
                            #{card.number}/{card.set.printedTotal || card.set.total}
                          </p>
                        </div>
                      </div>
                      {!isSingleSet && <p className="hidden sm:block text-sm text-muted-foreground truncate">{card.set.name}</p>}
                      <p className="hidden sm:block text-sm text-muted-foreground text-right">
                        N/A
                      </p>
                      <p className="hidden sm:block text-xs text-muted-foreground text-right">—</p>
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
              ? `${pricedCards.length} of ${(cards || []).length} cards have pricing · Prices sourced from TCGdex`
              : `Showing top ${pricedCards.length} cards · Prices sourced from TCGdex`}
          </p>
        )}
      </div>
    </div>
  );
}
