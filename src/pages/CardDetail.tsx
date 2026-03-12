import { useParams, Link, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getCardById,
  fetchCardDetail,
  getSetCards,
  getMarketPrice,
  enrichCardWithPricing,
  formatPrice,
  CONDITIONS,
  CardDetailFull,
} from "@/lib/pokemon-api";
import { addToCollection } from "@/lib/collection-store";
import { recordCardView, recordCollectionAdd, recordWishlistAdd } from "@/lib/card-stats-store";
import {
  getWishlists,
  createWishlist,
  addCardToWishlist,
  getAllWishlistCardIds,
} from "@/lib/wishlist-store";
import AppHeader from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronRight, Heart, Plus, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import PriceChart from "@/components/PriceChart";

// ─── Type styling ─────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  Fire: "bg-orange-500/15 text-orange-400 border border-orange-500/30",
  Water: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
  Grass: "bg-green-500/15 text-green-400 border border-green-500/30",
  Lightning: "bg-yellow-400/15 text-yellow-400 border border-yellow-400/30",
  Psychic: "bg-purple-500/15 text-purple-400 border border-purple-500/30",
  Fighting: "bg-amber-700/15 text-amber-600 border border-amber-700/30",
  Darkness: "bg-slate-700/15 text-slate-400 border border-slate-600/30",
  Metal: "bg-slate-400/15 text-slate-400 border border-slate-400/30",
  Dragon: "bg-indigo-500/15 text-indigo-400 border border-indigo-500/30",
  Fairy: "bg-pink-400/15 text-pink-400 border border-pink-400/30",
  Colorless: "bg-gray-400/15 text-gray-400 border border-gray-400/30",
};

const ENERGY_COLORS: Record<string, string> = {
  Fire: "bg-orange-500",
  Water: "bg-blue-500",
  Grass: "bg-green-500",
  Lightning: "bg-yellow-400",
  Psychic: "bg-purple-500",
  Fighting: "bg-amber-700",
  Darkness: "bg-slate-700",
  Metal: "bg-slate-400",
  Dragon: "bg-indigo-500",
  Fairy: "bg-pink-400",
  Colorless: "bg-gray-400",
  Free: "bg-gray-400",
};

const VARIANT_LABELS: Record<string, string> = {
  normal: "Normal",
  holofoil: "Holofoil",
  reverseHolofoil: "Reverse Holo",
  firstEdition: "1st Edition",
};

