import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  getTopPricedCards,
  getSetCardsByPrice,
  getSets,
  getMarketPrice,
  formatPrice,
  PokemonCard,
  PokemonSet,
} from "@/lib/pokemon-api";
import { addToCollection } from "@/lib/collection-store";
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
import { Plus, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

export default function Market() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedSetId, setSelectedSetId] = useState("");
  const [addingCards, setAddingCards] = useState(new Set<string>());

  const { data: setsData } = useQuery({
    queryKey: ["pokemon-sets"],
    queryFn: getSets,
    staleTime: 5 * 60_000,
  });

  const { data: cards, isLoading } = useQuery({
    queryKey: ["market-cards", selectedSetId],
    queryFn: () =>
      selectedSetId ? getSetCardsByPrice(selectedSetId) : getTopPricedCards(100),
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
      queryClient.invalidateQueries({ queryKey: ["collection"] });
    } else {
      toast.error("Failed to add card.");
    }
  };

  const selectedSet = setsData?.data?.find((s: PokemonSet) => s.id === selectedSetId);
  const pricedCards = (cards || []).filter((c) => getMarketPrice(c) !== null);
  const unpricedCards = (cards || []).filter((c) => getMarketPrice(c) === null);
  const setTotalValue = selectedSetId
    ? pricedCards.reduce((sum, c) => sum + (getMarketPrice(c) ?? 0), 0)
    : null;

  return (
    <div className="min-h-screen bg-background pb-16 sm:pb-0">
      <AppHeader activePage="market" />

      <div className="container py-6 px-4 sm:px-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-5 h-5 text-primary" />
              <h1 className="font-display font-bold text-xl sm:text-2xl text-foreground">
                Price Market
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {selectedSetId
                ? selectedSet
                  ? `${selectedSet.name} — ${pricedCards.length} cards with pricing`
                  : "Cards sorted by market price"
                : "Top 100 most valuable cards across the 6 newest sets"}
              {isLoading && (
                <span className="ml-2 text-primary animate-pulse">
                  Loading prices…
                </span>
              )}
            </p>
          </div>

          {/* Set selector */}
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
                <SelectValue placeholder="All Recent Sets" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Recent Sets</SelectItem>
                {setsData?.data?.map((s: PokemonSet) => (
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
          <div className="hidden sm:grid grid-cols-[40px_1fr_160px_100px_44px] gap-4 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground">
            <span>#</span>
            <span>Card</span>
            <span className={selectedSetId ? "hidden" : ""}>Set</span>
            <span className="text-right">Market Price</span>
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
                return (
                  <motion.div
                    key={card.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.008, 0.3) }}
                    className="grid grid-cols-[40px_1fr_44px] sm:grid-cols-[40px_1fr_160px_100px_44px] gap-4 px-4 py-2.5 border-b border-border/50 last:border-0 items-center hover:bg-muted/30 cursor-pointer transition-colors"
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

                    {/* Set — desktop, hidden in set-specific view */}
                    <p
                      className={`hidden sm:block text-sm text-muted-foreground truncate ${
                        selectedSetId ? "opacity-0 pointer-events-none" : ""
                      }`}
                    >
                      {card.set.name}
                    </p>

                    {/* Price */}
                    <p className="hidden sm:block text-sm font-bold text-foreground text-right tabular-nums">
                      {formatPrice(price)}
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
                      className="grid grid-cols-[40px_1fr_44px] sm:grid-cols-[40px_1fr_160px_100px_44px] gap-4 px-4 py-2.5 border-b border-border/50 last:border-0 items-center hover:bg-muted/30 cursor-pointer transition-colors opacity-50"
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
                      <p className="hidden sm:block text-sm text-muted-foreground/40 truncate opacity-0" />
                      <p className="hidden sm:block text-sm text-muted-foreground text-right">
                        N/A
                      </p>
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
