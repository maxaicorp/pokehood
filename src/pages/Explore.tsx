import { useState, useEffect, useRef, useCallback } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  getWishlists, createWishlist, addCardToWishlist, getAllWishlistCardIds,
} from "@/lib/wishlist-store";
import {
  searchCardsAdvanced,
  getLatestCards,
  getSets,
  getMarketPrice,
  getLowPrice,
  formatPrice,
  enrichPageWithPricing,
  PokemonCard,
  PokemonSet,
  CARD_RARITIES,
  CARD_TYPES,
  SORT_OPTIONS,
  CONDITIONS,
  PRODUCT_TYPES,
} from "@/lib/pokemon-api";
import { addToCollection } from "@/lib/collection-store";
import { recordSearchHits, recordCollectionAdd, recordWishlistAdd } from "@/lib/card-stats-store";
import AppHeader from "@/components/AppHeader";
import { MagicCard } from "@/components/ui/magic-card";
import { RetroGrid } from "@/components/ui/retro-grid";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, Plus, X, Grid3X3, LayoutList,
  ChevronDown, Filter, TrendingUp, TrendingDown, CheckCircle2, Heart,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

type ViewMode = "grid" | "list";

export default function Explore() {
  const { user, loading, isPro, limits } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") || "";
  const urlSet = searchParams.get("set") || "";
  const [query, setQuery] = useState(urlQuery);
  const [searchTerm, setSearchTerm] = useState(urlQuery);
  const [selectedSet, setSelectedSet] = useState(urlSet);
  const [selectedRarity, setSelectedRarity] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("number");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [productType, setProductType] = useState("");
  const [addingCards, setAddingCards] = useState(new Set<string>());

  // Infinite scroll mode when a set is selected
  const isSetMode = !!selectedSet;
  const PAGE_SIZE = 35;

  const { data: setsData } = useQuery({
    queryKey: ["pokemon-sets"],
    queryFn: getSets,
    staleTime: 5 * 60_000,
  });

  // Always pass productType — default to "tcg" so TCG Pocket never shows unless explicitly chosen
  const effectiveProductType = productType || "tcg";

  // Paginated query (used when NO set is selected)
  const { data: cardsData, isLoading: isPaginatedLoading } = useQuery({
    queryKey: ["explore-cards", searchTerm, selectedSet, selectedRarity, selectedTypes, sortBy, page, effectiveProductType],
    queryFn: () =>
      searchCardsAdvanced(
        searchTerm,
        { setId: selectedSet || undefined, rarity: selectedRarity || undefined, types: selectedTypes.length ? selectedTypes : undefined, sortBy, productType: effectiveProductType },
        page,
        PAGE_SIZE
      ),
    staleTime: 60_000,
    enabled: !isSetMode,
  });

  // Infinite scroll query (used when a set IS selected)
  const {
    data: infiniteData,
    isLoading: isInfiniteLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["explore-infinite", searchTerm, selectedSet, selectedRarity, selectedTypes, sortBy, effectiveProductType],
    queryFn: ({ pageParam = 1 }) =>
      searchCardsAdvanced(
        searchTerm,
        { setId: selectedSet || undefined, rarity: selectedRarity || undefined, types: selectedTypes.length ? selectedTypes : undefined, sortBy, productType: effectiveProductType },
        pageParam,
        PAGE_SIZE
      ),
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.data.length, 0);
      return loaded < lastPage.totalCount ? allPages.length + 1 : undefined;
    },
    initialPageParam: 1,
    staleTime: 60_000,
    enabled: isSetMode,
  });

  const isLoading = isSetMode ? isInfiniteLoading : isPaginatedLoading;

  // Sync from URL query param
  useEffect(() => {
    if (urlQuery && urlQuery !== searchTerm) {
      setQuery(urlQuery);
      setSearchTerm(urlQuery);
      setPage(1);
    }
  }, [urlQuery]);

  // Track search hits when results arrive for a search term
  useEffect(() => {
    if (searchTerm && cardsData?.data?.length) {
      recordSearchHits(cardsData.data);
    }
  }, [searchTerm, cardsData?.data]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchTerm(query.trim());
    setPage(1);
  };

  const clearFilters = () => {
    setQuery("");
    setSearchTerm("");
    setSelectedSet("");
    setSelectedRarity("");
    setSelectedTypes([]);
    setSortBy("number");
    setPage(1);
  };

  const getPageNumbers = (current: number, total: number): (number | string)[] => {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: (number | string)[] = [];
    pages.push(1);
    if (current > 3) pages.push("...");
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
      pages.push(i);
    }
    if (current < total - 2) pages.push("...");
    pages.push(total);
    return pages;
  };

  const handleAdd = async (card: PokemonCard) => {
    if (!user) {
      toast.error("Please sign in to add cards.");
      return;
    }
    if (addingCards.has(card.id)) return;
    setAddingCards((prev) => new Set(prev).add(card.id));
    const result = await addToCollection(card, user.id);
    setAddingCards((prev) => {
      const next = new Set(prev);
      next.delete(card.id);
      return next;
    });
    if (result) {
      recordCollectionAdd(card);
      toast.success(`${card.name} added to collection!`);
    } else {
      toast.error("Failed to add card.");
    }
  };

  // Wishlist logic
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

  const handleWishlist = async (card: PokemonCard) => {
    if (!user) { toast.error("Please sign in."); return; }
    let targetWishlist = wishlists[0];
    if (!targetWishlist) {
      try {
        targetWishlist = await createWishlist(user.id, "My Wishlist");
        queryClient.invalidateQueries({ queryKey: ["wishlists"] });
      } catch { toast.error("Failed to create wishlist."); return; }
    }
    if (!isPro) {
      // Check card count limit - approximate via Set size
      if (wishlistedIds.size >= limits.maxWishlistCards) {
        toast.error(`Free tier: max ${limits.maxWishlistCards} wishlist cards. Upgrade to Pro!`);
        return;
      }
    }
    try {
      const ok = await addCardToWishlist(targetWishlist.id, user.id, card);
      if (ok) {
        recordWishlistAdd(card);
        toast.success(`${card.name} added to wishlist!`);
        queryClient.invalidateQueries({ queryKey: ["wishlisted-ids"] });
      } else {
        toast.info("Already in wishlist.");
      }
    } catch { toast.error("Failed to add to wishlist."); }
  };

  const toggleType = (type: string) => {
    setSelectedTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
    setPage(1);
  };

  // Second-pass query: fetch live pricing for the current page in parallel
  const cardIds = (cardsData?.data || []).map((c) => c.id).join(",");
  const { data: pricedCards, isLoading: isPricingLoading } = useQuery({
    queryKey: ["card-prices", cardIds],
    queryFn: () => enrichPageWithPricing(cardsData?.data ?? []),
    enabled: !!cardsData?.data?.length,
    staleTime: 5 * 60_000,
  });

  const cards = pricedCards || cardsData?.data || [];
  const totalCount = cardsData?.totalCount || 0;
  const totalPages = Math.ceil(totalCount / 35);

  const activeFilterCount = [selectedSet, selectedRarity, ...(selectedTypes.length ? ["t"] : [])].filter(Boolean).length;

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><span className="w-6 h-6 animate-spin border-2 border-primary border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <AppHeader activePage="explore" />

      {/* Search Bar */}
      <div className="border-b border-border/50 bg-card/50">
        <div className="container py-4 sm:py-6 px-4 sm:px-8">
          <h2 className="font-display font-bold text-lg sm:text-xl text-foreground mb-3 sm:mb-4">Find a Product</h2>
          <form onSubmit={handleSearch} className="flex gap-2 sm:gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10 bg-background border-border h-10 sm:h-11 text-sm"
              />
            </div>
            <Button type="submit" variant="hero" className="px-4 sm:px-6 h-10 sm:h-11">
              Search
            </Button>
            <Button type="button" variant="ghost" onClick={clearFilters} className="hidden sm:inline-flex">
              Clear
            </Button>
          </form>
        </div>
      </div>

      <div className="container py-4 sm:py-6 px-4 sm:px-8">
        {/* Sort bar */}
        <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden shrink-0"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="w-4 h-4 mr-1" />
              Filters
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
            {(selectedSet || selectedRarity || selectedTypes.length > 0) && (
              <div className="flex items-center gap-1 flex-wrap">
                {selectedSet && setsData?.data && (
                  <Badge variant="secondary" className="gap-1 cursor-pointer text-xs" onClick={() => { setSelectedSet(""); setPage(1); }}>
                    {setsData.data.find((s: PokemonSet) => s.id === selectedSet)?.name}
                    <X className="w-3 h-3" />
                  </Badge>
                )}
                {selectedRarity && (
                  <Badge variant="secondary" className="gap-1 cursor-pointer text-xs" onClick={() => { setSelectedRarity(""); setPage(1); }}>
                    {selectedRarity}
                    <X className="w-3 h-3" />
                  </Badge>
                )}
                {selectedTypes.map(t => (
                  <Badge key={t} variant="secondary" className="gap-1 cursor-pointer text-xs" onClick={() => toggleType(t)}>
                    {t}
                    <X className="w-3 h-3" />
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground hidden md:inline">Sort by:</span>
              <Select value={sortBy} onValueChange={(v) => { setSortBy(v); setPage(1); }}>
                <SelectTrigger className="w-[130px] sm:w-[160px] bg-background text-xs sm:text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="hidden sm:flex border border-border rounded-md">
              <Button variant={viewMode === "grid" ? "secondary" : "ghost"} size="icon" className="h-9 w-9 rounded-r-none" onClick={() => setViewMode("grid")}>
                <Grid3X3 className="w-4 h-4" />
              </Button>
              <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="icon" className="h-9 w-9 rounded-l-none" onClick={() => setViewMode("list")}>
                <LayoutList className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Sidebar Filters — slide-over on mobile */}
          {showFilters && (
            <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setShowFilters(false)}>
              <div className="absolute inset-0 bg-black/50" />
              <aside
                className="absolute left-0 top-0 bottom-0 w-72 bg-background border-r border-border p-6 space-y-6 overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-display font-bold text-foreground">Filters</h3>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowFilters(false)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <FilterControls
                  productType={productType}
                  setProductType={setProductType}
                  selectedSet={selectedSet}
                  setSelectedSet={setSelectedSet}
                  selectedRarity={selectedRarity}
                  setSelectedRarity={setSelectedRarity}
                  selectedTypes={selectedTypes}
                  toggleType={toggleType}
                  setsData={setsData}
                  setPage={setPage}
                />
              </aside>
            </div>
          )}

          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-64 shrink-0 space-y-6">
            <FilterControls
              productType={productType}
              setProductType={setProductType}
              selectedSet={selectedSet}
              setSelectedSet={setSelectedSet}
              selectedRarity={selectedRarity}
              setSelectedRarity={setSelectedRarity}
              selectedTypes={selectedTypes}
              toggleType={toggleType}
              setsData={setsData}
              setPage={setPage}
            />
          </aside>

          {/* Card Grid */}
          <div className="flex-1 min-w-0">
            {isLoading ? (
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
                      <Skeleton className="h-5 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : cards.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-muted-foreground text-lg">No products found</p>
                <p className="text-muted-foreground text-sm mt-1">Try adjusting your search or filters</p>
              </div>
            ) : viewMode === "grid" ? (
              <CardGrid cards={cards} onAdd={handleAdd} onWishlist={handleWishlist} wishlistedIds={wishlistedIds} isPricingLoading={isPricingLoading} />
            ) : (
              <CardList cards={cards} onAdd={handleAdd} onWishlist={handleWishlist} wishlistedIds={wishlistedIds} isPricingLoading={isPricingLoading} />
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1 mt-8 flex-wrap">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</Button>
                {getPageNumbers(page, totalPages).map((p, i) =>
                  p === "..." ? (
                    <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground text-sm">…</span>
                  ) : (
                    <Button key={p} variant={p === page ? "default" : "outline"} size="sm" className="h-8 w-8 p-0" onClick={() => setPage(p as number)}>{p}</Button>
                  )
                )}
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>›</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Extracted filter controls
function FilterControls({
  productType, setProductType, selectedSet, setSelectedSet,
  selectedRarity, setSelectedRarity, selectedTypes, toggleType,
  setsData, setPage,
}: {
  productType: string; setProductType: (v: string) => void;
  selectedSet: string; setSelectedSet: (v: string) => void;
  selectedRarity: string; setSelectedRarity: (v: string) => void;
  selectedTypes: string[]; toggleType: (t: string) => void;
  setsData: any; setPage: (p: number) => void;
}) {
  return (
    <>
      <div>
        <h3 className="font-display font-semibold text-foreground text-sm mb-2">Product</h3>
        <p className="text-xs text-muted-foreground mb-2">Choose product line.</p>
        <Select value={productType || "all"} onValueChange={(v) => { setProductType(v === "all" ? "" : v); setSelectedSet(""); setPage(1); }}>
          <SelectTrigger className="bg-background"><SelectValue placeholder="All Products" /></SelectTrigger>
          <SelectContent>
            {PRODUCT_TYPES.map(p => (<SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <h3 className="font-display font-semibold text-foreground text-sm mb-2">Set</h3>
        <p className="text-xs text-muted-foreground mb-2">Filter by set.</p>
        <Select value={selectedSet} onValueChange={(v) => { setSelectedSet(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="bg-background"><SelectValue placeholder="All Sets" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sets</SelectItem>
            {setsData?.data
              ?.filter((s: any) => {
                const isPocket = s.isOnlineOnly;
              const ept = productType || "tcg";
                return ept === "pocket" ? isPocket : !isPocket;
              })
              .map((s: any) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <h3 className="font-display font-semibold text-foreground text-sm mb-2">Rarity</h3>
        <p className="text-xs text-muted-foreground mb-2">Filter by card rarity.</p>
        <Select value={selectedRarity} onValueChange={(v) => { setSelectedRarity(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="bg-background"><SelectValue placeholder="All Rarities" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Rarities</SelectItem>
            {CARD_RARITIES.map(r => (<SelectItem key={r} value={r}>{r}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <h3 className="font-display font-semibold text-foreground text-sm mb-2">Type</h3>
        <p className="text-xs text-muted-foreground mb-3">Select energy types.</p>
        <div className="space-y-2">
          {CARD_TYPES.map(type => (
            <label key={type} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox checked={selectedTypes.includes(type)} onCheckedChange={() => toggleType(type)} />
              <span className="text-foreground">{type}</span>
            </label>
          ))}
        </div>
      </div>
    </>
  );
}

// Grid view component
function CardGrid({ cards, onAdd, onWishlist, wishlistedIds, isPricingLoading }: { cards: PokemonCard[]; onAdd: (c: PokemonCard) => void; onWishlist: (c: PokemonCard) => void; wishlistedIds: Set<string>; isPricingLoading?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
      <AnimatePresence mode="popLayout">
        {cards.map((card, i) => {
          const price = getMarketPrice(card);
          const isWishlisted = wishlistedIds.has(card.id);

          return (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: i * 0.02 }}
              whileHover={{ y: -4 }}
              className="h-full cursor-pointer"
              onClick={() => navigate(`/card/${card.id}`)}
            >
              <MagicCard className="group flex flex-col h-full rounded-xl bg-card border-border/50 overflow-hidden">
                <div className="relative bg-background/50 p-1.5 sm:p-2">
                  <img src={card.images.small} alt={card.name} className="w-full rounded-lg" loading="lazy" />
                  <button
                    onClick={(e) => { e.stopPropagation(); onWishlist(card); }}
                    className={`absolute top-2.5 right-2.5 z-10 w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                      isWishlisted
                        ? "bg-destructive text-destructive-foreground"
                        : "bg-background/80 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                    }`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${isWishlisted ? "fill-current" : ""}`} />
                  </button>
                </div>
                <div className="p-2 sm:p-3 space-y-0.5 sm:space-y-1 flex-1 flex flex-col justify-end">
                  <p className="text-xs sm:text-sm font-semibold text-foreground truncate">{card.name}</p>
                  <p className="text-[10px] sm:text-xs text-primary/80 truncate">{card.set.name}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {card.rarity && <span className="text-[9px] sm:text-[10px] text-muted-foreground">{card.rarity}</span>}
                    {card.number && <span className="text-[9px] sm:text-[10px] text-muted-foreground">• {card.number}/{card.set.printedTotal}</span>}
                  </div>
                  <div className="flex items-center justify-between pt-1 mt-auto">
                    {isPricingLoading
                      ? <Skeleton className="h-4 w-12" />
                      : <span className="text-xs sm:text-sm font-bold text-foreground">{formatPrice(price)}</span>
                    }
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity rounded-full border border-border/50 hover:border-primary hover:text-primary z-10"
                      onClick={(e) => { e.stopPropagation(); onAdd(card); }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </MagicCard>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// List view component
function CardList({ cards, onAdd, onWishlist, wishlistedIds, isPricingLoading }: { cards: PokemonCard[]; onAdd: (c: PokemonCard) => void; onWishlist: (c: PokemonCard) => void; wishlistedIds: Set<string>; isPricingLoading?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-2">
      {cards.map((card, i) => {
        const price = getMarketPrice(card);
        const isWishlisted = wishlistedIds.has(card.id);
        return (
          <motion.div
            key={card.id}
            className="flex items-center gap-3 sm:gap-4 p-2.5 sm:p-3 rounded-xl bg-card border border-border/50 card-shine group cursor-pointer"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.02 }}
            onClick={() => navigate(`/card/${card.id}`)}
          >
            <img src={card.images.small} alt={card.name} className="w-10 sm:w-12 rounded-md" loading="lazy" />
            <div className="flex-1 min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-foreground truncate">{card.name}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                {card.set.name} • {card.rarity || "Unknown"}
              </p>
            </div>
            {isPricingLoading
              ? <Skeleton className="h-4 w-14 shrink-0" />
              : <span className="text-xs sm:text-sm font-bold text-foreground whitespace-nowrap">{formatPrice(price)}</span>
            }
            <button
              onClick={(e) => { e.stopPropagation(); onWishlist(card); }}
              className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                isWishlisted ? "text-destructive" : "text-muted-foreground hover:text-destructive"
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${isWishlisted ? "fill-current" : ""}`} />
            </button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 sm:h-8 sm:w-8 rounded-full border border-border/50 hover:border-primary hover:text-primary shrink-0"
              onClick={(e) => { e.stopPropagation(); onAdd(card); }}
            >
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </Button>
          </motion.div>
        );
      })}
    </div>
  );
}
