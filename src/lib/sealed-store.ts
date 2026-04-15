// Sealed products data layer
// Reads from /data/sealed-products.json (synced once daily via scripts/sync-scrydex-sealed.js)
// Price trends come from DB price_snapshots (sealed-* IDs) via getLatestSnapshotPrices.

import { getLatestSnapshotPrices, type LatestPrice } from "@/lib/price-snapshots";

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

// ─── DB-based trend cache (populated from price_snapshots) ────────────────────

let sealedPriceMap: Map<string, LatestPrice> | null = null;
let sealedPriceMapPromise: Promise<Map<string, LatestPrice>> | null = null;

async function loadSealedPriceMap(): Promise<Map<string, LatestPrice>> {
  if (sealedPriceMap) return sealedPriceMap;
  if (sealedPriceMapPromise) return sealedPriceMapPromise;
  sealedPriceMapPromise = getLatestSnapshotPrices().then((fullMap) => {
    // Filter to sealed-* entries only
    const sealed = new Map<string, LatestPrice>();
    for (const [k, v] of fullMap) {
      if (k.startsWith("sealed-")) sealed.set(k, v);
    }
    sealedPriceMap = sealed;
    return sealed;
  });
  return sealedPriceMapPromise;
}

/** Seed the sealed price map externally (called from Market page to avoid duplicate fetches) */
export function seedSealedPriceMap(allPrices: Map<string, LatestPrice>) {
  const sealed = new Map<string, LatestPrice>();
  for (const [k, v] of allPrices) {
    if (k.startsWith("sealed-")) sealed.set(k, v);
  }
  sealedPriceMap = sealed;
}

/** Get 1d and 7d percent changes from DB snapshots */
export function getSealedTrends(product: SealedProduct): {
  pct1d: number | null;
  pct7d: number | null;
} {
  const sealedId = `sealed-${product.id}`;
  const dbEntry = sealedPriceMap?.get(sealedId);
  if (dbEntry) {
    return {
      pct1d: dbEntry.pricePct24h,
      pct7d: dbEntry.pricePct7d,
    };
  }
  // Fallback to inline trend data from JSON
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

// ─── Main fetch (reads from cached JSON, sorted by price desc) ────────────────

export async function fetchSealedProducts(opts: {
  page?: number;
  pageSize?: number;
  type?: string;
  sortCol?: "price" | "1d" | "7d" | null;
  sortDir?: "asc" | "desc";
}): Promise<SealedSearchResult> {
  const { page = 1, pageSize = 50, type, sortCol, sortDir = "desc" } = opts;

  // Ensure sealed price map is loaded for trends
  await loadSealedPriceMap();

  const all = await loadSealedProducts();

  // Apply type filter
  let filtered = type && type !== "all"
    ? all.filter((p) => p.type === type)
    : [...all];

  // Sort: use user-selected column, or default to price desc
  const effectiveCol = sortCol ?? "price";
  filtered.sort((a, b) => {
    let va: number | null, vb: number | null;
    if (effectiveCol === "price") {
      va = getSealedMarketPrice(a);
      vb = getSealedMarketPrice(b);
    } else {
      const ta = getSealedTrends(a);
      const tb = getSealedTrends(b);
      va = effectiveCol === "1d" ? ta.pct1d : ta.pct7d;
      vb = effectiveCol === "1d" ? tb.pct1d : tb.pct7d;
    }
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return sortDir === "asc" ? va - vb : vb - va;
  });

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
