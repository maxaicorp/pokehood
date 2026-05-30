import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  getSealedProductById,
  getSealedByExpansion,
  getSealedMarketPrice,
  getSealedTrends,
  type SealedProduct,
} from "@/lib/sealed-store";
import { formatPrice } from "@/lib/pokemon-api";
import { addSealedToCollection } from "@/lib/collection-store";
import { formatPct } from "@/lib/price-snapshots";
import { getSetSentiment, castVote, type SetSentiment, type VoteType } from "@/lib/sentiment-store";
import CardSentimentWidget from "@/components/CardSentimentWidget";
import AppHeader from "@/components/AppHeader";
import PriceChart from "@/components/PriceChart";
import ErrorBoundary from "@/components/ErrorBoundary";
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
import { toast } from "sonner";
import SEO from "@/components/SEO";

export default function SealedDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [product, setProduct] = useState<SealedProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [related, setRelated] = useState<SealedProduct[]>([]);
  const [activeVariantIdx, setActiveVariantIdx] = useState(0);
  const [sentiment, setSentiment] = useState<SetSentiment | null>(null);

  const sentimentKey = id ? `sealed-${id}` : "";

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setActiveVariantIdx(0);
    getSealedProductById(id).then(async (p) => {
      if (cancelled) return;
      setProduct(p);
      setLoading(false);
      if (p) {
        const others = await getSealedByExpansion(p.expansionId, p.id, 12);
        if (!cancelled) setRelated(others);
      }
    });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!sentimentKey) return;
    getSetSentiment([sentimentKey]).then((map) => {
      setSentiment(
        map.get(sentimentKey) ??
          { setId: sentimentKey, upvotes: 0, downvotes: 0, score: 0, currentUserVote: null }
      );
    });
  }, [sentimentKey]);

  const price = product ? getSealedMarketPrice(product) : null;
  const { pct1d } = product ? getSealedTrends(product) : { pct1d: null };
  const f1d = formatPct(pct1d);

  const handleVote = async (voteType: VoteType) => {
    if (!user) { toast.info("Sign in to vote"); navigate("/auth"); return; }
    if (!product) return;
    const current = sentiment?.currentUserVote ?? null;
    const newVote = current === voteType ? null : voteType;
    setSentiment((prev) => {
      const base = prev ?? { setId: sentimentKey, upvotes: 0, downvotes: 0, score: 0, currentUserVote: null };
      const upvotes = Math.max(0, base.upvotes + (voteType === "up" ? (current === "up" ? -1 : 1) : (current === "up" ? -1 : 0)));
      const downvotes = Math.max(0, base.downvotes + (voteType === "down" ? (current === "down" ? -1 : 1) : (current === "down" ? -1 : 0)));
      return { ...base, upvotes, downvotes, score: upvotes - downvotes, currentUserVote: newVote };
    });
    await castVote(sentimentKey, user.id, current, voteType);
  };

  const [addingToCollection, setAddingToCollection] = useState(false);
  const handleAddToCollection = async () => {
    if (!user) { toast.info("Sign in to track sealed products"); navigate("/auth"); return; }
    if (!product) return;
    setAddingToCollection(true);
    const result = await addSealedToCollection(product, user.id, 1);
    if (result) {
      toast.success(`${product.name} added to your collection`);
    } else {
      toast.error("Failed to add to collection");
    }
    setAddingToCollection(false);
  };

  const handleWishlist = () => {
    if (!user) { toast.info("Sign in to wishlist sealed products"); navigate("/auth"); return; }
    toast.info("Sealed product wishlist coming soon");
  };

  const buyQuery = product ? encodeURIComponent(`${product.name} ${product.expansionName} pokemon`) : "";
  const buyLinks = [
    { label: "TCGPlayer", url: `https://www.tcgplayer.com/search/pokemon/product?q=${buyQuery}` },
    { label: "eBay", url: `https://www.ebay.com/sch/i.html?_nkw=${buyQuery}&_sacat=0` },
    { label: "Amazon", url: `https://www.amazon.com/s?k=${buyQuery}` },
  ];

  const variantPrice = (v: SealedProduct["variants"][number]): number | null => {
    for (const p of v.prices) {
      if (p.market > 0) return p.market;
      if (p.low > 0) return p.low;
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      {product && (
        <SEO
          title={`${product.name} · ${product.expansionName} — Collectiblez`}
          description={`Live market price and price history for the ${product.name} sealed product from ${product.expansionName}.`}
          path={`/sealed/${product.id}`}
          image={product.imageMedium || product.imageSmall}
          type="product"
          jsonLd={{
            "@context": "https://schema.org",
            "@type": "Product",
            name: product.name,
            image: product.imageMedium || product.imageSmall,
            description: `Sealed ${product.name} from ${product.expansionName}.`,
            category: "Sealed Trading Card Product",
          }}
        />
      )}
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

          {/* Col 2 — Info + (variant tabs) + chart */}
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
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">Product not found.</p>
            )}

            {/* Mobile price */}
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

            {/* Variant tabs (only when there are multiple variants) */}
            {product && product.variants.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                {product.variants.map((v, idx) => {
                  const vp = variantPrice(v);
                  const isActive = idx === activeVariantIdx;
                  return (
                    <button
                      key={v.name + idx}
                      onClick={() => setActiveVariantIdx(idx)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        isActive
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      <span className="capitalize">{v.name || "default"}</span>
                      {vp !== null && (
                        <span className="ml-2 tabular-nums opacity-80">{formatPrice(vp)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Price chart — scoped boundary (see CardDetail). */}
            {product && (
              <div className="rounded-xl border border-border bg-card p-4 sm:p-5 flex-1">
                <ErrorBoundary label="PriceChart(sealed)" fallback="Price history unavailable.">
                  <PriceChart
                    cardId={`sealed-${product.id}`}
                    currentPrice={price}
                  />
                </ErrorBoundary>
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

            {/* Buy Now */}
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

            <Button
              onClick={handleAddToCollection}
              disabled={addingToCollection}
              variant="outline"
              className="w-full h-12 text-base"
            >
              {addingToCollection ? "Adding…" : "Add to Collection"}
            </Button>

            <Button
              variant="outline"
              onClick={handleWishlist}
              className="w-full h-12 text-base"
            >
              Wishlist
            </Button>

            <CardSentimentWidget sentiment={sentiment} onVote={handleVote} />
          </div>
        </div>

        {/* ── More from this expansion ── */}
        {related.length > 0 && product && (
          <div className="mt-10">
            <h3 className="font-display font-semibold text-foreground mb-4">
              More from {product.expansionName}
            </h3>
            <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
              {related.map((r) => {
                const rp = getSealedMarketPrice(r);
                return (
                  <Link key={r.id} to={`/sealed/${r.id}`} className="shrink-0 group w-28 sm:w-32">
                    <motion.div whileHover={{ y: -4 }} transition={{ duration: 0.15 }}>
                      {r.imageSmall ? (
                        <img
                          src={r.imageSmall}
                          alt={r.name}
                          className="w-28 h-28 sm:w-32 sm:h-32 rounded-lg shadow-md object-cover group-hover:shadow-lg transition-shadow bg-muted"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-lg bg-muted flex items-center justify-center">
                          <Package className="w-8 h-8 text-muted-foreground/40" />
                        </div>
                      )}
                      <p className="text-[11px] text-foreground font-medium mt-1 truncate w-28 sm:w-32">
                        {r.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {rp !== null ? formatPrice(rp) : "—"}
                      </p>
                    </motion.div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
