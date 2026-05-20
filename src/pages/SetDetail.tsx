// SetDetail — public landing page for a single TCG expansion.
//
// URL: /sets/:slug   e.g. /sets/ascended-heroes
//
// This is the SEO-critical page: when someone Googles "ascended heroes card
// list" or "prismatic evolutions prices", we want THIS page to rank. Three
// requirements drive the design:
//
//   1. Stable, keyword-rich URL  → `/sets/{kebab(setName)}`
//   2. Real content in the HTML  → render the card table directly, not behind
//                                  a tab/filter on Explore. The card list IS
//                                  the page.
//   3. Structured data           → ItemList JSON-LD with every priced card as
//                                  a Product/Offer so Google/AI engines can
//                                  quote prices and surface us as a price-list
//                                  source.

import { useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { getSets, getSetCardsByPrice, getMarketPrice, formatPrice, type PokemonCard, type PokemonSet } from "@/lib/pokemon-api";
import { findSetBySlug, cardPath, setSlug } from "@/lib/slug";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, Layers } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import SEO from "@/components/SEO";

const BASE = "https://collectiblez.app";

export default function SetDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const { data: setsResult } = useQuery({
    queryKey: ["all-sets"],
    queryFn: getSets,
    staleTime: Infinity,
  });

  const set = useMemo<PokemonSet | undefined>(() => {
    if (!setsResult?.data || !slug) return undefined;
    return findSetBySlug(slug, setsResult.data);
  }, [setsResult, slug]);

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ["set-cards-by-price", set?.id],
    queryFn: () => getSetCardsByPrice(set!.id),
    enabled: !!set,
    staleTime: 5 * 60 * 1000,
  });

  // ─── 404: slug doesn't match any set ───────────────────────────────────────
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
  //
  // Title/description are written as factual statements so AI engines
  // (Perplexity, ChatGPT) feel comfortable quoting them. No marketing.

  const year = set?.releaseDate ? set.releaseDate.slice(0, 4) : "";
  const cardCount = set?.printedTotal || set?.total || 0;
  const setName = set?.name ?? "Set";
  const series = set?.series ?? "";

  const seoTitle = set ? `${setName} — Card List & Prices (${year}) | Collectiblez` : "Collectiblez";
  const seoDescription = set
    ? `Full ${setName} card list with live market prices for all ${cardCount} cards from the ${series} series. Updated daily.`
    : "";

  const jsonLd = useMemo(() => {
    if (!set || !cards.length) return undefined;
    // Cap the ItemList at the top 100 by price — Google ignores enormous lists
    // and the most expensive cards are the ones people search for anyway.
    const top = cards.slice(0, 100);
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

  // ─── Render ────────────────────────────────────────────────────────────────

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
          <div className="flex items-start gap-4 sm:gap-6 mb-8">
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
          <Skeleton className="h-24 w-full mb-8" />
        )}

        {/* Card list */}
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
            All cards · sorted by market price
          </div>
          {cardsLoading || !set ? (
            <div className="divide-y divide-border/40">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  <Skeleton className="w-12 h-16" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          ) : cards.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No card data available for this set yet.
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {cards.map((c, i) => (
                <CardRow key={c.id} card={c} index={i} set={set} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CardRow({ card, index, set }: { card: PokemonCard; index: number; set: PokemonSet }) {
  const price = getMarketPrice(card);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.01, 0.3) }}
    >
      <Link
        to={cardPath(set, card)}
        className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors group"
      >
        <span className="text-xs font-mono text-muted-foreground tabular-nums w-8 text-right shrink-0">
          {index + 1}
        </span>
        <img
          src={card.images.small}
          alt={card.name}
          className="w-12 aspect-[3/4] rounded-md shadow-sm object-cover bg-muted shrink-0"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
            {card.name}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            #{card.number}/{set.printedTotal || set.total}
          </p>
        </div>
        <p className="text-sm font-bold text-foreground tabular-nums shrink-0">
          {price != null ? formatPrice(price) : "—"}
        </p>
      </Link>
    </motion.div>
  );
}
