import { SealedProduct, getSealedMarketPrice, getSealedTrends } from "@/lib/sealed-store";
import { formatPrice } from "@/lib/pokemon-api";
import { formatPct } from "@/lib/price-snapshots";
import { motion } from "framer-motion";
import { Package } from "lucide-react";

interface SealedGridViewProps {
  products: SealedProduct[];
}

export default function SealedGridView({ products }: SealedGridViewProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-3">
      {products.map((product, i) => {
        const price = getSealedMarketPrice(product);
        const { pct1d } = getSealedTrends(product);
        const pct = formatPct(pct1d);

        return (
          <motion.div
            key={product.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: Math.min(i * 0.01, 0.3) }}
            className="relative rounded-xl overflow-hidden bg-card border border-border/50"
          >
            {/* Product image */}
            <div className="aspect-square relative overflow-hidden bg-muted">
              {product.imageSmall ? (
                <img
                  src={product.imageSmall}
                  alt={product.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Package className="w-10 h-10 text-muted-foreground/40" />
                </div>
              )}

              {/* Price badge */}
              {price !== null && (
                <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-background/90 backdrop-blur-sm border border-border/50">
                  <span className="text-xs font-bold text-foreground tabular-nums">
                    {formatPrice(price)}
                  </span>
                </div>
              )}

              {/* Trend badge */}
              {pct1d !== null && (
                <div className={`absolute top-2 right-2 px-1.5 py-0.5 rounded-md backdrop-blur-sm text-[10px] font-semibold tabular-nums ${
                  pct1d > 0
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : pct1d < 0
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : "bg-muted/80 text-muted-foreground border border-border/50"
                }`}>
                  {pct.text}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="p-2">
              <p className="text-xs font-semibold text-foreground truncate">{product.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{product.expansionName}</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
