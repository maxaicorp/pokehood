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

import { useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  getSets,
  getSetCards,
  getMarketPrice,
  formatPrice,
  enrichPageWithPricing,
  type PokemonCard,
  type PokemonSet,
} from "@/lib/pokemon-api";
import { findSetBySlug, cardPath, setSlug } from "@/lib/slug";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Calendar, Layers, Grid3X3, LayoutList } from "lucide-react";
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
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortKey, setSortKey] = useState<SortKey>("number-asc");

  // Resolve slug → set object.
  const { data: setsResult } = useQuery({
    queryKey: ["all-sets"],
    queryFn: getSets,
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

  const jsonLd = useMemo(() => {
    if (!set || cards.length === 0) return undefined;
    const top = [...cards]
      .sort((a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0))
      .slice(0, 100);
    return [
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Sets", item: `${BASE}/sets` },
          { "@type": "ListItem", position: 2, name: setName, item: `${BASE}/sets/${setSlug(set)}` },
        ],
      },
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: `${setName} Card List`,
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
  }, [set, cards, setName]);

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
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
          <div className="flex items-start gap-4 sm:gap-6 mb-6">
            <img
              src={`/data/logos/${set.id}.png`}
              alt={`${setName} logo`}
              className="w-24 sm:w-32 h-auto object-contain shrink-0"
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
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
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

        {/* Toolbar — sort + view toggle (no sidebar) */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <p className="text-sm text-muted-foreground">
            {cards.length > 0 && (
              cards.length === cardCount
                ? `${cards.length} cards`
                : `${cards.length} cards (set lists ${cardCount} printed)`
            )}
          </p>
          <div className="flex items-center gap-2">
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="w-[200px] bg-background">
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
          <CardGrid cards={cards} set={set!} isPricingLoading={isPricingLoading} />
        ) : (
          <CardList cards={cards} set={set!} isPricingLoading={isPricingLoading} />
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

function CardGrid({ cards, set, isPricingLoading }: { cards: PokemonCard[]; set: PokemonSet; isPricingLoading: boolean }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
      {cards.map((card, i) => {
        const price = getMarketPrice(card);
        return (
          <Link
            key={card.id}
            to={cardPath(set, card)}
            className="block group"
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.01, 0.3) }}
              className="bg-card border border-border/50 hover:border-primary/40 transition-colors h-full flex flex-col"
            >
              <div className="bg-background/50 p-1.5 sm:p-2">
                <img
                  src={card.images.small}
                  alt={card.name}
                  className="w-full"
                  loading="lazy"
                />
              </div>
              <div className="p-2 sm:p-3 space-y-0.5 sm:space-y-1 flex-1 flex flex-col justify-end">
                <p className="text-xs sm:text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                  {card.name}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                  {card.rarity ?? ""}{card.rarity && card.number ? " · " : ""}#{card.number}/{set.printedTotal || set.total}
                </p>
                <div className="flex items-center justify-between pt-1 mt-auto">
                  {isPricingLoading
                    ? <Skeleton className="h-4 w-12" />
                    : <span className="text-xs sm:text-sm font-bold text-foreground">{price != null ? formatPrice(price) : "—"}</span>
                  }
                </div>
              </div>
            </motion.div>
          </Link>
        );
      })}
    </div>
  );
}

// ─── List view ───────────────────────────────────────────────────────────────

function CardList({ cards, set, isPricingLoading }: { cards: PokemonCard[]; set: PokemonSet; isPricingLoading: boolean }) {
  return (
    <div className="space-y-2">
      {cards.map((card, i) => {
        const price = getMarketPrice(card);
        return (
          <Link
            key={card.id}
            to={cardPath(set, card)}
            className="block group"
          >
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.008, 0.3) }}
              className="flex items-center gap-3 sm:gap-4 p-2.5 sm:p-3 rounded-xl bg-card border border-border/50 hover:border-primary/30 hover:bg-card/80 transition-colors"
            >
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
            </motion.div>
          </Link>
        );
      })}
    </div>
  );
}
