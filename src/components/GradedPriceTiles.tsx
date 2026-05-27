// GradedPriceTiles — 6 stat tiles showing PSA/BGS/CGC 10 + 9 market prices
// for a card. Lives under the main hero row on CardDetail.
//
// Data flow:
//   snapshot-prices (daily) → graded_price_snapshots → latest_graded_prices
//   → get_graded_tiles_for_card RPC → this component
//
// No Scrydex call on read. Sub-50ms render. Zero extra Scrydex credits
// because graded entries come in the same /cards?include=prices response
// raw prices already use; snapshot-prices just stopped throwing them away.
//
// Empty state: when the RPC returns < 6 rows, the missing combos render as
// greyed-out em-dash tiles so the row is always visible and the user knows
// "we checked, no PSA 8 data" rather than "section is broken/missing."

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  // Card id from our index. Strips ::variant suffix before querying — graded
  // prices don't change per variant in Scrydex's data model.
  cardId: string;
}

// Tile order — mirrors GRADED_TILE_KEYS in lib/scrydex-api.ts. Kept here as a
// constant so the row layout is stable even when the RPC returns nothing.
const TILE_KEYS: Array<{ company: string; grade: number }> = [
  { company: "PSA", grade: 10 },
  { company: "PSA", grade: 9  },
  { company: "BGS", grade: 10 },
  { company: "BGS", grade: 9  },
  { company: "CGC", grade: 10 },
  { company: "CGC", grade: 9  },
];

interface TileRow {
  company: string;
  grade: number;
  market: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  currency: string;
}

function formatUsd(n: number | null): string {
  if (n == null || n <= 0) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  });
}

function Tile({ row }: { row: TileRow }) {
  const hasData = row.market != null && row.market > 0;
  // Show low–high range only when we have both AND they're not identical to
  // market (Scrydex sometimes returns market=low=high for thin-data cards).
  const showRange =
    hasData &&
    row.low != null && row.high != null && row.low !== row.high;

  return (
    <div
      className={`rounded-xl border bg-card p-3 sm:p-4 ${
        hasData ? "border-border" : "border-border/40 opacity-60"
      }`}
    >
      <div className="text-xs font-semibold text-muted-foreground tracking-wide">
        {row.company} {row.grade}
      </div>
      <div
        className={`mt-1.5 text-base sm:text-lg font-bold tabular-nums ${
          hasData ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {formatUsd(row.market)}
      </div>
      {showRange ? (
        <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
          {formatUsd(row.low)} – {formatUsd(row.high)}
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
  // Strip our ::variant suffix — graded data is tied to the physical card,
  // not the foil variant.
  const baseCardId = cardId.split("::")[0];

  const { data, isLoading } = useQuery({
    queryKey: ["graded-tiles", baseCardId],
    queryFn: async (): Promise<Map<string, TileRow>> => {
      const { data, error } = await supabase.rpc("get_graded_tiles_for_card", {
        p_card_id: baseCardId,
      });
      if (error) {
        console.warn("[GradedPriceTiles] RPC error:", error.message);
        return new Map();
      }
      const map = new Map<string, TileRow>();
      for (const r of (data ?? []) as TileRow[]) {
        map.set(`${r.company}-${r.grade}`, r);
      }
      return map;
    },
    staleTime: 60 * 60_000,           // 1 hour — graded prices update daily at most
    refetchOnWindowFocus: false,
    enabled: !!baseCardId,
  });

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

  // Always render all 6 tiles, even if the cache has no data for some. The
  // Tile component handles the "no data" state internally (em-dash + dimmed
  // border). This is intentional — see comments above on why we don't hide
  // the section. Previous "anyData ? render : null" guard was confusing
  // because chase cards would silently lose the section if Scrydex's graded
  // data hadn't been ingested yet.
  const rows: TileRow[] = TILE_KEYS.map((k) => {
    const found = data?.get(`${k.company}-${k.grade}`);
    return found ?? {
      company: k.company,
      grade: k.grade,
      market: null, low: null, mid: null, high: null, currency: "USD",
    };
  });

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-display font-semibold text-foreground">
          Graded Prices
        </h3>
        <span className="text-[10px] text-muted-foreground">
          Market · Source: Scrydex (daily snapshot)
        </span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
        {rows.map((r) => (
          <Tile key={`${r.company}-${r.grade}`} row={r} />
        ))}
      </div>
    </section>
  );
}
