import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchSealedProducts,
  getSealedMarketPrice,
  getSealedTrends,
  SEALED_TYPES,
  SealedProduct,
} from "@/lib/sealed-store";
import { formatPrice } from "@/lib/pokemon-api";
import { formatPct } from "@/lib/price-snapshots";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Package, Search, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";

const PAGE_SIZE = 50;

export default function SealedTab() {
  const [products, setProducts] = useState<SealedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(true);
  const loadingMore = useRef(false);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Reset when filters change
  useEffect(() => {
    setProducts([]);
    setPage(1);
    setHasMore(true);
    setIsLoading(true);
  }, [typeFilter, debouncedQuery]);

  // Fetch data
  useEffect(() => {
    let cancelled = false;
    loadingMore.current = true;

    fetchSealedProducts({
      page,
      pageSize: PAGE_SIZE,
      type: typeFilter,
      query: debouncedQuery || undefined,
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
  }, [page, typeFilter, debouncedQuery]);

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

  const totalValue = products.reduce((sum, p) => sum + (getSealedMarketPrice(p) ?? 0), 0);

  if (isLoading && products.length === 0) {
    return (
      <div>
        <div className="flex flex-col sm:flex-row gap-3 px-4 py-3 border-b border-border">
          <Skeleton className="h-9 w-full sm:w-[200px]" />
          <Skeleton className="h-9 w-full sm:w-[160px]" />
        </div>
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
      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sealed products..."
            className="pl-9 bg-background"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-[180px] bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEALED_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-right sm:ml-auto">
          <p className="text-xs text-muted-foreground">{totalCount.toLocaleString()} products</p>
          {totalValue > 0 && (
            <p className="text-sm font-semibold text-foreground">{formatPrice(totalValue)}</p>
          )}
        </div>
      </div>

      {/* Table header */}
      <div className="hidden sm:grid grid-cols-[40px_1fr_160px_100px_72px_72px] gap-4 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground">
        <span>#</span>
        <span>Product</span>
        <span>Set</span>
        <span className="text-right">Market Price</span>
        <span className="text-right">24h %</span>
        <span className="text-right">7d %</span>
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
                {/* Rank */}
                <span className="text-sm font-mono text-muted-foreground tabular-nums">
                  {i + 1}
                </span>

                {/* Product info */}
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

                {/* Set (desktop) */}
                <p className="hidden sm:block text-sm text-muted-foreground truncate">
                  {product.expansion.name}
                </p>

                {/* Price */}
                <p className="text-right text-sm font-semibold text-foreground tabular-nums">
                  {price !== null ? formatPrice(price) : "—"}
                </p>

                {/* 24h */}
                <p className={`hidden sm:block text-right text-xs font-medium tabular-nums ${f1d.className}`}>
                  {f1d.text}
                </p>

                {/* 7d */}
                <p className={`hidden sm:block text-right text-xs font-medium tabular-nums ${f7d.className}`}>
                  {f7d.text}
                </p>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-4" />
      {!hasMore && products.length > 0 && (
        <p className="text-center text-xs text-muted-foreground py-4">
          All {totalCount.toLocaleString()} products loaded
        </p>
      )}
    </div>
  );
}
