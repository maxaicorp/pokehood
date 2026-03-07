import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  searchCardsAdvanced,
  getLatestCards,
  getSets,
  getMarketPrice,
  getLowPrice,
  formatPrice,
  PokemonCard,
  PokemonSet,
  CARD_RARITIES,
  CARD_TYPES,
  SORT_OPTIONS,
  CONDITIONS,
  PRODUCT_TYPES,
  TCGP_SERIES_IDS,
} from "@/lib/pokemon-api";
import { addToCollection } from "@/lib/collection-store";
import { parseCsv, resolveImport, CsvRow } from "@/lib/csv-import";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, Plus, Loader2, ArrowLeft, Upload, X, Grid3X3, LayoutList,
  ChevronDown, Filter, TrendingUp, TrendingDown, CheckCircle2
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";

type ViewMode = "grid" | "list";

export default function Explore() {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSet, setSelectedSet] = useState("");
  const [selectedRarity, setSelectedRarity] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("-set.releaseDate");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showFilters, setShowFilters] = useState(true);
  const [page, setPage] = useState(1);
  const [productType, setProductType] = useState("");

  // Import state
  const [importOpen, setImportOpen] = useState(false);
  const [importParsed, setImportParsed] = useState<CsvRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch sets for filter
  const { data: setsData } = useQuery({
    queryKey: ["pokemon-sets"],
    queryFn: getSets,
    staleTime: 5 * 60_000,
  });

  // Fetch cards
  const hasFilters = searchTerm || selectedSet || selectedRarity || selectedTypes.length > 0 || productType;
  const { data: cardsData, isLoading } = useQuery({
    queryKey: ["explore-cards", searchTerm, selectedSet, selectedRarity, selectedTypes, sortBy, page, productType],
    queryFn: () =>
      hasFilters
        ? searchCardsAdvanced(
            searchTerm,
            { setId: selectedSet || undefined, rarity: selectedRarity || undefined, types: selectedTypes.length ? selectedTypes : undefined, sortBy, productType: productType || undefined },
            page,
            35
          )
        : getLatestCards(page, 35),
    staleTime: 60_000,
  });

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
    setSortBy("-set.releaseDate");
    setPage(1);
  };

  const handleAdd = (card: PokemonCard) => {
    addToCollection(card);
    toast.success(`${card.name} added to collection!`);
  };

  const toggleType = (type: string) => {
    setSelectedTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
    setPage(1);
  };

  // CSV Import
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCsv(text);
      if (rows.length === 0) {
        toast.error("Could not parse CSV. Ensure it has a 'Name' column.");
        return;
      }
      setImportParsed(rows);
      setImportOpen(true);
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleImport = async () => {
    setImporting(true);
    setImportProgress({ done: 0, total: importParsed.length });
    try {
      const result = await resolveImport(importParsed);
      let added = 0;
      for (const { row, card } of result.found) {
        addToCollection(card, row.condition || "NM", row.quantity || 1);
        added++;
        setImportProgress({ done: added, total: importParsed.length });
      }
      toast.success(`Imported ${added} cards! ${result.notFound.length} not found.`);
      setImportOpen(false);
      setImportParsed([]);
    } catch {
      toast.error("Import failed. Please try again.");
    }
    setImporting(false);
  };

  const cards = cardsData?.data || [];
  const totalCount = cardsData?.totalCount || 0;
  const totalPages = Math.ceil(totalCount / 20);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/"><ArrowLeft className="w-4 h-4" /></Link>
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-display font-bold text-sm">PV</span>
              </div>
              <span className="font-display font-bold text-lg text-foreground">Explore</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileUpload}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-4 h-4 mr-1" />
              Import CSV
            </Button>
            <Button variant="accent" size="sm" asChild>
              <Link to="/dashboard">My Collection</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Search Bar */}
      <div className="border-b border-border/50 bg-card/50">
        <div className="container py-6">
          <h2 className="font-display font-bold text-xl text-foreground mb-4">Find a Product</h2>
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search any sealed or unsealed product..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10 bg-background border-border h-11"
              />
            </div>
            <Button type="submit" variant="hero" className="px-6">
              Search
            </Button>
            <Button type="button" variant="ghost" onClick={clearFilters}>
              Clear
            </Button>
          </form>
        </div>
      </div>

      <div className="container py-6">
        {/* Sort bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="w-4 h-4 mr-1" />
              Filters
            </Button>
            {(selectedSet || selectedRarity || selectedTypes.length > 0) && (
              <div className="flex items-center gap-1 flex-wrap">
                {selectedSet && setsData?.data && (
                  <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => { setSelectedSet(""); setPage(1); }}>
                    {setsData.data.find(s => s.id === selectedSet)?.name}
                    <X className="w-3 h-3" />
                  </Badge>
                )}
                {selectedRarity && (
                  <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => { setSelectedRarity(""); setPage(1); }}>
                    {selectedRarity}
                    <X className="w-3 h-3" />
                  </Badge>
                )}
                {selectedTypes.map(t => (
                  <Badge key={t} variant="secondary" className="gap-1 cursor-pointer" onClick={() => toggleType(t)}>
                    {t}
                    <X className="w-3 h-3" />
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground hidden sm:inline">Sort by:</span>
              <Select value={sortBy} onValueChange={(v) => { setSortBy(v); setPage(1); }}>
                <SelectTrigger className="w-[160px] bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex border border-border rounded-md">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-9 w-9 rounded-r-none"
                onClick={() => setViewMode("grid")}
              >
                <Grid3X3 className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-9 w-9 rounded-l-none"
                onClick={() => setViewMode("list")}
              >
                <LayoutList className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Sidebar Filters */}
          <aside className={`w-64 shrink-0 space-y-6 ${showFilters ? 'block' : 'hidden'} lg:block`}>
            {/* Product Type */}
            <div>
              <h3 className="font-display font-semibold text-foreground text-sm mb-2">Product</h3>
              <p className="text-xs text-muted-foreground mb-2">Choose product line.</p>
              <Select value={productType || "all"} onValueChange={(v) => { setProductType(v === "all" ? "" : v); setSelectedSet(""); setPage(1); }}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="All Products" />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_TYPES.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sets */}
            <div>
              <h3 className="font-display font-semibold text-foreground text-sm mb-2">Set</h3>
              <p className="text-xs text-muted-foreground mb-2">Filter by set.</p>
              <Select value={selectedSet} onValueChange={(v) => { setSelectedSet(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="All Sets" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sets</SelectItem>
                  {setsData?.data
                    ?.filter(s => {
                      if (!productType) return true;
                      const isPocket = TCGP_SERIES_IDS.includes(s.series.toLowerCase());
                      return productType === "pocket" ? isPocket : !isPocket;
                    })
                    .map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Rarity */}
            <div>
              <h3 className="font-display font-semibold text-foreground text-sm mb-2">Rarity</h3>
              <p className="text-xs text-muted-foreground mb-2">Filter by card rarity.</p>
              <Select value={selectedRarity} onValueChange={(v) => { setSelectedRarity(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="All Rarities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Rarities</SelectItem>
                  {CARD_RARITIES.map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Types */}
            <div>
              <h3 className="font-display font-semibold text-foreground text-sm mb-2">Type</h3>
              <p className="text-xs text-muted-foreground mb-3">Select energy types.</p>
              <div className="space-y-2">
                {CARD_TYPES.map(type => (
                  <label key={type} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={selectedTypes.includes(type)}
                      onCheckedChange={() => toggleType(type)}
                    />
                    <span className="text-foreground">{type}</span>
                  </label>
                ))}
              </div>
            </div>
          </aside>

          {/* Card Grid */}
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <div className={viewMode === "grid"
                ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4"
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
              <CardGrid cards={cards} onAdd={handleAdd} />
            ) : (
              <CardList cards={cards} onAdd={handleAdd} />
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground px-4">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Import Collection</DialogTitle>
          </DialogHeader>
          {importing ? (
            <div className="py-8 text-center space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <p className="text-sm text-muted-foreground">
                Importing {importProgress.done} / {importProgress.total} cards...
              </p>
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Found <span className="text-foreground font-semibold">{importParsed.length}</span> cards in your CSV.
                We'll search for each card and add matches to your collection.
              </p>
              <ScrollArea className="max-h-60 border border-border rounded-lg">
                <div className="p-3 space-y-1">
                  {importParsed.slice(0, 50).map((row, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1">
                      <span className="text-foreground truncate flex-1">{row.name}</span>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        {row.setName && <span className="text-xs truncate max-w-[100px]">{row.setName}</span>}
                        <span className="text-xs">×{row.quantity || 1}</span>
                      </div>
                    </div>
                  ))}
                  {importParsed.length > 50 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      ...and {importParsed.length - 50} more
                    </p>
                  )}
                </div>
              </ScrollArea>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
                <Button variant="hero" onClick={handleImport}>
                  <Upload className="w-4 h-4 mr-1" />
                  Import {importParsed.length} Cards
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Grid view component
function CardGrid({ cards, onAdd }: { cards: PokemonCard[]; onAdd: (c: PokemonCard) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
      <AnimatePresence mode="popLayout">
        {cards.map((card, i) => {
          const price = getMarketPrice(card);
          const low = getLowPrice(card);
          const priceDiff = price && low ? price - low : null;
          const pricePct = price && low && low !== 0 ? ((price - low) / low) * 100 : null;

          return (
            <motion.div
              key={card.id}
              className="group rounded-xl bg-card border border-border/50 overflow-hidden card-shine"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: i * 0.02 }}
              whileHover={{ y: -4 }}
            >
              <div className="relative bg-background/50 p-2">
                <img
                  src={card.images.small}
                  alt={card.name}
                  className="w-full rounded-lg"
                  loading="lazy"
                />
              </div>
              <div className="p-3 space-y-1">
                <p className="text-sm font-semibold text-foreground truncate">{card.name}</p>
                <p className="text-xs text-primary/80 truncate">{card.set.name}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {card.rarity && (
                    <span className="text-[10px] text-muted-foreground">{card.rarity}</span>
                  )}
                  {card.number && (
                    <span className="text-[10px] text-muted-foreground">• {card.number}/{card.set.printedTotal}</span>
                  )}
                </div>
                {card.tcgplayer?.prices && (
                  <p className="text-[10px] text-muted-foreground">
                    {Object.keys(card.tcgplayer.prices).filter(k => k !== "normal").join(", ") || "Normal"}
                  </p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <div className="flex items-center gap-1">
                      {priceDiff !== null && priceDiff > 0 && (
                        <TrendingUp className="w-3 h-3 text-emerald-400" />
                      )}
                      {priceDiff !== null && priceDiff < 0 && (
                        <TrendingDown className="w-3 h-3 text-destructive" />
                      )}
                      <span className="text-base font-bold text-foreground">
                        {formatPrice(price)}
                      </span>
                    </div>
                    {priceDiff !== null && pricePct !== null && (
                      <p className={`text-[10px] font-medium ${priceDiff >= 0 ? "text-emerald-400" : "text-destructive"}`}>
                        {priceDiff >= 0 ? "+" : ""}${Math.abs(priceDiff).toFixed(2)} ({pricePct.toFixed(2)}%)
                      </p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-full border border-border/50 hover:border-primary hover:text-primary transition-all"
                    onClick={() => onAdd(card)}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// List view component
function CardList({ cards, onAdd }: { cards: PokemonCard[]; onAdd: (c: PokemonCard) => void }) {
  return (
    <div className="space-y-2">
      {cards.map((card, i) => {
        const price = getMarketPrice(card);
        return (
          <motion.div
            key={card.id}
            className="flex items-center gap-4 p-3 rounded-xl bg-card border border-border/50 card-shine group"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.02 }}
          >
            <img
              src={card.images.small}
              alt={card.name}
              className="w-12 rounded-md"
              loading="lazy"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{card.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {card.set.name} • {card.rarity || "Unknown"} • {card.number}/{card.set.printedTotal}
              </p>
            </div>
            <span className="text-sm font-bold text-foreground whitespace-nowrap">
              {formatPrice(price)}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 rounded-full border border-border/50 hover:border-primary hover:text-primary shrink-0"
              onClick={() => onAdd(card)}
            >
              <Plus className="w-4 h-4" />
            </Button>
          </motion.div>
        );
      })}
    </div>
  );
}
