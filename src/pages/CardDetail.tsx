import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { tcgAffiliateLink } from "@/lib/affiliate";
import {
  getCardById,
  getMarketSets,
  getSetCards,
  getMarketPrice,
  enrichCardWithPricing,
  formatPrice,
} from "@/lib/pokemon-api";
import { findSetBySlug, cardSlug, cardPath, setPath } from "@/lib/slug";
import { addToCollection } from "@/lib/collection-store";
import { recordCardView, recordCollectionAdd, recordWishlistAdd } from "@/lib/card-stats-store";
import {
  getWishlists,
  createWishlist,
  addCardToWishlist,
  getAllWishlistCardIds,
} from "@/lib/wishlist-store";
import { getSetSentiment, castVote, applyVote, type SetSentiment, type VoteType } from "@/lib/sentiment-store";
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
import GradedPriceTiles from "@/components/GradedPriceTiles";
import SEO from "@/components/SEO";
import CardImage from "@/components/CardImage";
import ErrorBoundary from "@/components/ErrorBoundary";
import ShareCardButton from "@/components/ShareCardButton";
import CollectorCryptPromoItem from "@/components/CollectorCryptPromoItem";
import { toastAddedToInventory } from "@/lib/inventory-toast";

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
  // Two route shapes resolve to the same page:
  //   /card/:id                          (legacy, kept for back-compat + share links)
  //   /sets/:slug/:cardSlug              (new, SEO-friendly canonical)
  // Below resolves either shape into a single `id` so the rest of this file
  // is unchanged. Slug-based routes incur ONE extra query (the set's card
  // list) to translate cardSlug -> card.id.
  const params = useParams<{ id?: string; slug?: string; cardSlug?: string }>();
  const navigate = useNavigate();

  const { data: setsResult } = useQuery({
    // Lightweight set list (84KB) — only needed to resolve a /sets/:slug URL
    // to a set; virtual vintage sets aren't slug-routed so getMarketSets is enough.
    queryKey: ["market-sets"],
    queryFn: getMarketSets,
    staleTime: Infinity,
  });
  const setFromSlug = useMemo(() => {
    if (!params.slug || !setsResult?.data) return undefined;
    return findSetBySlug(params.slug, setsResult.data);
  }, [params.slug, setsResult]);

  const { data: setCardsForResolve } = useQuery({
    queryKey: ["card-slug-resolve", setFromSlug?.id],
    queryFn: () => getSetCards(setFromSlug!.id, 1, 500),
    enabled: !!params.cardSlug && !!setFromSlug,
    staleTime: Infinity,
  });

  const id = useMemo<string | undefined>(() => {
    if (params.id) return params.id;
    if (!params.cardSlug) return undefined;
    // Exact match from the set's card list (the happy path).
    const matched = setCardsForResolve?.data?.find(
      (c) => cardSlug({ name: c.name, number: c.number }) === params.cardSlug,
    )?.id;
    if (matched) return matched;
    // Fallback: vintage/older sets have no catalog card-list yet, so the lookup
    // above comes back empty and the page used to 404 even though the card is
    // priced in the DB. Reconstruct the Scrydex id from the set id + the
    // trailing number of the slug (cardSlug = kebab(name)-localId). getCardById
    // then builds it from latest_card_prices instead of showing "Card not found".
    if (setFromSlug) {
      const localId = params.cardSlug.slice(params.cardSlug.lastIndexOf("-") + 1);
      if (localId) return `${setFromSlug.id}-${localId}`;
    }
    return undefined;
  }, [params.id, params.cardSlug, setCardsForResolve, setFromSlug]);
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

  // Legacy URL migration. Users arriving via /card/:id (old shareable links,
  // Google's cached pages, our own GlobalSearch fallback) get bounced to the
  // canonical /sets/:slug/:cardSlug URL once the card loads. `replace: true`
  // means the back button doesn't strand them on the legacy URL.
  useEffect(() => {
    if (!card || !params.id) return;          // only when we arrived via /card/:id
    if (card.id.includes("::")) return;        // skip virtual variants (shadowless, etc.) — they have no slug route yet
    const canonical = cardPath(card.set, { name: card.name, number: card.number });
    if (canonical) navigate(canonical, { replace: true });
  }, [card?.id, params.id, navigate]);

  useEffect(() => {
    if (!card) return;
    getSetSentiment([card.id]).then((map) => {
      setSentiment(
        map.get(card.id) ?? { setId: card.id, upvotes: 0, downvotes: 0, score: 0, currentUserVote: null }
      );
    });
  }, [card?.id]);

  // Bump from 20 → 500 cards so the smart-suggestions filter below has a real
  // pool to work with. The set cards come from the static index already in
  // memory (loadCardIndex), so going wider doesn't cost a real fetch.
  const { data: setCardsResult } = useQuery({
    queryKey: ["set-cards-suggestions", card?.set.id],
    queryFn: () => getSetCards(card!.set.id, 1, 500),
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
    // Optimistic update via the shared helper (single source of vote math).
    setSentiment((prev) =>
      applyVote(prev ?? { setId: card.id, upvotes: 0, downvotes: 0, score: 0, currentUserVote: null }, voteType),
    );
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
      toastAddedToInventory(enrichedCard.name, navigate);
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

  // ─── Smart "More from this set" recommendations ──────────────────────────
  // Previous behavior was "first 10 cards in API order" — meant viewing a
  // $1400 chase card recommended ten $0.10 commons. Now: pick same-rarity
  // cards first (most relevant: "you're looking at a Special Illustration
  // Rare, here are the other SIRs from this set"), sorted by price desc.
  // Pad with top-priced from the set if same-rarity has < 6 candidates.
  const { suggestions, suggestionsHeading } = (() => {
    const all = (setCardsResult?.data || []).filter((c) => c.id !== id);
    const fallbackHeading = `More from ${card?.set.name ?? "this set"}`;
    if (!card?.rarity) {
      const sorted = [...all].sort(
        (a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0),
      );
      return { suggestions: sorted.slice(0, 10), suggestionsHeading: fallbackHeading };
    }
    const sameRarity = [...all]
      .filter((c) => c.rarity === card.rarity)
      .sort((a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0));
    if (sameRarity.length >= 6) {
      return {
        suggestions: sameRarity.slice(0, 10),
        suggestionsHeading: `More ${card.rarity} from ${card.set.name}`,
      };
    }
    // Fewer than 6 same-rarity — pad with top-priced from the rest of the
    // set so the rail stays full instead of looking sparse.
    const sameRarityIds = new Set(sameRarity.map((c) => c.id));
    const others = all
      .filter((c) => !sameRarityIds.has(c.id))
      .sort((a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0));
    return {
      suggestions: [...sameRarity, ...others].slice(0, 10),
      suggestionsHeading: fallbackHeading,
    };
  })();

  // Buy searches: strip the "(Unlimited Holo)" variant parenthetical from both
  // name and set. Selling sites list cards as "<Pokémon> <Set>" and the variant
  // is redundant (the set name already carries it), so e.g. we search
  // "Articuno Fossil pokemon card" not "Articuno (Unlimited Holo) Fossil ...".
  const stripVariant = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const buyName = card ? stripVariant(card.name) : "";
  const buySet = card ? stripVariant(card.set.name) : "";
  const buyQuery = card ? encodeURIComponent(`${buyName} ${buySet} pokemon card`) : "";
  const buyLinks = [
    {
      label: "TCGPlayer",
      url: tcgAffiliateLink(`https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(`${buyName} ${buySet}`.trim())}`),
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
          // Canonical points to the slug-based URL regardless of which route
          // the user landed on. /card/:id requests will have their
          // <link rel="canonical"> point to /sets/:slug/:cardSlug so Google
          // collapses duplicates onto the SEO-friendly URL.
          title={`${card.name} — ${card.set.name} | Price & Price History | Collectiblez`}
          description={`${card.name} ${card.number}/${card.set.printedTotal || card.set.total} from ${card.set.name}. Live market price, 24h/7d trends, and price history. Updated daily.`}
          path={cardPath(card.set, { name: card.name, number: card.number })}
          image={card.images?.large || card.images?.small}
          type="product"
          jsonLd={[
            {
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Sets", item: "https://collectiblez.app/sets" },
                { "@type": "ListItem", position: 2, name: card.set.name, item: `https://collectiblez.app${setPath(card.set)}` },
                { "@type": "ListItem", position: 3, name: card.name, item: `https://collectiblez.app${cardPath(card.set, { name: card.name, number: card.number })}` },
              ],
            },
            {
              "@context": "https://schema.org",
              "@type": "Product",
              name: card.name,
              sku: card.number,
              image: card.images?.large || card.images?.small,
              description: `${card.name} ${card.number}/${card.set.printedTotal || card.set.total} from ${card.set.name}.`,
              brand: { "@type": "Brand", name: "Pokémon" },
              category: "Trading Card",
              ...(getMarketPrice(card) != null && {
                offers: {
                  "@type": "Offer",
                  price: getMarketPrice(card)?.toFixed(2),
                  priceCurrency: "USD",
                  availability: "https://schema.org/InStock",
                  url: `https://collectiblez.app${cardPath(card.set, { name: card.name, number: card.number })}`,
                },
              }),
            },
          ]}
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
              <Skeleton className="aspect-[2.5/3.5] w-full max-w-[320px]" />
            ) : card ? (
              <motion.img
                src={card.images.large}
                alt={card.name}
                className="w-full max-w-[320px] shadow-2xl"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                onError={(e) => {
                  // Fall back to the small image if the large one 404s, then to
                  // a neutral placeholder so the hero never shows a broken glyph.
                  const img = e.currentTarget as HTMLImageElement;
                  if (img.src !== card.images.small && card.images.small) img.src = card.images.small;
                  else img.style.visibility = "hidden";
                }}
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
                  <div className="flex items-center gap-2 shrink-0 mt-1">
                    {card.rarity && (
                      <Badge variant="secondary" className="text-xs">
                        {card.rarity}
                      </Badge>
                    )}
                    <ShareCardButton
                      card={card}
                      price={marketPrice}
                      pct24h={pct24h}
                      shareUrl={`https://collectiblez.app${cardPath(card.set, { name: card.name, number: card.number })}`}
                    />
                  </div>
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

            {/* Price chart — scoped boundary so a bad data point in recharts
                can't take down the whole card page. */}
            <div className="rounded-xl border border-border bg-card p-4 sm:p-5 flex-1">
              <ErrorBoundary label="PriceChart" fallback="Price history unavailable.">
                <PriceChart
                  cardId={id!}
                  currentPrice={enrichedCard ? getMarketPrice(enrichedCard) : null}
                  cardmarketAvgs={enrichedCard?.cardmarketAvgs}
                />
              </ErrorBoundary>
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

            {/* Graded tiles — MOBILE ONLY here (right under the price). Desktop
                keeps them at the bottom of the page (see below). */}
            {id && <div className="lg:hidden"><GradedPriceTiles cardId={id} /></div>}

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
                <CollectorCryptPromoItem />
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

        {/* Graded tiles — DESKTOP position (bottom of page). Mobile shows them
            up under the price instead. */}
        {id && <div className="hidden lg:block"><GradedPriceTiles cardId={id} /></div>}

        {/* ── More from this set ── */}
        {/* Was a horizontal scroll strip with tiny w-28 thumbs; user wanted
            the cards to scale up and fill the container width like every
            other section on the page. Switched to a responsive grid that
            wraps — mobile 3-per-row, sm 4, md 5 — so the 10 suggestions
            land in 2-3 clean rows instead of overflowing to the right. */}
        {suggestions.length > 0 && (
          <div className="mt-10">
            <h3 className="font-display font-semibold text-foreground mb-4">
              {suggestionsHeading}
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 sm:gap-4">
              {suggestions.map((c) => (
                <Link key={c.id} to={cardPath(c.set, { name: c.name, number: c.number })} className="group">
                  <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.15 }}>
                    <CardImage
                      src={c.images.small}
                      alt={c.name}
                      className="w-full shadow-md group-hover:shadow-lg transition-shadow"
                      loading="lazy"
                    />
                    <p className="text-xs text-muted-foreground mt-1.5 text-center truncate">
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
