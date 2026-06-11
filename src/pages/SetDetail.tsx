// SetDetail — public landing page for a single TCG expansion.
//
// URL: /sets/:slug   e.g. /sets/ascended-heroes
//
// SEO-critical: when someone Googles "ascended heroes card list" or
// "prismatic evolutions prices", we want THIS page to rank. The card
// list IS the page — not a tab on Explore. Comes with JSON-LD ItemList
// of every card as a Product/Offer.
//
// Layout intentionally mirrors Explore's set-mode view (grid OR list,
// sort dropdown, filter row at top, no sidebar). Same data-fetching
// pattern: getSetCards paginated + enrichPageWithPricing for prices.

import { useMemo, useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  getMarketSets,
  getSetCards,
  getMarketPrice,
  formatPrice,
  enrichPageWithPricing,
  type PokemonCard,
  type PokemonSet,
} from "@/lib/pokemon-api";
import { findSetBySlug, cardPath, setSlug } from "@/lib/slug";
import { getCollection, addToCollection } from "@/lib/collection-store";
import { getAllWishlistCardIds, toggleCardInDefaultWishlist } from "@/lib/wishlist-store";
import RowActions from "@/components/RowActions";
import { buyQueryForCard } from "@/lib/pokemon-api";
import { recordCollectionAdd, recordWishlistAdd } from "@/lib/card-stats-store";
import { toastAddedToInventory } from "@/lib/inventory-toast";
import { getSetSentiment, castVote, applyVote, type SetSentiment, type VoteType } from "@/lib/sentiment-store";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import SetSentimentBadge from "@/components/SetSentimentBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Calendar, Layers, Grid3X3, LayoutList, Plus } from "lucide-react";
import { toast } from "sonner";
import AppHeader from "@/components/AppHeader";
import SEO from "@/components/SEO";

const BASE = "https://collectiblez.app";

type SortKey = "number-asc" | "number-desc" | "price-desc" | "price-asc";
const SORTS: { value: SortKey; label: string }[] = [
  { value: "number-asc",  label: "Card Number: Low → High" },
  { value: "number-desc", label: "Card Number: High → Low" },
  { value: "price-desc",  label: "Price: High → Low" },
  { value: "price-asc",   label: "Price: Low → High" },
];

