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
  try {
    const res = await fetch("/data/sealed-products.json");
    if (!res.ok) {
      console.warn("sealed-products.json not found — Sealed tab will be empty");
      sealedCache = [];
      return sealedCache;
    }
    const json = await res.json();
    sealedCache = json.products ?? [];
  } catch (err) {
    console.warn("Failed to load sealed-products.json:", err);
    sealedCache = [];
  }
  return sealedCache;
}

/** Find a single sealed product by id. Ensures price map is loaded so trends work. */
export async function getSealedProductById(id: string): Promise<SealedProduct | null> {
  await loadSealedPriceMap();
  const all = await loadSealedProducts();
  return all.find((p) => p.id === id) ?? null;
}

/** Get other sealed products from the same expansion (excludes the source product). */
export async function getSealedByExpansion(
  expansionId: string,
  excludeId: string,
  limit = 12
): Promise<SealedProduct[]> {
  const all = await loadSealedProducts();
  return all
    .filter((p) => p.expansionId === expansionId && p.id !== excludeId)
    .slice(0, limit);
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
    const pctFrom = (prev: number | null) =>
      prev != null && prev !== 0 ? ((dbEntry.price - prev) / prev) * 100 : null;
    return {
      pct1d: pctFrom(dbEntry.price1d),
      pct7d: pctFrom(dbEntry.price7d),
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

// ─── Latest-expansions helper ─────────────────────────────────────────────────

function getLatestExpansionIds(products: SealedProduct[], count: number): Set<string> {
  const byId = new Map<string, string>(); // expansionId -> expansionReleaseDate
  for (const p of products) {
    if (!byId.has(p.expansionId) && p.expansionReleaseDate) {
      byId.set(p.expansionId, p.expansionReleaseDate);
    }
  }
  const sorted = [...byId.entries()]
    .sort(([, a], [, b]) => b.localeCompare(a))
    .slice(0, count)
    .map(([id]) => id);
  return new Set(sorted);
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

  // Apply filter: "latest" = products from the 15 most-recent expansions;
  // "all" (or falsy) = everything; otherwise match by product.type
  let filtered: SealedProduct[];
  if (type === "latest") {
    const latestIds = getLatestExpansionIds(all, 15);
    filtered = all.filter((p) => latestIds.has(p.expansionId));
  } else if (type && type !== "all") {
    filtered = all.filter((p) => p.type === type);
  } else {
    filtered = [...all];
  }

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
  { value: "latest", label: "Latest (15 Sets)" },
  { value: "all", label: "All Products" },
  { value: "Booster Box", label: "Booster Box" },
  { value: "Booster Pack", label: "Booster Pack" },
  { value: "Elite Trainer Box", label: "ETB" },
  { value: "Collection", label: "Collection" },
  { value: "Bundle", label: "Bundle" },
  { value: "Tin", label: "Tin" },
];
