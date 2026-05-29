import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  getWishlists,
  createWishlist,
  deleteWishlist,
  renameWishlist,
  getWishlistCards,
  removeCardFromWishlist,
  Wishlist,
  WishlistCard,
} from "@/lib/wishlist-store";
import { formatPrice } from "@/lib/pokemon-api";
import { STRIPE_CONFIG } from "@/lib/stripe-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Heart, Plus, Trash2, Pencil, ChevronLeft, Crown, Loader2, X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

export default function WishlistDashboard() {
  const { user, isPro, limits } = useAuth();
  const queryClient = useQueryClient();
  const [selectedWishlistId, setSelectedWishlistId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");

  const { data: wishlists = [], isLoading } = useQuery({
    queryKey: ["wishlists", user?.id],
    queryFn: getWishlists,
    enabled: !!user,
  });

  const selectedWishlist = wishlists.find((w) => w.id === selectedWishlistId);

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ["wishlist-cards", selectedWishlistId],
    queryFn: () => getWishlistCards(selectedWishlistId!),
    enabled: !!selectedWishlistId,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["wishlists"] });
    queryClient.invalidateQueries({ queryKey: ["wishlist-cards"] });
  }, [queryClient]);

  const handleCreate = async () => {
    if (!user) return;
    if (!isPro && wishlists.length >= limits.maxWishlists) {
      toast.error(`Free tier allows ${limits.maxWishlists} wishlist. Upgrade to Pro for unlimited!`);
      return;
    }
    try {
      await createWishlist(user.id, newName.trim() || "My Wishlist");
      toast.success("Wishlist created!");
      setCreateOpen(false);
      setNewName("");
      refresh();
    } catch {
      toast.error("Failed to create wishlist.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWishlist(id);
      if (selectedWishlistId === id) setSelectedWishlistId(null);
      toast.success("Wishlist deleted.");
      refresh();
    } catch {
      toast.error("Failed to delete wishlist.");
    }
  };

  const handleRename = async () => {
    if (!renameId || !renameName.trim()) return;
    try {
      await renameWishlist(renameId, renameName.trim());
      toast.success("Wishlist renamed.");
      setRenameId(null);
      setRenameName("");
      refresh();
    } catch {
      toast.error("Failed to rename.");
    }
  };

  const handleRemoveCard = async (cardId: string) => {
    try {
      await removeCardFromWishlist(cardId);
      toast.success("Card removed from wishlist.");
      refresh();
    } catch {
      toast.error("Failed to remove card.");
    }
  };

  const handleUpgrade = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { priceId: STRIPE_CONFIG.pro.price_id },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch {
      toast.error("Failed to open checkout.");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Detail view
  if (selectedWishlist) {
    const totalValue = cards.reduce((s, c) => s + (c.marketPrice ?? 0), 0);
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedWishlistId(null)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-bold text-lg text-foreground truncate">{selectedWishlist.name}</h2>
            <p className="text-xs text-muted-foreground">{cards.length} cards · {formatPrice(totalValue)} est. value</p>
          </div>
        </div>

        {cardsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : cards.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <Heart className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="text-muted-foreground text-sm">No cards in this wishlist yet.</p>
            <p className="text-muted-foreground text-xs">Go to Explore and click the ♡ on any card to add it here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            <AnimatePresence mode="popLayout">
              {cards.map((card, i) => (
                <motion.div
                  key={card.id}
                  className="group rounded-xl bg-card border border-border/50 overflow-hidden"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: i * 0.02 }}
                >
                  <div className="relative bg-background/50 p-1.5">
                    <img src={card.imageSmall} alt={card.name} className="w-full" loading="lazy" />
                    <button
                      onClick={() => handleRemoveCard(card.id)}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full bg-destructive/90 text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="p-2 space-y-0.5">
                    <p className="text-xs font-semibold text-foreground truncate">{card.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{card.setName}</p>
                    {card.marketPrice && (
                      <p className="text-xs font-bold text-foreground">{formatPrice(card.marketPrice)}</p>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-lg text-foreground">Wishlists</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {wishlists.length} wishlist{wishlists.length !== 1 ? "s" : ""}
            {!isPro && ` · ${limits.maxWishlists} max on free tier`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!isPro && wishlists.length >= limits.maxWishlists) {
              toast.error(`Free tier allows ${limits.maxWishlists} wishlist. Upgrade to Pro!`);
              return;
            }
            setCreateOpen(true);
          }}
        >
          <Plus className="w-4 h-4 mr-1" /> New Wishlist
          {!isPro && wishlists.length >= limits.maxWishlists && <Crown className="w-3 h-3 ml-1 text-primary" />}
        </Button>
      </div>

      {wishlists.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <motion.div
            className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
          >
            <Heart className="w-8 h-8 text-primary" />
          </motion.div>
          <div className="space-y-1">
            <p className="font-display font-bold text-foreground">No wishlists yet</p>
            <p className="text-muted-foreground text-sm max-w-xs mx-auto">
              Create a wishlist and add cards from the Explore page to track what you want.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> Create Your First Wishlist
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {wishlists.map((wl, i) => (
            <motion.div
              key={wl.id}
              className="p-4 rounded-xl bg-card border border-border/50 cursor-pointer hover:border-primary/30 transition-colors group"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => setSelectedWishlistId(wl.id)}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Heart className="w-4 h-4 text-primary shrink-0" />
                    <p className="font-display font-bold text-foreground truncate">{wl.name}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Created {new Date(wl.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameId(wl.id);
                      setRenameName(wl.name);
                    }}
                    className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-muted"
                  >
                    <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(wl.id);
                    }}
                    className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-destructive/10"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm mx-4">
          <DialogHeader>
            <DialogTitle className="font-display">New Wishlist</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Wishlist name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameId} onOpenChange={() => setRenameId(null)}>
        <DialogContent className="max-w-sm mx-4">
          <DialogHeader>
            <DialogTitle className="font-display">Rename Wishlist</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="New name"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameId(null)}>Cancel</Button>
            <Button onClick={handleRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
