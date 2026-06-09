import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, TrendingUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { searchCardsAdvanced, searchCatalog, PokemonCard } from "@/lib/pokemon-api";
import { cardPath } from "@/lib/slug";
import CardImage from "@/components/CardImage";

interface SearchResult {
  id: string;
  name: string;
  localId: string;
  image?: string;
  set?: { id: string; name: string };
  rarity?: string;
  kind?: "card" | "sealed";
}

function mapCard(c: PokemonCard): SearchResult {
  return {
    id: c.id,
    name: c.name,
    localId: c.number,
    image: c.images.small,
    set: { id: c.set.id, name: c.set.name },
    rarity: c.rarity,
  };
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  // Guards against out-of-order async responses: rapid typing fires several
  // searches and whichever RESOLVES last would otherwise win, so a slower
  // earlier query could clobber newer results. We only apply a response if its
  // query is still the latest one issued.
  const latestQuery = useRef("");

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const searchCards = async (q: string) => {
    if (q.length < 2) { setResults([]); latestQuery.current = q; return; }
    latestQuery.current = q;
    setLoading(true);
    try {
      // DB-backed, typo-tolerant, includes sealed products. Falls back to the
      // client card index if the search_catalog RPC isn't deployed yet.
      const db = await searchCatalog(q, 8);
      let mapped: SearchResult[];
      if (db) {
        mapped = db.map((r) => ({
          id: r.id,
          name: r.name,
          localId: "",
          image: r.image || undefined,
          set: { id: "", name: r.setName },
          kind: r.kind,
        }));
      } else {
        const { data } = await searchCardsAdvanced(q, {}, 1, 8);
        mapped = data.map(mapCard);
      }
      if (latestQuery.current !== q) return; // a newer query superseded this one
      setResults(mapped);
      setSelectedIdx(0);
    } catch {
      if (latestQuery.current === q) setResults([]);
    }
    if (latestQuery.current === q) setLoading(false);
  };

  const handleChange = (val: string) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchCards(val), 150);
  };

  const handleSelect = (card: SearchResult) => {
    setOpen(false);
    setQuery("");
    setResults([]);
    if (card.kind === "sealed") {
      navigate(`/sealed/${card.id}`);
      return;
    }
    // Cards: use the canonical /sets/:slug/:cardSlug path when we have a set
    // name AND a card number; otherwise the legacy /card/:id route (it 301s to
    // the canonical URL once the card loads). DB results carry no number, so
    // they take the legacy path.
    if (card.set?.name && card.localId) {
      navigate(cardPath(card.set, { name: card.name, number: card.localId }));
    } else {
      navigate(`/card/${card.id}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (results[selectedIdx]) {
        handleSelect(results[selectedIdx]);
      } else {
        handleSearchSubmit();
      }
    }
  };

  const handleSearchSubmit = () => {
    if (query.trim()) {
      setOpen(false);
      navigate(`/explore?q=${encodeURIComponent(query.trim())}`);
      setQuery("");
      setResults([]);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className={cn(
          "sm:hidden flex items-center justify-center w-9 h-9 rounded-full text-[hsl(var(--header-foreground))] hover:bg-[hsl(var(--header-foreground)_/_0.1)] transition-colors"
        )}
      >
        <Search className="w-4 h-4" />
      </button>

      <div
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className={cn(
          "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border cursor-text transition-colors min-w-[220px] lg:min-w-[280px]",
          open ? "ring-2 ring-primary/30 border-primary/50 bg-background" : "border-[hsl(var(--header-foreground)_/_0.18)] bg-[hsl(var(--header-foreground)_/_0.08)] hover:bg-[hsl(var(--header-foreground)_/_0.15)]"
        )}
      >
        <Search className={cn("w-4 h-4 shrink-0", open ? "text-muted-foreground" : "text-[hsl(var(--header-foreground)_/_0.65)]")} />
        {open ? (
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search cards..."
            className="bg-transparent outline-none text-sm w-full text-foreground placeholder:text-muted-foreground"
          />
        ) : (
          <span className="text-sm text-[hsl(var(--header-foreground)_/_0.7)] select-none">Search cards...</span>
        )}
        {open && query && (
          <button onClick={(e) => { e.stopPropagation(); setQuery(""); setResults([]); }} className="text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="sm:hidden fixed inset-0 z-[60] bg-background"
          >
            <div className="flex items-center gap-2 px-4 h-14 border-b border-border/50 bg-background">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => handleChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search cards..."
                autoFocus
                className="bg-transparent outline-none text-sm w-full text-foreground placeholder:text-muted-foreground"
              />
              <button onClick={() => { setOpen(false); setQuery(""); setResults([]); }} className="text-muted-foreground hover:text-foreground p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(100vh-3.5rem)] bg-background">
              <SearchResults
                results={results}
                loading={loading}
                query={query}
                selectedIdx={selectedIdx}
                onSelect={handleSelect}
                onSearchAll={handleSearchSubmit}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (query.length >= 2 || results.length > 0) && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="hidden sm:block absolute top-full left-0 right-0 mt-2 rounded-xl border border-border/50 bg-popover shadow-xl overflow-hidden z-50"
          >
            <SearchResults
              results={results}
              loading={loading}
              query={query}
              selectedIdx={selectedIdx}
              onSelect={handleSelect}
              onSearchAll={handleSearchSubmit}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SearchResults({
  results, loading, query, selectedIdx, onSelect, onSearchAll,
}: {
  results: SearchResult[];
  loading: boolean;
  query: string;
  selectedIdx: number;
  onSelect: (card: SearchResult) => void;
  onSearchAll: () => void;
}) {
  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 animate-pulse">
            <div className="w-10 h-14 rounded bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (query.length >= 2 && results.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No cards found for "{query}"
      </div>
    );
  }

  if (results.length === 0) return null;

  return (
    <div className="bg-background">
      <div className="px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        Cards
      </div>
      {results.map((card, i) => (
        <button
          key={card.id}
          onClick={() => onSelect(card)}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent/50 transition-colors",
            i === selectedIdx && "bg-accent/50"
          )}
        >
          {card.image ? (
            <CardImage src={card.image} alt="" className="w-10 h-14 object-contain rounded" />
          ) : (
            <div className="w-10 h-14 rounded bg-muted flex items-center justify-center">
              <Search className="w-4 h-4 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{card.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {card.set?.name || card.id}{card.localId ? ` · #${card.localId}` : ""}
            </p>
          </div>
          {card.kind === "sealed" ? (
            <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
              Sealed
            </span>
          ) : card.rarity ? (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
              {card.rarity}
            </span>
          ) : null}
        </button>
      ))}
      <button
        onClick={onSearchAll}
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm text-primary hover:bg-accent/30 border-t border-border/50 transition-colors"
      >
        <TrendingUp className="w-4 h-4" />
        View all results for "{query}"
      </button>
    </div>
  );
}
