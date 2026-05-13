import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getCardById,
  getSetCards,
  getMarketPrice,
  enrichCardWithPricing,
  formatPrice,
} from "@/lib/pokemon-api";
import { addToCollection } from "@/lib/collection-store";
import { recordCardView, recordCollectionAdd, recordWishlistAdd } from "@/lib/card-stats-store";
import {
  getWishlists,
  createWishlist,
  addCardToWishlist,
  getAllWishlistCardIds,
} from "@/lib/wishlist-store";
import { getSetSentiment, castVote, type SetSentiment, type VoteType } from "@/lib/sentiment-store";
import CardSentimentWidget from "@/components/CardSentimentWidget";
import AppHeader from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronRight, ArrowLeft, ExternalLink, ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import PriceChart from "@/components/PriceChart";
import SEO from "@/components/SEO";

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CardDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const [addingToCollection, setAddingToCollection] = useState(false);
  const [sentiment, setSentiment] = useState<SetSentiment | null>(null);

  const { data: card, isLoading: cardLoading } = useQuery({
    queryKey: ["card-base", id],
    queryFn: () => getCardById(id!),
    enabled: !!id,
    staleTime: Infinity,
  });

  const { data: enrichedCard } = useQuery({
    queryKey: ["card-enriched", id],
    queryFn: () => enrichCardWithPricing(card!),
    enabled: !!card,
    staleTime: 5 * 60_000,
  });

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

  useEffect(() => {
    if (!card) return;
    getSetSentiment([card.id]).then((map) => {
      setSentiment(
        map.get(card.id) ?? { setId: card.id, upvotes: 0, downvotes: 0, score: 0, currentUserVote: null }
      );
    });
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

  const handleVote = async (voteType: VoteType) => {
    if (!user) {
      toast.info("Sign in to vote");
      navigate("/auth");
      return;
    }
    if (!card) return;
    const current = sentiment?.currentUserVote ?? null;
    const newVote = current === voteType ? null : voteType;
    // Optimistic update
    setSentiment((prev) => {
      const base = prev ?? { setId: card.id, upvotes: 0, downvotes: 0, score: 0, currentUserVote: null };
      const upvotes = Math.max(0, base.upvotes + (voteType === "up" ? (current === "up" ? -1 : 1) : (current === "up" ? -1 : 0)));
      const downvotes = Math.max(0, base.downvotes + (voteType === "down" ? (current === "down" ? -1 : 1) : (current === "down" ? -1 : 0)));
      return { ...base, upvotes, downvotes, score: upvotes - downvotes, currentUserVote: newVote };
    });
    await castVote(card.id, user.id, current, voteType);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <span className="w-6 h-6 animate-spin border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const handleAddToCollection = async () => {
    if (!enrichedCard) return;
    if (!user) { toast.info("Sign in to add to your collection"); navigate("/auth"); return; }
    setAddingToCollection(true);
    const result = await addToCollection(enrichedCard, user.id, "NM");
    if (result) {
      toast.success(`${enrichedCard.name} added to collection!`);
      recordCollectionAdd({ id: enrichedCard.id, name: enrichedCard.name, setName: enrichedCard.set.name, imageSmall: enrichedCard.images.small });
    } else {
      toast.error("Failed to add to collection.");
    }
    setAddingToCollection(false);
  };

  const handleWishlist = async () => {
    if (!enrichedCard) return;
    if (!user) { toast.info("Sign in to add to your wishlist"); navigate("/auth"); return; }
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
      const ok = await addCardToWishlist(target.id, user.id, enrichedCard);
      if (ok) {
        toast.success(`${enrichedCard.name} added to wishlist!`);
        recordWishlistAdd({ id: enrichedCard.id, name: enrichedCard.name, setName: enrichedCard.set.name, imageSmall: enrichedCard.images.small });
        queryClient.invalidateQueries({ queryKey: ["wishlisted-ids"] });
      } else {
        toast.info("Already in wishlist.");
      }
    } catch {
      toast.error("Failed to add to wishlist.");
    }
  };

  const isWishlisted = card ? wishlistedIds.has(card.id) : false;

  const marketPrice = enrichedCard ? getMarketPrice(enrichedCard) : null;
  const avgs = enrichedCard?.cardmarketAvgs;
  const trend = avgs?.trend ?? null;
  const pct24h = trend != null && avgs?.avg1 != null && avgs.avg1 !== 0
    ? ((trend - avgs.avg1) / avgs.avg1) * 100
    : null;

  const suggestions = (setCardsResult?.data || [])
    .filter((c) => c.id !== id)
    .slice(0, 10);

  const buyQuery = card ? encodeURIComponent(`${card.name} ${card.set.name} pokemon card`) : "";
  const buyLinks = [
    {
      label: "TCGPlayer",
      url: `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(card?.name || "")}`,
    },
    {
      label: "eBay",
      url: `https://www.ebay.com/sch/i.html?_nkw=${buyQuery}&_sacat=0`,
    },
    {
      label: "Amazon",
      url: `https://www.amazon.com/s?k=${buyQuery}`,
    },
  ];

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      {card && (
        <SEO
          title={`${card.name} · ${card.set.name} — Collectiblez`}
          description={`Live market price, 24h/7d trends, and price history for ${card.name} from ${card.set.name}.`}
          path={`/card/${card.id}`}
          image={card.images?.large || card.images?.small}
          type="product"
          jsonLd={{
            "@context": "https://schema.org",
            "@type": "Product",
            name: card.name,
            image: card.images?.large || card.images?.small,
            description: `${card.name} from ${card.set.name}.`,
            category: "Trading Card",
            ...(getMarketPrice(card) != null && {
              offers: {
                "@type": "Offer",
                price: getMarketPrice(card),
                priceCurrency: "USD",
                availability: "https://schema.org/InStock",
                url: `https://collectiblez.app/card/${card.id}`,
              },
            }),
          }}
        />
      )}
      <AppHeader activePage="explore" />

      <div className="container py-6 px-4 sm:px-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6 flex-wrap">
          <button onClick={() => navigate(-1)} className="hover:text-foreground transition-colors flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
          {card && (
            <>
              <ChevronRight className="w-3.5 h-3.5" />
              <span>{card.set.name}</span>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="text-foreground font-medium">{card.name}</span>
            </>
          )}
        </nav>

        {/* ── 3-column hero ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_280px] gap-6 items-start">

          {/* Col 1 — Card image */}
          <div className="flex items-start justify-center lg:justify-start">
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

          {/* Col 2 — Info + chart */}
          <div className="flex flex-col gap-4 min-w-0">
            {/* Name + meta */}
            {cardLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
            ) : card ? (
              <div>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
                    {card.name}
                  </h1>
                  {card.rarity && (
                    <Badge variant="secondary" className="shrink-0 text-xs mt-1">
                      {card.rarity}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground flex-wrap">
                  <span>{card.set.name}</span>
                  <span>·</span>
                  <span>#{card.number}/{card.set.printedTotal || card.set.total}</span>
                  <span>·</span>
                  <span>{card.set.releaseDate}</span>
                </div>
                {(card.types?.length || card.hp) && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {card.types?.map((t) => (
                      <span key={t} className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[t] || "bg-muted text-muted-foreground border border-border"}`}>
                        {t}
                      </span>
                    ))}
                    {card.hp && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                        HP {card.hp}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">Card not found.</p>
            )}

            {/* Price — mobile only (shown between card meta and chart) */}
            {marketPrice !== null && (
              <div className="lg:hidden">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-3xl font-bold text-foreground tabular-nums">
                    {formatPrice(marketPrice)}
                  </span>
                  {pct24h !== null && (
                    <span className={`flex items-center gap-1 text-sm font-semibold ${pct24h >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {pct24h >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {pct24h >= 0 ? "+" : ""}{pct24h.toFixed(2)}% (24h)
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Price chart */}
            <div className="rounded-xl border border-border bg-card p-4 sm:p-5 flex-1">
              <PriceChart
                cardId={id!}
                currentPrice={enrichedCard ? getMarketPrice(enrichedCard) : null}
                cardmarketAvgs={enrichedCard?.cardmarketAvgs}
              />
            </div>
          </div>

          {/* Col 3 — Price + Actions */}
          <div className="flex flex-col gap-3">
            {/* Price display — desktop only (mobile version lives in Col 2) */}
            <div className="hidden lg:block">
              {marketPrice !== null ? (
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-3xl font-bold text-foreground tabular-nums">
                    {formatPrice(marketPrice)}
                  </span>
                  {pct24h !== null && (
                    <span className={`flex items-center gap-1 text-sm font-semibold ${pct24h >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {pct24h >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {pct24h >= 0 ? "+" : ""}{pct24h.toFixed(2)}% (24h)
                    </span>
                  )}
                </div>
              ) : null}
            </div>

            <div className="hidden lg:block w-full h-px bg-border" />

            {/* Buy Now dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="w-full h-12 text-base" size="lg">
                  Buy Now
                  <ChevronDown className="w-4 h-4 ml-2 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                {buyLinks.map((link) => (
                  <DropdownMenuItem key={link.label} asChild>
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between">
                      {link.label}
                      <ExternalLink className="w-3.5 h-3.5 opacity-50" />
                    </a>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Add to collection */}
            <Button
              onClick={handleAddToCollection}
              disabled={addingToCollection}
              variant="outline"
              className="w-full h-12 text-base"
            >
              Add to Collection
            </Button>

            {/* Wishlist */}
            <Button
              variant="outline"
              onClick={handleWishlist}
              className={`w-full h-12 text-base ${isWishlisted ? "text-destructive border-destructive/50" : ""}`}
            >
              {isWishlisted ? "Wishlisted" : "Wishlist"}
            </Button>

            {/* Sentiment */}
            <CardSentimentWidget sentiment={sentiment} onVote={handleVote} />
          </div>
        </div>

        {/* ── More from this set ── */}
        {suggestions.length > 0 && (
          <div className="mt-10">
            <h3 className="font-display font-semibold text-foreground mb-4">
              More from {card?.set.name}
            </h3>
            <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
              {suggestions.map((c) => (
                <Link key={c.id} to={`/card/${c.id}`} className="shrink-0 group">
                  <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.15 }}>
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
