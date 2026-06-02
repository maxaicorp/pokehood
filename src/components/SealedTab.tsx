import { useState, useEffect, useRef, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  fetchSealedProducts,
  getSealedMarketPrice,
  getSealedTrends,
  SealedProduct,
} from "@/lib/sealed-store";
import { formatPrice } from "@/lib/pokemon-api";
import { formatPct } from "@/lib/price-snapshots";
import { addSealedToCollection } from "@/lib/collection-store";
import { toastAddedToInventory } from "@/lib/inventory-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, ArrowUpDown, ArrowUp, ArrowDown, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import SealedGridView from "@/components/SealedGridView";
import type { ViewMode } from "@/components/ViewToggle";

const PAGE_SIZE = 50;

type SortCol = "set" | "price" | "1d" | "7d";

interface SealedTabProps {
  typeFilter: string;
  viewMode?: ViewMode;
}

export default function SealedTab({ typeFilter, viewMode = "list" }: SealedTabProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [addingId, setAddingId] = useState<string | null>(null);
  const [products, setProducts] = useState<SealedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(true);
  const loadingMore = useRef(false);
  // Default to newest-first. The "set" sort column sorts by
  // expansionReleaseDate (despite the "Set" label), so desc = newest sealed
  // products on top — a more natural default for browsing than price.
  // Clicking the Set column header toggles to oldest-first.
  const [sortCol, setSortCol] = useState<SortCol>("set");
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

  // Quick-add a sealed product to the user's inventory straight from the list,
  // without leaving the tab. preventDefault on the click stops the row Link from
  // navigating to the detail page.
  const handleAdd = async (e: MouseEvent, product: SealedProduct) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) { toast.info("Sign in to add to your inventory"); navigate("/auth"); return; }
    if (addingId) return;
    setAddingId(product.id);
    const result = await addSealedToCollection(product, user.id, 1);
    if (result) toastAddedToInventory(product.name, navigate);
    else toast.error("Failed to add to inventory");
    setAddingId(null);
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
            <Skeleton className="w-14 h-14" />
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
      <div className="hidden sm:grid grid-cols-[40px_1fr_160px_100px_72px_72px_44px] gap-4 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground">
        <span>#</span>
        <span>Product</span>
        <button onClick={() => handleSort("set")} className="flex items-center hover:text-foreground transition-colors">
          Set <SortIcon col="set" />
        </button>
        <button onClick={() => handleSort("price")} className="flex items-center justify-end hover:text-foreground transition-colors">
          Price <SortIcon col="price" />
        </button>
        <button onClick={() => handleSort("1d")} className="flex items-center justify-end hover:text-foreground transition-colors">
          24h % <SortIcon col="1d" />
        </button>
        <button onClick={() => handleSort("7d")} className="flex items-center justify-end hover:text-foreground transition-colors">
          7d % <SortIcon col="7d" />
        </button>
        <span className="sr-only">Add</span>
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

            return (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.008, 0.3) }}
              >
              <Link
                to={`/sealed/${product.id}`}
                className="block border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
              >
                {/* Desktop: table row (unchanged layout) */}
                <div className="hidden sm:grid grid-cols-[40px_1fr_160px_100px_72px_72px_44px] gap-4 px-4 py-2.5 items-center">
                  <span className="text-sm font-mono text-muted-foreground tabular-nums">{i + 1}</span>
                  <div className="flex items-center gap-3 min-w-0">
                    {image ? (
                      <img src={image} alt={product.name} className="w-14 h-14 object-cover shrink-0 shadow-sm bg-muted" loading="lazy" />
                    ) : (
                      <div className="w-14 h-14 bg-muted flex items-center justify-center shrink-0"><Package className="w-5 h-5 text-muted-foreground" /></div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{product.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{product.type}</span>
                        {variantLabel && variantLabel !== "normal" && (<><span>·</span><span className="truncate">{variantLabel}</span></>)}
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{product.expansionName}</p>
                  <p className="text-right text-sm font-semibold text-foreground tabular-nums">{price !== null ? formatPrice(price) : "—"}</p>
                  <p className={`text-right text-xs font-medium tabular-nums ${f1d.className}`}>{f1d.text}</p>
                  <p className={`text-right text-xs font-medium tabular-nums ${f7d.className}`}>{f7d.text}</p>
                  <button
                    onClick={(e) => handleAdd(e, product)}
                    disabled={addingId === product.id}
                    aria-label={`Add ${product.name} to inventory`}
                    className="justify-self-center inline-flex items-center justify-center w-8 h-8 rounded-md border border-border/50 text-muted-foreground hover:text-primary hover:border-primary transition-colors disabled:opacity-50"
                  >
                    {addingId === product.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Mobile: roomy card (matches the Market Top tab) — image left,
                    info stacked with breathing room, add on its own action row. */}
                <div className="sm:hidden p-4">
                  <div className="flex gap-3">
                    <div className="relative shrink-0">
                      <span className="absolute -top-1.5 -left-1.5 z-10 text-[10px] font-mono font-semibold text-foreground bg-background/95 backdrop-blur px-1.5 py-0.5 rounded-full border border-border/60 tabular-nums shadow-sm">{i + 1}</span>
                      {image ? (
                        <img src={image} alt={product.name} className="w-20 h-20 object-contain bg-muted shadow-md" loading="lazy" />
                      ) : (
                        <div className="w-20 h-20 bg-muted flex items-center justify-center"><Package className="w-6 h-6 text-muted-foreground" /></div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-semibold text-foreground leading-tight truncate">{product.name}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {product.type}{variantLabel && variantLabel !== "normal" ? ` · ${variantLabel}` : ""}
                          </p>
                          <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">{product.expansionName}</p>
                        </div>
                        <p className="text-base font-bold text-foreground tabular-nums shrink-0">{price !== null ? formatPrice(price) : "—"}</p>
                      </div>
                      <div className="flex items-center gap-4 text-[11px] mt-2">
                        <div className="flex items-center gap-1"><span className="text-muted-foreground">24h</span><span className={`font-medium tabular-nums ${f1d.className}`}>{f1d.text}</span></div>
                        <div className="flex items-center gap-1"><span className="text-muted-foreground">7d</span><span className={`font-medium tabular-nums ${f7d.className}`}>{f7d.text}</span></div>
                      </div>
                      <div className="flex items-center justify-end mt-2.5 pt-2.5 border-t border-border/30">
                        <button
                          onClick={(e) => handleAdd(e, product)}
                          disabled={addingId === product.id}
                          aria-label={`Add ${product.name} to inventory`}
                          className="inline-flex items-center gap-1 h-8 px-3 rounded-full border border-border/50 text-muted-foreground hover:text-primary hover:border-primary transition-colors disabled:opacity-50"
                        >
                          {addingId === product.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Plus className="w-3.5 h-3.5" /><span className="text-xs font-medium">Add</span></>}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
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
