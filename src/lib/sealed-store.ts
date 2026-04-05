// Sealed products data layer
// Reads from /data/sealed-products.json (synced once daily via scripts/sync-scrydex-sealed.js)
// Zero API credits per user visit — all data is pre-cached.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SealedProduct {
  id: string;
  name: string;
  type: string;
  description?: string;
  imageSmall: string;
  imageMedium?: string;
  expansionId: string;
  expansionName: string;
  expansionSeries: string;
  expansionReleaseDate: string;
  expansionLogo?: string;
  variants: Array<{
    name: string;
    prices: Array<{
      condition: string;
      currency: string;
      low: number;
      market: number;
      type: string;
      trends?: {
        days_1?: { price_change: number; percent_change: number };
        days_7?: { price_change: number; percent_change: number };
      };
    }>;
  }>;
}

export interface SealedSearchResult {
  products: SealedProduct[];
  page: number;
  pageSize: number;
  totalCount: number;
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

let sealedCache: SealedProduct[] | null = null;

async function loadSealedProducts(): Promise<SealedProduct[]> {
  if (sealedCache) return sealedCache;
  const res = await fetch("/data/sealed-products.json");
  if (!res.ok) throw new Error("Failed to load sealed-products.json");
  const json = await res.json();
  sealedCache = json.products ?? [];
  return sealedCache;
}

// ─── Price helpers ────────────────────────────────────────────────────────────

/** Extract the best market price from a sealed product */
export function getSealedMarketPrice(product: SealedProduct): number | null {
  for (const variant of product.variants) {
    for (const price of variant.prices) {
      if (price.market > 0) return price.market;
      if (price.low > 0) return price.low;
    }
  }
  return null;
}

/** Extract 1-day and 7-day percent change */
export function getSealedTrends(product: SealedProduct): {
  pct1d: number | null;
  pct7d: number | null;
} {
  for (const variant of product.variants) {
    for (const price of variant.prices) {
      if (price.trends) {
        return {
          pct1d: price.trends.days_1?.percent_change ?? null,
          pct7d: price.trends.days_7?.percent_change ?? null,
        };
      }
    }
  }
  return { pct1d: null, pct7d: null };
}

// ─── Main fetch (reads from cached JSON, no API calls) ────────────────────────

export async function fetchSealedProducts(opts: {
  page?: number;
  pageSize?: number;
  type?: string;
}): Promise<SealedSearchResult> {
  const { page = 1, pageSize = 50, type } = opts;

  const all = await loadSealedProducts();

  // Apply type filter
  const filtered = type && type !== "all"
    ? all.filter((p) => p.type === type)
    : all;

  const totalCount = filtered.length;
  const start = (page - 1) * pageSize;
  const products = filtered.slice(start, start + pageSize);

  return { products, page, pageSize, totalCount };
}

// ─── Sealed product type filter options ──────────────────────────────────────

export const SEALED_TYPES = [
  { value: "all", label: "All Products" },
  { value: "Booster Box", label: "Booster Box" },
  { value: "Booster Pack", label: "Booster Pack" },
  { value: "Elite Trainer Box", label: "ETB" },
  { value: "Collection", label: "Collection" },
  { value: "Bundle", label: "Bundle" },
  { value: "Tin", label: "Tin" },
];
