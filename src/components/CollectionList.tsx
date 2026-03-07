import { CollectionCard, removeFromCollection } from "@/lib/collection-store";
import { formatPrice } from "@/lib/pokemon-api";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

interface Props {
  cards: CollectionCard[];
  onUpdate: () => void;
}

export default function CollectionList({ cards, onUpdate }: Props) {
  const handleRemove = (card: CollectionCard) => {
    removeFromCollection(card.id);
    toast.success(`${card.name} removed`);
    onUpdate();
  };

  if (cards.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground text-lg">Your vault is empty</p>
        <p className="text-muted-foreground text-sm mt-1">Search for cards above to start building your collection</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {cards.map((card, i) => (
        <motion.div
          key={card.id}
          className="group relative rounded-xl bg-card border border-border/50 overflow-hidden card-shine"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03 }}
          whileHover={{ y: -4 }}
        >
          <div className="relative">
            <img src={card.imageSmall} alt={card.name} className="w-full" loading="lazy" />
            {card.quantity > 1 && (
              <span className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full">
                ×{card.quantity}
              </span>
            )}
          </div>
          <div className="p-3">
            <p className="text-xs font-semibold text-foreground truncate">{card.name}</p>
            <p className="text-xs text-muted-foreground truncate">{card.setName}</p>
            <div className="flex items-center justify-between mt-2">
              <span className="text-sm font-bold text-primary">
                {formatPrice(card.manualPrice ?? card.marketPrice)}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                onClick={() => handleRemove(card)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
