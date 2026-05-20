import { useState, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSets, PokemonSet } from "@/lib/pokemon-api";
import { setPath } from "@/lib/slug";
import AppHeader from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Layers } from "lucide-react";
import SEO from "@/components/SEO";
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

interface SeriesGroup {
  series: string;
  sets: PokemonSet[];
}

export default function Sets() {
  const [search, setSearch] = useState("");

  const { data: setsResult, isLoading } = useQuery({
    queryKey: ["all-sets"],
    queryFn: getSets,
    staleTime: Infinity, // static data from all-cards.json, never stale
  });

  const groups = useMemo<SeriesGroup[]>(() => {
    // Filter out online-only sets (TCG Pocket)
    const sets = (setsResult?.data ?? []).filter((s) => !s.isOnlineOnly);

    const map = new Map<string, PokemonSet[]>();
    for (const set of sets) {
      const series = set.series || "Other";
      if (!map.has(series)) map.set(series, []);
      map.get(series)!.push(set);
    }

    // Sort sets within each group by release date (newest first)
    for (const [, arr] of map) {
      arr.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
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
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <SEO
        title="Pokémon TCG Sets & Expansions — Collectiblez"
        description="Browse every Pokémon TCG expansion, newest first, with set logos, card counts, and links to live market prices."
        path="/sets"
      />
      <AppHeader activePage="sets">
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

      <div className="container px-4 sm:px-8 py-6 space-y-10">
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
      </div>
    </div>
  );
}

function SetCard({ set, index }: { set: PokemonSet; index: number }) {
  // Prefer the locally bundled logo (public/data/logos/{id}.png) so the page
  // renders without hitting the Scrydex CDN. Fall back to the remote URL only
  // if the local PNG 404s, then to the icon if both fail.
  const localLogo = `/data/logos/${set.id}.png`;
  const [logoSrc, setLogoSrc] = useState<string | null>(localLogo);
  const triedRemote = useRef(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.4) }}
    >
      <Link
        to={setPath(set)}
        className="group block rounded-xl border border-border/60 bg-card hover:border-primary/40 hover:bg-muted/50 transition-all duration-200 overflow-hidden"
      >
        {/* Logo area */}
        <div className="h-24 sm:h-28 flex items-center justify-center p-4 bg-muted/20 group-hover:bg-muted/40 transition-colors">
          {logoSrc ? (
            <img
              src={logoSrc}
              alt={set.name}
              className="max-h-full max-w-full object-contain drop-shadow-sm group-hover:scale-105 transition-transform duration-200"
              loading="lazy"
              onError={() => {
                if (!triedRemote.current && set.images.logo) {
                  triedRemote.current = true;
                  setLogoSrc(set.images.logo);
                } else {
                  setLogoSrc(null);
                }
              }}
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
