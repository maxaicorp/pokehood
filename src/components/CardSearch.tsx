import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchCards, PokemonCard, getMarketPrice, formatPrice } from "@/lib/pokemon-api";
import { addToCollection } from "@/lib/collection-store";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

export default function CardSearch({ onCardAdded }: { onCardAdded?: () => void }) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["card-search", searchTerm],
    queryFn: () => searchCards(searchTerm),
    enabled: searchTerm.length > 1,
    staleTime: 60_000,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) setSearchTerm(query.trim());
  };

  const handleAdd = async (card: PokemonCard) => {
    if (!user) {
      toast.error("Please sign in to add cards.");
      return;
    }
    const result = await addToCollection(card, user.id);
    if (result) {
      toast.success(`${card.name} added to collection!`);
      onCardAdded?.();
    } else {
      toast.error("Failed to add card.");
    }
  };

  return (
    <div>
      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search cards by name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10 bg-secondary border-border"
          />
        </div>
        <Button type="submit" variant="hero" disabled={isLoading}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
        </Button>
      </form>

      <AnimatePresence mode="wait">
        {data?.data && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
          >
            {data.data.map((card) => (
              <motion.div
                key={card.id}
                className="group relative rounded-xl bg-card border border-border/50 overflow-hidden card-shine"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <img src={card.images.small} alt={card.name} className="w-full" loading="lazy" />
                <div className="p-3">
                  <p className="text-xs font-semibold text-foreground truncate">{card.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{card.set.name}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm font-bold text-primary">
                      {formatPrice(getMarketPrice(card))}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleAdd(card)}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {searchTerm && !isLoading && data?.data?.length === 0 && (
        <p className="text-center text-muted-foreground py-12">No cards found for "{searchTerm}"</p>
      )}
    </div>
  );
}
