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
  const dbEntry = sealedPriceMap?.get(`sealed-${product.id}`);
  if (dbEntry?.price != null) return dbEntry.price;

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

// ─── Strict per-category matching ────────────────────────────────────────────
// Each filter shows only its single canonical product per set (no bundles,
// multipacks, art-bundles, sleeved variants, displays, cases, or special
// premium SKUs). Names like "Set of 4", "5-Pack", "Display", "Case",
// "Sleeved", "Art Bundle" are treated as noise and excluded.
const NAME_NOISE = /\b(bundle|case|display|set of|sleeved|art bundle)\b|\b\d+[- ]pack\b/i;

function matchesSealedType(product: SealedProduct, type: string): boolean {
  if (type === "all") return true;

  const t = product.type ?? "";
  const name = product.name ?? "";

  // Type must match exactly. The noise filter then excludes derivative SKUs.
  if (t !== type) return false;

  // Booster Pack: also reject "Sleeved Booster Pack" and "Booster Pack Art Bundle"
  // so this filter shows ONLY the plain set booster pack.
  if (type === "Booster Pack") {
    if (NAME_NOISE.test(name)) return false;
    return /\bbooster pack\b/i.test(name);
  }

  // Booster Bundle: the word "bundle" IS the product, so the generic
  // noise filter would zero it out. Only strip multipacks / display SKUs.
  if (type === "Booster Bundle") {
    return !/\b(case|display|set of)\b|\b\d+[- ]pack\b/i.test(name);
  }

  // For everything else the type-equality check + noise filter is enough.
  return !NAME_NOISE.test(name);
}

// ─── Main fetch (reads from cached JSON, sorted by price desc) ────────────────

export async function fetchSealedProducts(opts: {
  page?: number;
  pageSize?: number;
  type?: string;
  sortCol?: "set" | "price" | "1d" | "7d" | null;
  sortDir?: "asc" | "desc";
}): Promise<SealedSearchResult> {
  const { page = 1, pageSize = 50, type, sortCol, sortDir = "desc" } = opts;

  // Ensure sealed price map is loaded for trends
  await loadSealedPriceMap();

  const all = await loadSealedProducts();

  // Apply category filter (strict — no fuzzy "Latest" view).
  let filtered = type && type !== "all"
    ? all.filter((p) => matchesSealedType(p, type))
    : [...all];

  // Tin dedupe: a single tin line ("Ascended Heroes Mini Tin") often ships
  // with 5 different Pokemon-art SKUs. Collapse to one row per line by
  // stripping the " - <character>" suffix and keeping the highest-priced
  // representative (most useful baseline; they all retail similarly anyway).
  if (type === "Tin") {
    const groups = new Map<string, SealedProduct>();
    for (const p of filtered) {
      const key = `${p.expansionId}|${(p.name ?? "").split(" - ")[0].trim()}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, p);
        continue;
      }
      const a = getSealedMarketPrice(p) ?? 0;
      const b = getSealedMarketPrice(existing) ?? 0;
      if (a > b) groups.set(key, p);
    }
    filtered = Array.from(groups.values());
  }

  // Default sort: newest expansion first. User-selected columns override that default.
  if (sortCol === "set") {
    filtered.sort((a, b) => {
      const da = a.expansionReleaseDate ?? "";
      const db = b.expansionReleaseDate ?? "";
      return sortDir === "asc" ? da.localeCompare(db) : db.localeCompare(da);
    });
  } else if (sortCol) {
    filtered.sort((a, b) => {
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
  } else {
    filtered.sort((a, b) =>
      (b.expansionReleaseDate ?? "").localeCompare(a.expansionReleaseDate ?? ""),
    );
  }

  const totalCount = filtered.length;
  const start = (page - 1) * pageSize;
  const products = filtered.slice(start, start + pageSize);

  return { products, page, pageSize, totalCount };
}

// ─── Sealed product type filter options ──────────────────────────────────────

export const SEALED_TYPES = [
  { value: "Elite Trainer Box", label: "ETBs" },
  { value: "Booster Box", label: "Booster Boxes" },
  { value: "Booster Pack", label: "Booster Packs" },
  { value: "Booster Bundle", label: "Booster Bundles" },
  { value: "Tin", label: "Tins" },
  { value: "Collection", label: "Collections" },
  { value: "Blister", label: "Blisters" },
  { value: "Build & Battle", label: "Build & Battle" },
  { value: "Theme Deck", label: "Theme Decks" },
  { value: "all", label: "All Products" },
];
