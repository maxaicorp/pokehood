import { useState, useEffect, useRef } from "react";
import {
  fetchSealedProducts,
  getSealedMarketPrice,
  getSealedTrends,
  SealedProduct,
} from "@/lib/sealed-store";
import { formatPrice } from "@/lib/pokemon-api";
import { formatPct } from "@/lib/price-snapshots";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Package, ArrowUpDown, ArrowUp, ArrowDown, ShoppingCart, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import SealedGridView from "@/components/SealedGridView";
import type { ViewMode } from "@/components/ViewToggle";

const PAGE_SIZE = 50;

type SortCol = "price" | "1d" | "7d";

interface SealedTabProps {
  typeFilter: string;
  viewMode?: ViewMode;
}

export default function SealedTab({ typeFilter, viewMode = "list" }: SealedTabProps) {
  const [products, setProducts] = useState<SealedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(true);
  const loadingMore = useRef(false);
  const [sortCol, setSortCol] = useState<SortCol>("price");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Reset when filter or sort changes
  useEffect(() => {
    setProducts([]);
    setPage(1);
    setHasMore(true);
    setIsLoading(true);
  }, [typeFilter, sortCol, sortDir]);

  // Fetch data (sorting happens server-side in sealed-store)
  useEffect(() => {
    let cancelled = false;
    loadingMore.current = true;

    fetchSealedProducts({
      page,
      pageSize: PAGE_SIZE,
      type: typeFilter,
      sortCol,
      sortDir,
    }).then((result) => {
      if (cancelled) return;
      loadingMore.current = false;
      setTotalCount(result.totalCount);

      if (page === 1) {
        setProducts(result.products);
      } else {
        setProducts((prev) => [...prev, ...result.products]);
      }

      setHasMore(result.products.length >= PAGE_SIZE);
      setIsLoading(false);
    });

    return () => { cancelled = true; };
  }, [page, typeFilter, sortCol, sortDir]);

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !loadingMore.current) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, products.length]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  if (isLoading && products.length === 0) {
    return (
      <div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50">
            <Skeleton className="h-4 w-6" />
            <Skeleton className="w-14 h-14 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-20 ml-auto" />
          </div>
        ))}
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div>
        <SealedGridView products={products} />
        <div ref={sentinelRef} className="h-4" />
        {!hasMore && products.length > 0 && (
          <p className="text-center text-xs text-muted-foreground py-4">
            All {totalCount.toLocaleString()} products loaded
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Table header */}
      <div className="hidden sm:grid grid-cols-[40px_1fr_160px_100px_72px_72px_36px] gap-4 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground">
        <span>#</span>
        <span>Product</span>
        <span>Set</span>
        <button onClick={() => handleSort("price")} className="flex items-center justify-end hover:text-foreground transition-colors">
          Price <SortIcon col="price" />
        </button>
        <button onClick={() => handleSort("1d")} className="flex items-center justify-end hover:text-foreground transition-colors">
          24h % <SortIcon col="1d" />
        </button>
        <button onClick={() => handleSort("7d")} className="flex items-center justify-end hover:text-foreground transition-colors">
          7d % <SortIcon col="7d" />
        </button>
        <span />
      </div>

      {products.length === 0 && !isLoading ? (
        <div className="py-16 text-center text-muted-foreground">
          <Package className="w-12 h-12 mx-auto mb-4 opacity-40" />
          <p className="text-sm">No sealed products found for this filter.</p>
        </div>
      ) : (
        <div>
          {products.map((product, i) => {
            const price = getSealedMarketPrice(product);
            const { pct1d, pct7d } = getSealedTrends(product);
            const f1d = formatPct(pct1d);
            const f7d = formatPct(pct7d);
            const image = product.imageSmall;
            const variantLabel =
              product.variants.length > 1
                ? `${product.variants.length} variants`
                : product.variants[0]?.name ?? "";

            const buyQuery = encodeURIComponent(`${product.name} pokemon`);
            const buyLinks = [
              { label: "TCGPlayer", url: `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(product.name)}` },
              { label: "eBay", url: `https://www.ebay.com/sch/i.html?_nkw=${buyQuery}` },
              { label: "Amazon", url: `https://www.amazon.com/s?k=${buyQuery}` },
            ];

            return (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.008, 0.3) }}
                className="grid grid-cols-[24px_1fr_auto_auto] sm:grid-cols-[40px_1fr_160px_100px_72px_72px_36px] gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 border-b border-border/50 last:border-0 items-center hover:bg-muted/30 transition-colors"
              >
                <span className="text-sm font-mono text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  {image ? (
                    <img
                      src={image}
                      alt={product.name}
                      className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg object-cover shrink-0 shadow-sm bg-muted"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Package className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{product.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{product.type}</span>
                      {variantLabel && variantLabel !== "normal" && (
                        <>
                          <span>·</span>
                          <span className="truncate">{variantLabel}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <p className="hidden sm:block text-sm text-muted-foreground truncate">{product.expansionName}</p>
                <div className="flex items-center justify-end sm:contents">
                  <p className="text-right text-sm font-semibold text-foreground tabular-nums">
                    {price !== null ? formatPrice(price) : "—"}
                  </p>
                  <p className={`hidden sm:block text-right text-xs font-medium tabular-nums ${f1d.className}`}>{f1d.text}</p>
                  <p className={`hidden sm:block text-right text-xs font-medium tabular-nums ${f7d.className}`}>{f7d.text}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 rounded-full border border-border/50 hover:border-primary hover:text-primary shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {buyLinks.map((link) => (
                      <DropdownMenuItem key={link.label} asChild>
                        <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-4">
                          {link.label}
                          <ExternalLink className="w-3.5 h-3.5 opacity-50" />
                        </a>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </motion.div>
            );
          })}
        </div>
      )}

      <div ref={sentinelRef} className="h-4" />
      {!hasMore && products.length > 0 && (
        <p className="text-center text-xs text-muted-foreground py-4">
          All {totalCount.toLocaleString()} products loaded
        </p>
      )}
    </div>
  );
}
