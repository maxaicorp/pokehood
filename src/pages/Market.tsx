import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  getTopPricedCards,
  getMarketPrice,
  formatPrice,
  PokemonCard,
  CONDITIONS,
} from "@/lib/pokemon-api";
import { addToCollection } from "@/lib/collection-store";
import AppHeader from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

export default function Market() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [addingCards, setAddingCards] = useState(new Set<string>());

  const { data: cards, isLoading } = useQuery({
    queryKey: ["market-top-100"],
    queryFn: () => getTopPricedCards(100),
    staleTime: 30 * 60_000,
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

  return (
    <div className="min-h-screen bg-background pb-16 sm:pb-0">
      <AppHeader activePage="market" />

      <div className="container py-6 px-4 sm:px-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h1 className="font-display font-bold text-xl sm:text-2xl text-foreground">
              Price Market
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Top 100 most valuable cards, ranked by current market price.
            {isLoading && (
              <span className="ml-2 text-primary animate-pulse">
                Loading prices…
              </span>
            )}
          </p>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Table header */}
          <div className="hidden sm:grid grid-cols-[40px_1fr_200px_100px_80px_44px] gap-4 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground">
            <span>#</span>
            <span>Card</span>
            <span>Set</span>
            <span className="text-right">Price</span>
            <span className="text-right">7d %</span>
            <span />
          </div>

          {isLoading ? (
            <div>
              {Array.from({ length: 10 }).map((_, i) => (
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
                  <Skeleton className="h-4 w-16 hidden sm:block" />
                  <Skeleton className="h-5 w-14 ml-auto" />
                </div>
              ))}
            </div>
          ) : !cards?.length ? (
            <div className="py-16 text-center text-muted-foreground">
              No pricing data available right now.
            </div>
          ) : (
            <div>
              {cards.map((card, i) => {
                const price = getMarketPrice(card);
                return (
                  <motion.div
                    key={card.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.01, 0.3) }}
                    className="grid grid-cols-[40px_1fr_44px] sm:grid-cols-[40px_1fr_200px_100px_80px_44px] gap-4 px-4 py-2.5 border-b border-border/50 last:border-0 items-center hover:bg-muted/30 cursor-pointer transition-colors"
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
                        {card.rarity && (
                          <p className="text-[10px] text-muted-foreground/70 truncate">
                            {card.rarity}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Set — desktop only */}
                    <p className="hidden sm:block text-sm text-muted-foreground truncate">
                      {card.set.name}
                    </p>

                    {/* Price — desktop only */}
                    <p className="hidden sm:block text-sm font-bold text-foreground text-right tabular-nums">
                      {formatPrice(price)}
                    </p>

                    {/* 7d % — desktop only */}
                    <p
                      className="hidden sm:block text-sm text-right text-muted-foreground/50"
                      title="Price history coming soon"
                    >
                      —
                    </p>

                    {/* Add button */}
                    <div className="flex items-center justify-end gap-2">
                      {/* Price on mobile */}
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
            </div>
          )}
        </div>

        {!isLoading && cards?.length === 100 && (
          <p className="text-xs text-muted-foreground text-center mt-4">
            Showing top 100 cards by market price · Prices sourced from TCGdex
          </p>
        )}
      </div>
    </div>
  );
}
