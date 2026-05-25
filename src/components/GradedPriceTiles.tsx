// GradedPriceTiles — 6 stat tiles showing PSA/BGS/CGC 10 + 9 market prices
// for a card. Lives under the main hero row on CardDetail.
//
// Data source: Scrydex /cards/{id}?include=prices. Scrydex returns raw and
// graded entries in the same variants[].prices[] array, distinguished by
// `type` and (for graded) `company` + `grade`. extractGradedTilePrices()
// in lib/scrydex-api.ts owns the picking logic.
//
// Why these 6 specific tiles: PSA + BGS + CGC are the dominant grading
// companies for Pokémon TCG. Grades 10 and 9 cover the cards collectors
// actually trade — sub-9 graded cards are a niche market that would dilute
// the at-a-glance comparison this row is meant to provide. If we want
// more grades later (8.5, 8, etc.), expand GRADED_TILE_KEYS in scrydex-api.ts.

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { getScrydexCard, extractGradedTilePrices, type GradedTilePrice } from "@/lib/scrydex-api";

interface Props {
  // Card id from our index. Strips ::variant suffix before querying Scrydex
  // because graded prices don't change per variant in Scrydex's data model.
  cardId: string;
}

function formatUsd(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  });
}

function Tile({ price }: { price: GradedTilePrice }) {
  const hasData = price.market != null && price.market > 0;
  // Show low–high range only when we have both AND they're not identical to
  // market (Scrydex sometimes returns market=low=high for thin-data cards).
  const showRange =
    price.low != null && price.high != null && price.low !== price.high;

  return (
    <div
      className={`rounded-xl border bg-card p-3 sm:p-4 ${
        hasData ? "border-border" : "border-border/40 opacity-60"
      }`}
    >
      <div className="text-xs font-semibold text-muted-foreground tracking-wide">
        {price.company} {price.grade}
      </div>
      <div
        className={`mt-1.5 text-base sm:text-lg font-bold tabular-nums ${
          hasData ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {formatUsd(price.market)}
      </div>
      {showRange ? (
        <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
          {formatUsd(price.low)} – {formatUsd(price.high)}
        </div>
      ) : (
        // Reserve a line of vertical space so all tiles align even when the
        // range row isn't rendered. Avoids a janky uneven grid.
        <div className="mt-0.5 h-[14px]" aria-hidden />
      )}
    </div>
  );
}

export default function GradedPriceTiles({ cardId }: Props) {
  // Strip our ::variant suffix — Scrydex doesn't know about it. Vintage
  // variant rows (e.g. "base1-4::shadowless") still share the same graded
  // dataset on Scrydex's side.
  const scrydexId = cardId.split("::")[0];

  const { data, isLoading, isError } = useQuery({
    queryKey: ["graded-prices", scrydexId],
    queryFn: async () => {
      const card = await getScrydexCard(scrydexId);
      if (!card) return null;
      return extractGradedTilePrices(card);
    },
    staleTime: 60 * 60_000,           // 1 hour — graded prices update slowly
    refetchOnWindowFocus: false,
    enabled: !!scrydexId,
  });

  if (isError) {
    // Silent fail — the page is still useful without graded tiles. Log so
    // /admin/functions probing surfaces it.
    console.warn("[GradedPriceTiles] failed to load");
    return null;
  }

  if (isLoading) {
    return (
      <section className="mt-8">
        <h3 className="font-display font-semibold text-foreground mb-3">
          Graded Prices
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  if (!data) return null;

  // Hide the entire section if Scrydex has no graded data at all for this
  // card (common on commons, sealed-only products, and very new releases).
  // Showing 6 "—" tiles would be visual noise.
  const anyData = data.some((d) => d.market != null && d.market > 0);
  if (!anyData) return null;

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-display font-semibold text-foreground">
          Graded Prices
        </h3>
        <span className="text-[10px] text-muted-foreground">Market · Source: Scrydex</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
        {data.map((p) => (
          <Tile key={`${p.company}-${p.grade}`} price={p} />
        ))}
      </div>
    </section>
  );
}