export default function SetDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  // Default to highest card number first — the chase cards (SIRs / secret rares)
  // live at the top of the numbering, which is what people open a set to see.
  const [sortKey, setSortKey] = useState<SortKey>("number-desc");
  // Match the Market "Top" tab: each card row gets the same "+" add button and
  // up/down sentiment votes.
  const [addingCards, setAddingCards] = useState<Set<string>>(new Set());
  const [sentimentMap, setSentimentMap] = useState<Map<string, SetSentiment>>(new Map());
  const { data: wishlistedIds = new Set<string>() } = useQuery({
    queryKey: ["wishlisted-ids", user?.id],
    queryFn: () => getAllWishlistCardIds(user!.id),
    enabled: !!user,
  });

  // Resolve slug → set object. Lightweight set list (84KB) instead of the
  // 10MB monolith — this is an SEO landing page, first paint matters.
  const { data: setsResult } = useQuery({
    queryKey: ["market-sets"],
    queryFn: getMarketSets,
    staleTime: Infinity,
  });
  const set = useMemo<PokemonSet | undefined>(() => {
    if (!setsResult?.data || !slug) return undefined;
    return findSetBySlug(slug, setsResult.data);
  }, [setsResult, slug]);

  // Fetch EVERY card in the set in a single call. We used to paginate at
  // 60/page with infinite scroll, but that broke client-side sorting:
  // clicking "Card Number: High → Low" only sorted what was loaded so far,
  // so a 295-card set sorted-desc would start at #120 (the highest of the
  // first 120 loaded), missing the secret rares above. Now we always have
  // the whole set in memory and sort works correctly.
  //
  // No real cost — getSetCards reads from the static index already loaded
  // into memory, so asking for 500 vs 60 is the same operation. Largest
  // Pokémon TCG set is ~300 cards; 500 is comfortable headroom.
  const { data: rawCardsResult, isLoading } = useQuery({
    queryKey: ["set-cards", set?.id],
    queryFn: () => getSetCards(set!.id, 1, 500),
    enabled: !!set,
    staleTime: 5 * 60_000,
  });

  const rawCards = useMemo(
    () => (rawCardsResult?.data ?? []) as PokemonCard[],
    [rawCardsResult],
  );

  // Hydrate prices for the rows we've loaded.
  const { data: enrichedCards = [], isFetching: isPricingLoading } = useQuery({
    queryKey: ["set-cards-priced", set?.id, rawCards.length],
    queryFn: () => enrichPageWithPricing(rawCards),
    enabled: rawCards.length > 0,
    staleTime: 60_000,
  });

  // Client-side sort on the enriched set so all four sort options work
  // without re-fetching from Scrydex.
  const cards = useMemo(() => {
    const arr = [...enrichedCards];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "number-asc":
        case "number-desc": {
          const na = parseInt(a.number, 10) || 0;
          const nb = parseInt(b.number, 10) || 0;
          return sortKey === "number-asc" ? na - nb : nb - na;
        }
        case "price-desc":
        case "price-asc": {
          const pa = getMarketPrice(a) ?? -1;
          const pb = getMarketPrice(b) ?? -1;
          return sortKey === "price-desc" ? pb - pa : pa - pb;
        }
      }
    });
    return arr;
  }, [enrichedCards, sortKey]);

  // Load per-card sentiment once the set's cards are in (a set is ≤~300 cards,
  // so fetching sentiment for all of them is cheap).
  useEffect(() => {
    if (cards.length === 0) return;
    getSetSentiment(cards.map((c) => c.id)).then(setSentimentMap);
  }, [cards]);

  // Up/down vote — optimistic via the shared applyVote, same as Market.
  const handleVote = async (cardId: string, voteType: VoteType) => {
    if (!user) { navigate("/auth"); return; }
    const currentVote = sentimentMap.get(cardId)?.currentUserVote ?? null;
    setSentimentMap((prev) => {
      const next = new Map(prev);
      const old = prev.get(cardId) || { setId: cardId, upvotes: 0, downvotes: 0, score: 0, currentUserVote: null };
      next.set(cardId, applyVote(old, voteType));
      return next;
    });
    await castVote(cardId, user.id, currentVote, voteType);
  };

  // "+" opens the quick-action panel (add / wishlist / buy), bound to this card.
  const [actionCard, setActionCard] = useState<PokemonCard | null>(null);
  const handleAdd = (e: React.MouseEvent, card: PokemonCard) => {
    e.preventDefault();
    e.stopPropagation();
    setActionCard(card);
  };

  const addInventory = async (card: PokemonCard) => {
    if (!user) { navigate("/auth"); return; }
    if (addingCards.has(card.id)) return;
    setAddingCards((prev) => new Set(prev).add(card.id));
    const result = await addToCollection(card, user.id);
    setAddingCards((prev) => { const next = new Set(prev); next.delete(card.id); return next; });
    if (result) {
      recordCollectionAdd({ id: card.id, name: card.name, setName: card.set.name, imageSmall: card.images.small });
      toastAddedToInventory(card.name, navigate);
    } else {
      toast.error("Failed to add card.");
    }
  };

  const addWishlist = async (card: PokemonCard) => {
    if (!user) { navigate("/auth"); return; }
    try {
      const result = await toggleCardInDefaultWishlist(user.id, card);
      if (result === "added") {
        toast.success(`Added ${card.name} to wishlist`);
        recordWishlistAdd({ id: card.id, name: card.name, setName: card.set.name, imageSmall: card.images.small });
      } else {
        toast.success(`Removed ${card.name} from wishlist`);
      }
      queryClient.invalidateQueries({ queryKey: ["wishlisted-ids"] });
      queryClient.invalidateQueries({ queryKey: ["wishlists"] });
    } catch {
      toast.error("Failed to update wishlist.");
    }
  };

  // ─── Set-completion progress (logged-in users only) ──────────────────────
  // Fetch the user's collection and compute how many DISTINCT cards from
  // this set they own (counting unique card numbers, not total copies).
  // The set page is public/SEO-facing, so this is gated behind auth — a
  // logged-out visitor just doesn't see the bar.
  const { data: myCollection = [] } = useQuery({
    queryKey: ["my-collection-for-set", user?.id],
    queryFn: getCollection,
    enabled: !!user,
    staleTime: 60_000,
  });

  const completion = useMemo(() => {
    if (!set || !user) return null;
    // Match on setId. Count distinct card numbers owned so 3 copies of one
    // card still counts as "1 of N collected".
    const owned = new Set(
      myCollection
        .filter((c) => c.setId === set.id)
        .map((c) => c.cardNumber),
    );
    const total = rawCards.length || (set.printedTotal || set.total || 0);
    const ownedCount = owned.size;
    const pct = total > 0 ? Math.min(100, (ownedCount / total) * 100) : 0;
    return { ownedCount, total, pct };
  }, [myCollection, set, user, rawCards.length]);

  const jsonLd = useMemo(() => {
    if (!set || cards.length === 0) return undefined;
    const sName = set.name ?? "Set";
    const top = [...cards]
      .sort((a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0))
      .slice(0, 100);
    return [
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Sets", item: `${BASE}/sets` },
          { "@type": "ListItem", position: 2, name: sName, item: `${BASE}/sets/${setSlug(set)}` },
        ],
      },
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: `${sName} Card List`,
        numberOfItems: top.length,
        itemListElement: top.map((c, i) => {
          const price = getMarketPrice(c);
          return {
            "@type": "ListItem",
            position: i + 1,
            item: {
              "@type": "Product",
              name: c.name,
              sku: c.number,
              image: c.images?.small,
              url: `${BASE}${cardPath(set, c)}`,
              brand: { "@type": "Brand", name: "Pokémon" },
              category: "Trading Card",
              ...(price != null && {
                offers: {
                  "@type": "Offer",
                  price: price.toFixed(2),
                  priceCurrency: "USD",
                  availability: "https://schema.org/InStock",
                },
              }),
            },
          };
        }),
      },
    ];
  }, [set, cards]);

  // Infinite-scroll sentinel removed — entire set now loads in a single
  // useQuery so sorting works against the full card list (see comment on
  // the rawCardsResult query above).

  // ─── 404 ───────────────────────────────────────────────────────────────────
  if (setsResult && !set) {
    return (
      <div className="min-h-screen bg-background">
        <SEO
          title="Set not found — Collectiblez"
          description="This Pokémon TCG set could not be found."
          path={`/sets/${slug ?? ""}`}
          noindex
        />
        <AppHeader activePage={"sets" as never} />
        <div className="container py-12 px-4 text-center">
          <p className="text-muted-foreground mb-4">No expansion matches "{slug}".</p>
          <Button onClick={() => navigate("/sets")} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to all sets
          </Button>
        </div>
      </div>
    );
  }

  // ─── SEO copy + JSON-LD ────────────────────────────────────────────────────
  const year = set?.releaseDate ? set.releaseDate.slice(0, 4) : "";
  const cardCount = set?.printedTotal || set?.total || 0;
  const setName = set?.name ?? "Set";
  const series = set?.series ?? "";

  const seoTitle = set ? `${setName} — Card List & Prices (${year}) | Collectiblez` : "Collectiblez";
  const seoDescription = set
    ? `Full ${setName} card list with live market prices for all ${cardCount} cards from the ${series} series. Updated daily.`
    : "";

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <RowActions
        open={!!actionCard}
        onOpenChange={(o) => { if (!o) setActionCard(null); }}
        name={actionCard?.name ?? ""}
        buyQuery={actionCard ? buyQueryForCard(actionCard) : ""}
        onAddInventory={() => actionCard && addInventory(actionCard)}
        onAddWishlist={() => actionCard && addWishlist(actionCard)}
        wishlistActionLabel={actionCard && wishlistedIds.has(actionCard.id) ? "Remove from wishlist" : "Add to wishlist"}
        wishlistActive={!!actionCard && wishlistedIds.has(actionCard.id)}
      />
      {set && (
        <SEO
          title={seoTitle}
          description={seoDescription}
          path={`/sets/${setSlug(set)}`}
          jsonLd={jsonLd}
        />
      )}
      <AppHeader activePage={"sets" as never} />

      <div className="container px-4 sm:px-8 py-6">
        {/* Breadcrumb */}
        <nav className="text-sm text-muted-foreground mb-4 flex items-center gap-2">
          <Link to="/sets" className="hover:text-foreground transition-colors">Sets</Link>
          <span className="text-muted-foreground/40">/</span>
          <span className="text-foreground">{setName}</span>
        </nav>

        {/* Hero */}
        {set ? (
          <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4 sm:gap-6 mb-6">
            <img
              src={`/data/logos/${set.id}.png`}
              alt={`${setName} logo`}
              /* On mobile the logo stacks above the title (larger, centered).
                 From sm+ it sits beside the text block. */
              className="h-24 sm:h-24 w-auto max-w-[260px] sm:max-w-[220px] object-contain shrink-0"
              onError={(e) => {
                const img = e.currentTarget;
                if (img.src !== set.images.logo) img.src = set.images.logo;
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{series}</p>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground leading-tight">
                {setName}
              </h1>
              <div className="flex items-center justify-center sm:justify-start gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                {set.releaseDate && (
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    {set.releaseDate}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  {cardCount} cards
                </span>
              </div>
            </div>
          </div>
        ) : (
          <Skeleton className="h-24 w-full mb-6" />
        )}

        {/* Set-completion bar — full-width block BELOW the hero so it never
            gets squished in the narrow text column next to the logo on
            mobile. Logged-in users only. */}
        {set && completion && completion.total > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-muted-foreground">Your collection</span>
              <span className="font-semibold text-foreground tabular-nums">
                {completion.ownedCount} / {completion.total}
                <span className="text-muted-foreground font-normal ml-1.5">
                  ({completion.pct.toFixed(0)}%)
                </span>
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${completion.pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Toolbar — sort + view toggle (no sidebar). Card-count text
            removed: it duplicated the "{cardCount} cards" already shown in
            the hero meta + the completion bar's "X / Y" count. */}
        <div className="flex items-center gap-3 mb-4">
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="flex-1 sm:w-[240px] sm:flex-none bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                aria-label="Grid view"
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}
                aria-label="List view"
              >
                <LayoutList className="w-4 h-4" />
              </button>
          </div>
        </div>


        {/* Card grid/list */}
        {isLoading && cards.length === 0 ? (
          <div className={viewMode === "grid"
            ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4"
            : "space-y-3"
          }>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="rounded-xl overflow-hidden border border-border/50 bg-card">
                <Skeleton className="aspect-[2.5/3.5] w-full" />
                <div className="p-3 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : cards.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No cards available for this set yet.
          </div>
        ) : viewMode === "grid" ? (
          <CardGrid cards={cards} set={set!} isPricingLoading={isPricingLoading}
            sentimentMap={sentimentMap} addingCards={addingCards} onAdd={handleAdd} onVote={handleVote} />
        ) : (
          <CardList cards={cards} set={set!} isPricingLoading={isPricingLoading}
            sentimentMap={sentimentMap} addingCards={addingCards} onAdd={handleAdd} onVote={handleVote} />
        )}

        {/* Total-loaded indicator. No infinite scroll anymore — the entire
            set loads in one query so sorting works against all cards. */}
        {cards.length > 0 && (
          <div className="py-6 flex justify-center">
            <p className="text-xs text-muted-foreground">
              All {cards.length} cards loaded
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Grid view ───────────────────────────────────────────────────────────────

interface CardGridListProps {
  cards: PokemonCard[];
  set: PokemonSet;
  isPricingLoading: boolean;
  sentimentMap: Map<string, SetSentiment>;
  addingCards: Set<string>;
  onAdd: (e: React.MouseEvent, card: PokemonCard) => void;
  onVote: (cardId: string, voteType: VoteType) => void;
}

function CardGrid({ cards, set, isPricingLoading, sentimentMap, addingCards, onAdd, onVote }: CardGridListProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
      {cards.map((card, i) => {
        const price = getMarketPrice(card);
        const sentiment = sentimentMap.get(card.id);
        return (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.01, 0.3) }}
            className="bg-card border border-border/50 hover:border-primary/40 transition-colors h-full flex flex-col group"
          >
            {/* Clickable area → card detail. The action row below is OUTSIDE
                this link so the vote/add buttons don't trigger navigation. */}
            <Link to={cardPath(set, card)} className="block">
              <div className="bg-background/50 p-1.5 sm:p-2">
                <img src={card.images.small} alt={card.name} className="w-full" loading="lazy" />
              </div>
              <div className="px-2 sm:px-3 pt-2 sm:pt-3 space-y-0.5 sm:space-y-1">
                <p className="text-xs sm:text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                  {card.name}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                  {card.rarity ?? ""}{card.rarity && card.number ? " · " : ""}#{card.number}/{set.printedTotal || set.total}
                </p>
                {isPricingLoading
                  ? <Skeleton className="h-4 w-12" />
                  : <span className="text-xs sm:text-sm font-bold text-foreground">{price != null ? formatPrice(price) : "—"}</span>
                }
              </div>
            </Link>
            {/* Action row — sentiment votes + add, matching the Market Top tab */}
            <div className="px-2 sm:px-3 pb-2 sm:pb-3 pt-2 mt-auto flex items-center justify-between gap-1.5">
              <SetSentimentBadge
                upvotes={sentiment?.upvotes ?? 0}
                downvotes={sentiment?.downvotes ?? 0}
                score={sentiment?.score ?? 0}
                currentUserVote={sentiment?.currentUserVote ?? null}
                onVote={(vt) => onVote(card.id, vt)}
                compact
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 shrink-0 rounded-full border border-border/50 hover:border-primary hover:text-primary"
                disabled={addingCards.has(card.id)}
                onClick={(e) => onAdd(e, card)}
                aria-label="Add to collection"
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── List view ───────────────────────────────────────────────────────────────

function CardList({ cards, set, isPricingLoading, sentimentMap, addingCards, onAdd, onVote }: CardGridListProps) {
  return (
    <div className="space-y-2">
      {cards.map((card, i) => {
        const price = getMarketPrice(card);
        const sentiment = sentimentMap.get(card.id);
        return (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.008, 0.3) }}
            className="flex items-center gap-3 sm:gap-4 p-2.5 sm:p-3 rounded-xl bg-card border border-border/50 hover:border-primary/30 hover:bg-card/80 transition-colors group"
          >
            {/* Clickable area → card detail; action controls live outside it. */}
            <Link to={cardPath(set, card)} className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
              <img src={card.images.small} alt={card.name} className="w-10 sm:w-12 shrink-0" loading="lazy" />
              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                  {card.name}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                  #{card.number}/{set.printedTotal || set.total}{card.rarity ? ` · ${card.rarity}` : ""}
                </p>
              </div>
              {isPricingLoading
                ? <Skeleton className="h-4 w-14 shrink-0" />
                : <span className="text-xs sm:text-sm font-bold text-foreground whitespace-nowrap">{price != null ? formatPrice(price) : "—"}</span>
              }
            </Link>
            {/* Action row — sentiment votes + add, matching the Market Top tab */}
            <div className="flex items-center gap-2 shrink-0">
              <SetSentimentBadge
                upvotes={sentiment?.upvotes ?? 0}
                downvotes={sentiment?.downvotes ?? 0}
                score={sentiment?.score ?? 0}
                currentUserVote={sentiment?.currentUserVote ?? null}
                onVote={(vt) => onVote(card.id, vt)}
                compact
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Card actions"
                className="h-8 w-8 p-0 rounded-full border border-border/50 hover:border-primary hover:text-primary"
                onClick={(e) => onAdd(e, card)}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
