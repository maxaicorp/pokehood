import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSets, PokemonSet, TCGP_SERIES_IDS } from "@/lib/pokemon-api";
import AppHeader from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Layers } from "lucide-react";
import { motion } from "framer-motion";

/** Preferred display order for series (newest first) */
const SERIES_ORDER = [
  "Mega Evolution",
  "Scarlet & Violet",
  "Sword & Shield",
  "Sun & Moon",
  "XY",
  "Black & White",
  "HeartGold & SoulSilver",
  "Call of Legends",
  "Platinum",
  "Diamond & Pearl",
  "EX",
  "E-Card",
  "Neo",
  "Gym",
  "Base",
  "Legendary Collection",
  "POP",
  "Miscellaneous",
  "McDonald's Collection",
  "Trainer kits",
];

/** TCGdex logo URLs don't include file extensions — append .png */
function fixLogoUrl(url: string): string {
  if (!url) return "";
  if (/\.\w+$/.test(url)) return url;
  return url + ".png";
}

interface SeriesGroup {
  series: string;
  sets: PokemonSet[];
}

export default function Sets() {
  const [search, setSearch] = useState("");

  const { data: setsResult, isLoading } = useQuery({
    queryKey: ["all-sets"],
    queryFn: getSets,
    staleTime: 60_000,
  });

  const groups = useMemo<SeriesGroup[]>(() => {
    if (!setsResult?.data) return [];

    // Filter out TCG Pocket sets
    const sets = setsResult.data.filter(
      (s) => !TCGP_SERIES_IDS.includes(s.series.toLowerCase())
    );
    const map = new Map<string, PokemonSet[]>();

    for (const set of sets) {
      const series = set.series || "Other";
      if (!map.has(series)) map.set(series, []);
      map.get(series)!.push(set);
    }

    // Sort sets within each group by release date (newest first)
    for (const [, arr] of map) {
      arr.sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
    }

    // Sort groups by preferred order
    const sorted = [...map.entries()].sort(([a], [b]) => {
      const ai = SERIES_ORDER.indexOf(a);
      const bi = SERIES_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    return sorted.map(([series, sets]) => ({ series, sets }));
  }, [setsResult]);

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        sets: g.sets.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.series.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.sets.length > 0);
  }, [groups, search]);

  const totalSets = groups.reduce((sum, g) => sum + g.sets.length, 0);

  return (
    <div className="min-h-screen bg-background pb-24 sm:pb-8">
      <AppHeader activePage="market">
        {/* Search bar below header */}
        <div className="border-t border-border/30 bg-muted/20">
          <div className="container px-4 sm:px-8 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter expansions..."
                className="pl-9 bg-background"
              />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Layers className="w-4 h-4" />
              <span>{totalSets} expansions</span>
              <span className="text-border">·</span>
              <span>{groups.length} series</span>
            </div>
          </div>
        </div>
      </AppHeader>

      <main className="container px-4 sm:px-8 py-6 space-y-10">
        {isLoading ? (
          <div className="space-y-10">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="h-7 w-48 mb-4" />
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <Skeleton key={j} className="h-32 rounded-xl" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-muted-foreground">
            <Layers className="w-12 h-12 mx-auto mb-4 opacity-40" />
            <p className="text-sm">No expansions match "{search}"</p>
          </div>
        ) : (
          filtered.map((group) => (
            <section key={group.series}>
              <h2 className="font-display font-bold text-lg sm:text-xl text-foreground mb-4 uppercase tracking-wide">
                {group.series}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                {group.sets.map((set, i) => (
                  <SetCard key={set.id} set={set} index={i} />
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}

function SetCard({ set, index }: { set: PokemonSet; index: number }) {
  const isPocket = TCGP_SERIES_IDS.includes(set.series.toLowerCase());

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.4) }}
    >
      <Link
        to={`/explore?set=${set.id}`}
        className="group block rounded-xl border border-border/60 bg-card hover:border-primary/40 hover:bg-muted/50 transition-all duration-200 overflow-hidden"
      >
        {/* Logo area */}
        <div className="h-24 sm:h-28 flex items-center justify-center p-4 bg-muted/20 group-hover:bg-muted/40 transition-colors">
          {set.images?.logo ? (
            <img
              src={set.images.logo}
              alt={set.name}
              className="max-h-full max-w-full object-contain drop-shadow-sm group-hover:scale-105 transition-transform duration-200"
              loading="lazy"
            />
          ) : (
            <div className="text-center">
              <Layers className="w-8 h-8 text-muted-foreground/40 mx-auto mb-1" />
              <span className="text-xs text-muted-foreground font-medium">{set.name}</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="px-3 py-2.5 border-t border-border/30">
          <p className="text-xs sm:text-sm font-semibold text-foreground truncate leading-tight">
            {set.name}
          </p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] sm:text-xs text-muted-foreground">
              {set.releaseDate
                ? new Date(set.releaseDate + "T00:00:00").toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                  })
                : "—"}
            </span>
            <span className="text-[10px] sm:text-xs text-muted-foreground">
              {set.total} cards
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
