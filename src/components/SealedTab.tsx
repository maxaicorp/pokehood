import { useState, useEffect, useRef, useMemo } from "react";
import {
  fetchSealedProducts,
  getSealedMarketPrice,
  getSealedTrends,
  SealedProduct,
} from "@/lib/sealed-store";
import { formatPrice } from "@/lib/pokemon-api";
import { formatPct } from "@/lib/price-snapshots";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { motion } from "framer-motion";

const PAGE_SIZE = 50;

type SortCol = "price" | "1d" | "7d" | null;

interface SealedTabProps {
  typeFilter: string;
}

export default function SealedTab({ typeFilter }: SealedTabProps) {
  const [products, setProducts] = useState<SealedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(true);
  const loadingMore = useRef(false);
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Reset when filter changes
  useEffect(() => {
    setProducts([]);
    setPage(1);
    setHasMore(true);
    setIsLoading(true);
  }, [typeFilter]);

  // Fetch data
  useEffect(() => {
    let cancelled = false;
    loadingMore.current = true;

    fetchSealedProducts({
      page,
      pageSize: PAGE_SIZE,
      type: typeFilter,
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
  }, [page, typeFilter]);

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

  const sortedProducts = useMemo(() => {
    if (!sortCol) return products;
    return [...products].sort((a, b) => {
      let va: number | null, vb: number | null;
      if (sortCol === "price") {
        va = getSealedMarketPrice(a);
        vb = getSealedMarketPrice(b);
      } else {
        const ta = getSealedTrends(a);
        const tb = getSealedTrends(b);
        va = sortCol === "1d" ? ta.pct1d : ta.pct7d;
        vb = sortCol === "1d" ? tb.pct1d : tb.pct7d;
      }
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return sortDir === "asc" ? va - vb : vb - va;
    });
  }, [products, sortCol, sortDir]);

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

  return (
    <div>
      {/* Table header */}
      <div className="hidden sm:grid grid-cols-[40px_1fr_160px_100px_72px_72px] gap-4 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground">
        <span>#</span>
        <span>Product</span>
        <span>Set</span>
        <button onClick={() => handleSort("price")} className="flex items-center justify-end hover:text-foreground transition-colors">
          Market Price <SortIcon col="price" />
        </button>
        <button onClick={() => handleSort("1d")} className="flex items-center justify-end hover:text-foreground transition-colors">
          24h % <SortIcon col="1d" />
        </button>
        <button onClick={() => handleSort("7d")} className="flex items-center justify-end hover:text-foreground transition-colors">
          7d % <SortIcon col="7d" />
        </button>
      </div>

      {sortedProducts.length === 0 && !isLoading ? (
        <div className="py-16 text-center text-muted-foreground">
          <Package className="w-12 h-12 mx-auto mb-4 opacity-40" />
          <p className="text-sm">No sealed products found for this filter.</p>
        </div>
      ) : (
        <div>
          {sortedProducts.map((product, i) => {
            const price = getSealedMarketPrice(product);
            const { pct1d, pct7d } = getSealedTrends(product);
            const f1d = formatPct(pct1d);
            const f7d = formatPct(pct7d);
            const image = product.images?.[0];
            const variantLabel =
              product.variants.length > 1
                ? `${product.variants.length} variants`
                : product.variants[0]?.name ?? "";

            return (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.008, 0.3) }}
                className="grid grid-cols-[24px_1fr_auto] sm:grid-cols-[40px_1fr_160px_100px_72px_72px] gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 border-b border-border/50 last:border-0 items-center hover:bg-muted/30 transition-colors"
              >
                <span className="text-sm font-mono text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  {image ? (
                    <img
                      src={image.small}
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
                <p className="hidden sm:block text-sm text-muted-foreground truncate">{product.expansion.name}</p>
                <p className="text-right text-sm font-semibold text-foreground tabular-nums">
                  {price !== null ? formatPrice(price) : "—"}
                </p>
                <p className={`hidden sm:block text-right text-xs font-medium tabular-nums ${f1d.className}`}>{f1d.text}</p>
                <p className={`hidden sm:block text-right text-xs font-medium tabular-nums ${f7d.className}`}>{f7d.text}</p>
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
