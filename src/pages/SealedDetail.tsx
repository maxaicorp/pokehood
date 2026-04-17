import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getSealedProductById,
  getSealedMarketPrice,
  getSealedTrends,
  type SealedProduct,
} from "@/lib/sealed-store";
import { formatPrice } from "@/lib/pokemon-api";
import { formatPct } from "@/lib/price-snapshots";
import AppHeader from "@/components/AppHeader";
import PriceChart from "@/components/PriceChart";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, ChevronRight, ChevronDown, ExternalLink, Package, TrendingUp, TrendingDown } from "lucide-react";
import { motion } from "framer-motion";

export default function SealedDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<SealedProduct | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    getSealedProductById(id).then((p) => {
      if (cancelled) return;
      setProduct(p);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  const price = product ? getSealedMarketPrice(product) : null;
  const { pct1d, pct7d } = product ? getSealedTrends(product) : { pct1d: null, pct7d: null };
  const f1d = formatPct(pct1d);
  const f7d = formatPct(pct7d);

  const buyQuery = product ? encodeURIComponent(`${product.name} ${product.expansionName} pokemon`) : "";
  const buyLinks = [
    { label: "TCGPlayer", url: `https://www.tcgplayer.com/search/pokemon/product?q=${buyQuery}` },
    { label: "eBay", url: `https://www.ebay.com/sch/i.html?_nkw=${buyQuery}&_sacat=0` },
    { label: "Amazon", url: `https://www.amazon.com/s?k=${buyQuery}` },
  ];

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <AppHeader activePage="market" />

      <div className="container py-6 px-4 sm:px-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6 flex-wrap">
          <button onClick={() => navigate(-1)} className="hover:text-foreground transition-colors flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
          {product && (
            <>
              <ChevronRight className="w-3.5 h-3.5" />
              <span>{product.expansionName}</span>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="text-foreground font-medium">{product.name}</span>
            </>
          )}
        </nav>

        {/* ── 3-column hero ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_280px] gap-6 items-start">
          {/* Col 1 — Product image */}
          <div className="flex items-start justify-center lg:justify-start">
            {loading ? (
              <Skeleton className="aspect-square w-full max-w-[320px] rounded-2xl" />
            ) : product?.imageMedium || product?.imageSmall ? (
              <motion.img
                src={product.imageMedium || product.imageSmall}
                alt={product.name}
                className="w-full max-w-[320px] rounded-2xl shadow-2xl bg-muted"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              />
            ) : (
              <div className="w-full max-w-[320px] aspect-square rounded-2xl bg-muted flex items-center justify-center">
                <Package className="w-16 h-16 text-muted-foreground/40" />
              </div>
            )}
          </div>

          {/* Col 2 — Info + chart */}
          <div className="flex flex-col gap-4 min-w-0">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
            ) : product ? (
              <div>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
                    {product.name}
                  </h1>
                  <Badge variant="secondary" className="shrink-0 text-xs mt-1">
                    {product.type}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground flex-wrap">
                  <span>{product.expansionName}</span>
                  {product.expansionReleaseDate && (
                    <>
                      <span>·</span>
                      <span>{product.expansionReleaseDate}</span>
                    </>
                  )}
                  {product.variants.length > 1 && (
                    <>
                      <span>·</span>
                      <span>{product.variants.length} variants</span>
                    </>
                  )}
                </div>
                {product.description && (
                  <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                    {product.description}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">Product not found.</p>
            )}

            {/* Price — mobile only */}
            {price !== null && (
              <div className="lg:hidden">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-3xl font-bold text-foreground tabular-nums">
                    {formatPrice(price)}
                  </span>
                  {pct1d !== null && (
                    <span className={`flex items-center gap-1 text-sm font-semibold ${pct1d >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {pct1d >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {f1d.text} (24h)
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Price chart (price_snapshots uses sealed-* prefix) */}
            {product && (
              <div className="rounded-xl border border-border bg-card p-4 sm:p-5 flex-1">
                <PriceChart
                  cardId={`sealed-${product.id}`}
                  currentPrice={price}
                />
              </div>
            )}
          </div>

          {/* Col 3 — Price + Actions */}
          <div className="flex flex-col gap-3">
            <div className="hidden lg:block">
              {price !== null ? (
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-3xl font-bold text-foreground tabular-nums">
                    {formatPrice(price)}
                  </span>
                  {pct1d !== null && (
                    <span className={`flex items-center gap-1 text-sm font-semibold ${pct1d >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {pct1d >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {f1d.text} (24h)
                    </span>
                  )}
                </div>
              ) : null}
            </div>

            <div className="hidden lg:block w-full h-px bg-border" />

            {/* Buy Now dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="w-full h-12 text-base" size="lg">
                  Buy Now
                  <ChevronDown className="w-4 h-4 ml-2 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                {buyLinks.map((link) => (
                  <DropdownMenuItem key={link.label} asChild>
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between">
                      {link.label}
                      <ExternalLink className="w-3.5 h-3.5 opacity-50" />
                    </a>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Trends summary card */}
            {product && (
              <div className="rounded-xl border border-border bg-card p-4 space-y-2">
                <p className="text-sm font-semibold text-foreground mb-2">Price Trends</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">24h</span>
                  <span className={`font-medium tabular-nums ${f1d.className}`}>{f1d.text}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">7d</span>
                  <span className={`font-medium tabular-nums ${f7d.className}`}>{f7d.text}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
