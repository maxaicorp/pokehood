import { useState } from "react";
import { CollectionCard, removeFromCollection, updateCardCondition, toggleForSale, updateCardQuantity } from "@/lib/collection-store";
import { formatPrice } from "@/lib/pokemon-api";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, DollarSign, Plus, Minus } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import CardImage from "@/components/CardImage";

const CONDITIONS = [
  { value: "NM", label: "Near Mint" },
  { value: "LP", label: "Lightly Played" },
  { value: "MP", label: "Moderately Played" },
  { value: "HP", label: "Heavily Played" },
  { value: "DMG", label: "Damaged" },
];

interface Props {
  cards: CollectionCard[];
  onUpdate: () => void;
}

export default function CollectionList({ cards, onUpdate }: Props) {
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  const handleRemove = async (card: CollectionCard) => {
    const success = await removeFromCollection(card.id);
    if (success) {
      toast.success(`${card.name} removed`);
      onUpdate();
    } else {
      toast.error("Failed to remove card.");
    }
  };

  const handleConditionChange = async (card: CollectionCard, condition: string) => {
    setUpdatingIds((prev) => new Set(prev).add(card.id));
    const success = await updateCardCondition(card.id, condition);
    if (success) {
      toast.success(`${card.name} condition → ${condition}`);
      onUpdate();
    } else {
      toast.error("Failed to update condition.");
    }
    setUpdatingIds((prev) => {
      const next = new Set(prev);
      next.delete(card.id);
      return next;
    });
  };

  const handleQuantityChange = async (card: CollectionCard, delta: number) => {
    const next = card.quantity + delta;
    if (next < 1) {
      // Decrementing below 1 removes the card entirely — matches the mental
      // model of "I no longer own any of these".
      await handleRemove(card);
      return;
    }
    setUpdatingIds((prev) => new Set(prev).add(card.id));
    const success = await updateCardQuantity(card.id, next);
    if (success) onUpdate();
    else toast.error("Failed to update quantity.");
    setUpdatingIds((prev) => {
      const n = new Set(prev);
      n.delete(card.id);
      return n;
    });
  };

  const handleToggleForSale = async (card: CollectionCard) => {
    const newForSale = !card.forSale;
    setUpdatingIds((prev) => new Set(prev).add(card.id));
    const success = await toggleForSale(card.id, newForSale, card.salePrice ?? undefined);
    if (success) {
      toast.success(newForSale ? `${card.name} listed for sale` : `${card.name} unlisted`);
      onUpdate();
    } else {
      toast.error("Failed to update sale status.");
    }
    setUpdatingIds((prev) => {
      const next = new Set(prev);
      next.delete(card.id);
      return next;
    });
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
          className="group relative bg-card border border-border/50 card-shine"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03 }}
          whileHover={{ y: -4 }}
        >
          {/* Card image with for-sale indicator */}
          <div className="relative">
            <CardImage src={card.imageSmall} alt={card.name} className="w-full" loading="lazy" />
            {card.quantity > 1 && (
              <span className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full">
                ×{card.quantity}
              </span>
            )}
          </div>

          <div className="p-3 space-y-2">
            <p className="text-xs font-semibold text-foreground truncate">{card.name}</p>
            <p className="text-xs text-muted-foreground truncate">{card.setName}</p>

            {/* Condition selector — cards only. Sealed products have no
                condition; show a "Sealed" badge in its place so the tile
                layout stays consistent. */}
            {card.productType === "sealed" ? (
              <div className="h-7 flex items-center justify-center rounded-md border border-border/60 bg-muted/40 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Sealed
              </div>
            ) : (
              <Select
                value={card.condition}
                onValueChange={(val) => handleConditionChange(card, val)}
                disabled={updatingIds.has(card.id)}
              >
                <SelectTrigger className="h-7 text-[10px] w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value} className="text-xs">
                      {c.value} — {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Quantity stepper. Decrementing to 0 removes the card. The ×N
                badge on the image and the collection total value both react
                to this immediately via onUpdate(). */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Qty</span>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => handleQuantityChange(card, -1)}
                  disabled={updatingIds.has(card.id)}
                  title={card.quantity <= 1 ? "Remove from collection" : "Decrease quantity"}
                >
                  <Minus className="w-3 h-3" />
                </Button>
                <span className="text-sm font-semibold tabular-nums w-6 text-center">{card.quantity}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => handleQuantityChange(card, 1)}
                  disabled={updatingIds.has(card.id)}
                  title="Increase quantity"
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              {/* Show per-card price × qty so the user sees the line-item total. */}
              <div className="flex flex-col">
                <span className="text-sm font-bold text-primary">
                  {formatPrice((card.manualPrice ?? card.marketPrice ?? 0) * card.quantity)}
                </span>
                {card.quantity > 1 && (
                  <span className="text-[10px] text-muted-foreground">
                    {formatPrice(card.manualPrice ?? card.marketPrice)} each
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {/* For-sale toggle */}
                <Button
                  size="icon"
                  variant={card.forSale ? "default" : "ghost"}
                  className={`h-7 w-7 transition-opacity ${
                    card.forSale
                      ? "bg-green-600 hover:bg-green-700 text-white opacity-100"
                      : "text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  }`}
                  onClick={() => handleToggleForSale(card)}
                  disabled={updatingIds.has(card.id)}
                  title={card.forSale ? "Remove from sale" : "Mark for sale"}
                >
                  <DollarSign className="w-3.5 h-3.5" />
                </Button>
                {/* Delete */}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-destructive"
                  onClick={() => handleRemove(card)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
