import { useNavigate } from "react-router-dom";
import { PokemonCard, getMarketPrice, formatPrice } from "@/lib/pokemon-api";
import { formatPct } from "@/lib/price-snapshots";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import SetSentimentBadge from "@/components/SetSentimentBadge";
import type { SetSentiment, VoteType } from "@/lib/sentiment-store";

interface CardGridViewProps {
  cards: PokemonCard[];
  getPcts: (card: PokemonCard) => { raw24h: number | null; raw7d: number | null; raw30d: number | null };
  onAdd?: (e: React.MouseEvent, card: PokemonCard) => void;
  addingCards?: Set<string>;
  sentimentMap?: Map<string, SetSentiment>;
  /** When true, sentimentMap keys are card IDs instead of set IDs */
  sentimentKeyIsCardId?: boolean;
  onVote?: (setId: string, voteType: VoteType) => void;
}

export default function CardGridView({ cards, getPcts, onAdd, addingCards, sentimentMap, onVote }: CardGridViewProps) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-3">
      {cards.map((card, i) => {
        const price = getMarketPrice(card);
        const { raw24h } = getPcts(card);
        const pct = formatPct(raw24h);
        const sentiment = sentimentMap?.get(card.set.id);

        return (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: Math.min(i * 0.01, 0.3) }}
            className="group relative rounded-xl overflow-hidden bg-card border border-border/50 hover:border-primary/40 cursor-pointer transition-all hover:shadow-lg hover:shadow-primary/5"
            onClick={() => navigate(`/card/${card.id}`)}
          >
            <div className="aspect-[5/7] relative overflow-hidden bg-muted">
              <img
                src={card.images.small}
                alt={card.name}
                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                loading="lazy"
              />

              {price !== null && (
                <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-background/90 backdrop-blur-sm border border-border/50">
                  <span className="text-xs font-bold text-foreground tabular-nums">
                    {formatPrice(price)}
                  </span>
                </div>
              )}

              {raw24h !== null && (
                <div className={`absolute top-2 right-2 px-1.5 py-0.5 rounded-md backdrop-blur-sm text-[10px] font-semibold tabular-nums ${
                  raw24h > 0
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : raw24h < 0
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : "bg-muted/80 text-muted-foreground border border-border/50"
                }`}>
                  {pct.text}
                </div>
              )}

              {onAdd && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute top-2 left-2 h-7 w-7 rounded-full bg-background/80 backdrop-blur-sm border border-border/50 opacity-0 group-hover:opacity-100 transition-opacity hover:border-primary hover:text-primary"
                  disabled={addingCards?.has(card.id)}
                  onClick={(e) => { e.stopPropagation(); onAdd(e, card); }}
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            <div className="p-2">
              <p className="text-xs font-semibold text-foreground truncate">{card.name}</p>
              <div className="flex items-center justify-between gap-1">
                <p className="text-[10px] text-muted-foreground truncate">{card.set.name}</p>
                {sentiment && onVote && (
                  <SetSentimentBadge
                    upvotes={sentiment.upvotes}
                    downvotes={sentiment.downvotes}
                    score={sentiment.score}
                    currentUserVote={sentiment.currentUserVote}
                    onVote={(vt) => onVote(card.set.id, vt)}
                    compact
                  />
                )}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