function EnergyCost({ type }: { type: string }) {
  const color = ENERGY_COLORS[type] || "bg-gray-400";
  return (
    <span
      title={type}
      className={`w-4 h-4 rounded-full ${color} inline-flex items-center justify-center text-[8px] font-bold text-white shrink-0`}
    >
      {type[0]}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CardDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const [condition, setCondition] = useState("NM");
  const [addingToCollection, setAddingToCollection] = useState(false);

  const { data: card, isLoading: cardLoading } = useQuery({
    queryKey: ["card-base", id],
    queryFn: () => getCardById(id!),
    enabled: !!id,
    staleTime: Infinity,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["card-detail", id],
    queryFn: () => fetchCardDetail(id!),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });

  // Enrich with pricing + cardmarket averages (for chart)
  const { data: enrichedCard } = useQuery({
    queryKey: ["card-enriched", id],
    queryFn: () => enrichCardWithPricing(card!),
    enabled: !!card,
    staleTime: 5 * 60_000,
  });

  // Track card view (fire-and-forget)
  useEffect(() => {
    if (card) {
      recordCardView({
        id: card.id,
        name: card.name,
        setName: card.set.name,
        imageSmall: card.images.small,
      });
    }
  }, [card?.id]);

  const { data: setCardsResult } = useQuery({
    queryKey: ["set-cards-suggestions", card?.set.id],
    queryFn: () => getSetCards(card!.set.id, 1, 20),
    enabled: !!card?.set.id,
    staleTime: Infinity,
  });

  const { data: wishlists = [] } = useQuery({
    queryKey: ["wishlists", user?.id],
    queryFn: getWishlists,
    enabled: !!user,
  });

  const { data: wishlistedIds = new Set<string>() } = useQuery({
    queryKey: ["wishlisted-ids", user?.id],
    queryFn: () => getAllWishlistCardIds(user!.id),
    enabled: !!user,
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <span className="w-6 h-6 animate-spin border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;

  const handleAddToCollection = async () => {
    if (!card || !user) return;
    setAddingToCollection(true);
    const result = await addToCollection(card, user.id, condition);
    if (result) {
      toast.success(`${card.name} added to collection!`);
      recordCollectionAdd({ id: card.id, name: card.name, setName: card.set.name, imageSmall: card.images.small });
    } else {
      toast.error("Failed to add to collection.");
    }
    setAddingToCollection(false);
  };

  const handleWishlist = async () => {
    if (!card || !user) return;
    let target = wishlists[0];
    if (!target) {
      try {
        target = await createWishlist(user.id, "My Wishlist");
        queryClient.invalidateQueries({ queryKey: ["wishlists"] });
      } catch {
        toast.error("Failed to create wishlist.");
        return;
      }
    }
    try {
      const ok = await addCardToWishlist(target.id, user.id, card);
      if (ok) {
        toast.success(`${card.name} added to wishlist!`);
        recordWishlistAdd({ id: card.id, name: card.name, setName: card.set.name, imageSmall: card.images.small });
        queryClient.invalidateQueries({ queryKey: ["wishlisted-ids"] });
      } else {
        toast.info("Already in wishlist.");
      }
    } catch {
      toast.error("Failed to add to wishlist.");
    }
  };

  const isWishlisted = card ? wishlistedIds.has(card.id) : false;

  const pricingRows = detail?.pricing?.tcgplayer
    ? Object.entries(detail.pricing.tcgplayer).filter(
        ([, v]) => v?.marketPrice || v?.lowPrice
      )
    : [];

  const suggestions = (setCardsResult?.data || [])
    .filter((c) => c.id !== id)
    .slice(0, 10);

  return (
    <div className="min-h-screen bg-background pb-16 sm:pb-0">
      <AppHeader activePage="explore" />

      <div className="container py-6 px-4 sm:px-8 max-w-6xl">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6 flex-wrap">
          <Link
            to="/explore"
            className="hover:text-foreground transition-colors flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Explore
          </Link>
          {card && (
            <>
              <ChevronRight className="w-3.5 h-3.5" />
              <span>{card.set.name}</span>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="text-foreground font-medium">{card.name}</span>
            </>
          )}
        </nav>

        {/* Hero row — card image + compact info side-by-side */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-8">
          {/* Card image */}
          <div className="flex items-start justify-center">
            {cardLoading ? (
              <Skeleton className="aspect-[2.5/3.5] w-full max-w-[320px] rounded-2xl" />
            ) : card ? (
              <motion.img
                src={card.images.large}
                alt={card.name}
                className="w-full max-w-[320px] rounded-2xl shadow-2xl"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              />
            ) : null}
          </div>

          {/* Core info — compact to fit beside card */}
          <div className="flex flex-col gap-3">
            {/* Name + meta */}
            <div>
              {cardLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="h-4 w-48" />
                </div>
              ) : card ? (
                <>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
                      {card.name}
                      {detail?.suffix && (
                        <span className="text-primary ml-2 text-xl">
                          {detail.suffix}
                        </span>
                      )}
                    </h1>
                    {(card.rarity || detail?.rarity) && (
                      <Badge variant="secondary" className="shrink-0 text-xs mt-1">
                        {card.rarity || detail?.rarity}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground flex-wrap">
                    <span>{card.set.name}</span>
                    <span>·</span>
                    <span>
                      #{card.number}/
                      {card.set.printedTotal || card.set.total}
                    </span>
                    <span>·</span>
                    <span>{card.set.releaseDate}</span>
                  </div>

                  {/* Type / HP / Stage pills */}
                  {(detail?.types?.length || detail?.hp || detail?.stage) && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {detail?.types?.map((t) => (
                        <span
                          key={t}
                          className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            TYPE_COLORS[t] ||
                            "bg-muted text-muted-foreground border border-border"
                          }`}
                        >
                          {t}
                        </span>
                      ))}
                      {detail?.hp && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                          HP {detail.hp}
                        </span>
                      )}
                      {detail?.stage && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
                          {detail.stage}
                        </span>
                      )}
                    </div>
                  )}

                  {detail?.illustrator && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Illus.{" "}
                      <span className="text-foreground/70">
                        {detail.illustrator}
                      </span>
                      {detail.regulationMark && (
                        <span className="ml-3 font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">
                          {detail.regulationMark}
                        </span>
                      )}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">Card not found.</p>
              )}
            </div>

            {/* Pricing table */}
            <div className="rounded-xl border border-border bg-card p-4 flex-1 min-h-0">
              <h3 className="font-display font-semibold text-foreground mb-2 text-sm">
                Pricing
              </h3>
              {detailLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-7 w-full" />
                  ))}
                </div>
              ) : pricingRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground text-xs border-b border-border">
                        <th className="text-left pb-1.5 font-medium">Variant</th>
                        <th className="text-right pb-1.5 font-medium">Low</th>
                        <th className="text-right pb-1.5 font-medium">Market</th>
                        <th className="text-right pb-1.5 font-medium">High</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pricingRows.map(([variant, v]) => (
                        <tr
                          key={variant}
                          className="border-b border-border/50 last:border-0"
                        >
                          <td className="py-2 text-muted-foreground text-xs">
                            {VARIANT_LABELS[variant] || variant}
                          </td>
                          <td className="py-2 text-right text-xs">
                            {v?.lowPrice ? formatPrice(v.lowPrice) : "—"}
                          </td>
                          <td className="py-2 text-right font-semibold text-foreground">
                            {v?.marketPrice
                              ? formatPrice(v.marketPrice)
                              : v?.midPrice
                              ? formatPrice(v.midPrice)
                              : "—"}
                          </td>
                          <td className="py-2 text-right text-xs">
                            {v?.highPrice ? formatPrice(v.highPrice) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No pricing data available.
                </p>
              )}
            </div>

            {/* Actions + Format legality */}
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger className="w-[100px] h-9 text-sm bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleAddToCollection}
                disabled={addingToCollection}
                className="flex-1 sm:flex-none"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Add to Collection
              </Button>
              <Button
                variant="outline"
                onClick={handleWishlist}
                className={
                  isWishlisted ? "text-destructive border-destructive/50" : ""
                }
              >
                <Heart
                  className={`w-4 h-4 mr-1.5 ${
                    isWishlisted ? "fill-current" : ""
                  }`}
                />
                {isWishlisted ? "Wishlisted" : "Wishlist"}
              </Button>

              {/* Inline format legality pills */}
              {detail?.legal && (
                <>
                  <span className="hidden sm:block w-px h-6 bg-border mx-1" />
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${
                      detail.legal.standard
                        ? "bg-green-500/10 text-green-400 border border-green-500/20"
                        : "bg-muted text-muted-foreground border border-border line-through"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        detail.legal.standard
                          ? "bg-green-400"
                          : "bg-muted-foreground"
                      }`}
                    />
                    Standard
                  </div>
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${
                      detail.legal.expanded
                        ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                        : "bg-muted text-muted-foreground border border-border line-through"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        detail.legal.expanded
                          ? "bg-blue-400"
                          : "bg-muted-foreground"
                      }`}
                    />
                    Expanded
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Price Chart — full width below hero */}
        <div className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
          <PriceChart
            cardId={id!}
            currentPrice={enrichedCard ? getMarketPrice(enrichedCard) : null}
            cardmarketAvgs={enrichedCard?.cardmarketAvgs}
          />
        </div>

        {/* Game data — full-width 2-col grid */}
        {(detail?.attacks?.length ||
          detail?.abilities?.length ||
          detail?.weaknesses?.length ||
          detail?.retreat !== undefined) && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Attacks */}
            {detail?.attacks && detail.attacks.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <h3 className="font-display font-semibold text-foreground mb-4">
                  Attacks
                </h3>
                <div className="space-y-4">
                  {detail.attacks.map((attack, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-0.5">
                          {attack.cost?.map((c, j) => (
                            <EnergyCost key={j} type={c} />
                          ))}
                        </div>
                        <span className="font-semibold text-foreground text-sm flex-1">
                          {attack.name}
                        </span>
                        {attack.damage && (
                          <span className="font-bold text-foreground tabular-nums">
                            {attack.damage}
                          </span>
                        )}
                      </div>
                      {attack.effect && (
                        <p className="text-xs text-muted-foreground leading-relaxed pl-1">
                          {attack.effect}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Abilities */}
            {detail?.abilities && detail.abilities.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <h3 className="font-display font-semibold text-foreground mb-4">
                  Abilities
                </h3>
                <div className="space-y-3">
                  {detail.abilities.map((ability, i) => (
                    <div key={i}>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {ability.type}
                        </Badge>
                        <span className="font-semibold text-sm text-foreground">
                          {ability.name}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {ability.effect}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Battle stats */}
            {(detail?.weaknesses?.length ||
              detail?.resistances?.length ||
              detail?.retreat !== undefined) && (
              <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <h3 className="font-display font-semibold text-foreground mb-4">
                  Battle Stats
                </h3>
                {detail?.weaknesses && detail.weaknesses.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-muted-foreground mb-1.5">
                      Weakness
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {detail.weaknesses.map((w, i) => (
                        <span
                          key={i}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                            TYPE_COLORS[w.type] ||
                            "bg-muted text-muted-foreground border border-border"
                          }`}
                        >
                          {w.type} {w.value}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {detail?.resistances && detail.resistances.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-muted-foreground mb-1.5">
                      Resistance
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {detail.resistances.map((r, i) => (
                        <span
                          key={i}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                            TYPE_COLORS[r.type] ||
                            "bg-muted text-muted-foreground border border-border"
                          }`}
                        >
                          {r.type} {r.value}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {detail?.retreat !== undefined && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">
                      Retreat Cost
                    </p>
                    {detail.retreat === 0 ? (
                      <span className="text-xs text-green-400">Free</span>
                    ) : (
                      <div className="flex gap-0.5">
                        {Array.from({ length: detail.retreat }).map((_, i) => (
                          <span
                            key={i}
                            className="w-4 h-4 rounded-full bg-gray-400 inline-block"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* More from this set */}
        {suggestions.length > 0 && (
          <div className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold text-foreground">
                More from {card?.set.name}
              </h3>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
              {suggestions.map((c) => (
                <Link key={c.id} to={`/card/${c.id}`} className="shrink-0 group">
                  <motion.div
                    whileHover={{ y: -4 }}
                    transition={{ duration: 0.15 }}
                  >
                    <img
                      src={c.images.small}
                      alt={c.name}
                      className="w-24 sm:w-28 rounded-lg shadow-md group-hover:shadow-lg transition-shadow"
                      loading="lazy"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1 text-center truncate w-24 sm:w-28">
                      {c.name}
                    </p>
                  </motion.div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
