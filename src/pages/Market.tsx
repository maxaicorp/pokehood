import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Plus, TrendingUp, TrendingDown, ArrowUp, ArrowDown, ArrowUpDown, Flame, Trophy } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

type MarketTab = "top" | "trending" | "gainers" | "losers";

export default function Market() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedSetId, setSelectedSetId] = useState("");
  const [addingCards, setAddingCards] = useState(new Set<string>());
  const [sortCol, setSortCol] = useState<"price" | "24h" | "7d" | "30d" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState<MarketTab>("top");

  const handleSort = (col: "price" | "24h" | "7d" | "30d") => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const { data: setsData } = useQuery({
    queryKey: ["pokemon-sets"],
    queryFn: getSets,
    staleTime: 5 * 60_000,
  });

  const { data: cards, isLoading } = useQuery({
    queryKey: ["market-cards", selectedSetId],
    queryFn: () =>
      selectedSetId === "recent"
        ? getRecentSetCards(100)
        : selectedSetId
          ? getSetCardsByPrice(selectedSetId)
          : getTopPricedCards(100),
    staleTime: 15 * 60_000,
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <span className="w-6 h-6 animate-spin border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;

  const handleAdd = async (e: React.MouseEvent, card: PokemonCard) => {
    e.stopPropagation();
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

  const isSingleSet = selectedSetId && selectedSetId !== "recent";
  const setTotalValue = isSingleSet
    ? rawPricedCards.reduce((sum, c) => sum + (getMarketPrice(c) ?? 0), 0)
    : null;

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
    <div className="min-h-screen bg-background pb-16 sm:pb-0">
      <AppHeader activePage="market" />

      <div className="container py-6 px-4 sm:px-8">
        {/* Tabs + Set selector */}
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-1 border-b border-border/50 overflow-x-auto">
            {([
              { key: "top", label: "Top", icon: Trophy },
              { key: "trending", label: "Trending", icon: Flame },
              { key: "gainers", label: "Gainers", icon: TrendingUp },
              { key: "losers", label: "Losers", icon: TrendingDown },
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

          <div className="flex items-center gap-3">
            {setTotalValue !== null && !isLoading && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Set total value</p>
                <p className="text-lg font-bold text-foreground">
                  {formatPrice(setTotalValue)}
                </p>
              </div>
            )}
            <Select
              value={selectedSetId || "all"}
              onValueChange={(v) => setSelectedSetId(v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-[200px] bg-background">
                <SelectValue placeholder="All Sets" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sets</SelectItem>
                <SelectItem value="recent">All Recent Sets (Top 5)</SelectItem>
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
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Table header */}
          <div className={`hidden sm:grid ${gridClasses} gap-4 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground`}>
            <span>#</span>
            <span>Card</span>
            {!selectedSetId && <span>Set</span>}
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

          {isLoading ? (
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
          ) : pricedCards.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              No pricing data available right now.
            </div>
          ) : (
            <div>
              {pricedCards.map((card, i) => {
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
                    className={`grid grid-cols-[40px_1fr_44px] ${gridClasses} gap-4 px-4 py-2.5 border-b border-border/50 last:border-0 items-center hover:bg-muted/30 cursor-pointer transition-colors`}
                    onClick={() => navigate(`/card/${card.id}`)}
                  >
                    {/* Rank */}
                    <span className="text-sm font-mono text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>

                    {/* Card image + name */}
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
                        <p className="text-xs text-muted-foreground truncate sm:hidden">
                          {card.set.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 truncate">
                          #{card.number}/{card.set.printedTotal || card.set.total}
                        </p>
                      </div>
                    </div>

                    {/* Set — desktop only, not rendered in set-specific view */}
                    {!selectedSetId && (
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
              {selectedSetId && unpricedCards.length > 0 && (
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
                      className={`grid grid-cols-[40px_1fr_44px] ${gridClasses} gap-4 px-4 py-2.5 border-b border-border/50 last:border-0 items-center hover:bg-muted/30 cursor-pointer transition-colors opacity-50`}
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
                      {!selectedSetId && <p className="hidden sm:block text-sm text-muted-foreground truncate">{card.set.name}</p>}
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
            </div>
          )}
        </div>

        {!isLoading && (
          <p className="text-xs text-muted-foreground text-center mt-4">
            {selectedSetId
              ? `${pricedCards.length} of ${(cards || []).length} cards have pricing · Prices sourced from TCGdex`
              : "Showing top 100 cards from the 6 newest sets · Prices sourced from TCGdex"}
          </p>
        )}
      </div>
    </div>
  );
}
