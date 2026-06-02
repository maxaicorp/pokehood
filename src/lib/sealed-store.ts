// Sealed products data layer
// Catalog (which products exist) is read from the `sealed_products` DB table,
// populated daily by the snapshot-sealed cron. The static
// /data/sealed-products.json is a FALLBACK only (legacy; can go stale).
// Price + 1d/7d/30d trends come from the precomputed `latest_card_prices`
// table (sealed-* rows), refreshed at the end of every snapshot run.

import { supabase } from "@/integrations/supabase/client";
import { type LatestPrice } from "@/lib/price-snapshots";
import { PRICE_CACHE_TTL_MS, registerCacheResetter } from "@/lib/cache-invalidation";

// PostgREST caps a single response at 1,000 rows — paginate past it.
const DB_PAGE = 1000;

const numOrNull = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

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
  // Summed market value of ALL items matching the filter (not just this page) —
  // for the header "total value" badge.
  totalValue: number;
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

let sealedCache: SealedProduct[] | null = null;
let sealedCacheAt = 0;

/** Map a snake_case `sealed_products` DB row to the camelCase SealedProduct. */
function mapCatalogRow(r: Record<string, unknown>): SealedProduct {
  return {
    id: r.id as string,
    name: r.name as string,
    type: (r.type as string) ?? "",
    description: (r.description as string) ?? "",
    imageSmall: (r.image_small as string) ?? "",
    imageMedium: (r.image_medium as string) ?? "",
    expansionId: (r.expansion_id as string) ?? "",
    expansionName: (r.expansion_name as string) ?? "",
    expansionSeries: (r.expansion_series as string) ?? "",
    expansionReleaseDate: (r.expansion_release_date as string) ?? "",
    expansionLogo: (r.expansion_logo as string) ?? "",
    variants: (r.variants as SealedProduct["variants"]) ?? [],
  };
}

async function loadSealedProducts(): Promise<SealedProduct[]> {
  if (sealedCache && Date.now() - sealedCacheAt < PRICE_CACHE_TTL_MS) return sealedCache;

  // Primary source: the sealed_products catalog table (cron-maintained).
  // New sets appear here automatically within 24h — no manual sync, no
  // committed JSON, no redeploy. See migration 20260528120000.
  try {
    const rows: Record<string, unknown>[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await (supabase.from as any)("sealed_products")
        .select("*")
        .order("expansion_release_date", { ascending: false })
        .range(from, from + DB_PAGE - 1);
      if (error) throw error;
      const page = data ?? [];
      rows.push(...page);
      if (page.length < DB_PAGE) break;
      from += DB_PAGE;
    }
    if (rows.length > 0) {
      sealedCache = rows.map(mapCatalogRow);
      sealedCacheAt = Date.now();
      return sealedCache;
    }
    console.warn("sealed_products table empty — falling back to static JSON");
  } catch (err) {
    console.warn("sealed_products query failed, falling back to static JSON:", err);
  }

  // Fallback: legacy static JSON (only hit if the table is missing/empty).
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
let sealedPriceMapAt = 0;

async function loadSealedPriceMap(): Promise<Map<string, LatestPrice>> {
  if (sealedPriceMap && Date.now() - sealedPriceMapAt < PRICE_CACHE_TTL_MS) return sealedPriceMap;
  if (sealedPriceMapPromise) return sealedPriceMapPromise;
  // Read sealed-* rows DIRECTLY from latest_card_prices. The previous code went
  // through getLatestSnapshotPrices() → get_all_latest_prices RPC, which has a
  // hard `WHERE card_id NOT LIKE 'sealed-%'` filter — so the sealed price map
  // came back EMPTY and the Sealed tab showed "—" for every 1d/7d change.
  // The deltas are already computed at write time by refresh_latest_card_prices;
  // we just have to read the sealed rows the card RPC hides.
  sealedPriceMapPromise = (async () => {
    const map = new Map<string, LatestPrice>();
    let from = 0;
    while (true) {
      const { data, error } = await (supabase.from as any)("latest_card_prices")
        .select("card_id, card_name, set_name, price, price_1d, price_7d, price_30d")
        .like("card_id", "sealed-%")
        .range(from, from + DB_PAGE - 1);
      if (error) {
        console.warn("sealed price map query failed:", error.message);
        break;
      }
      const page = data ?? [];
      for (const r of page as Array<Record<string, unknown>>) {
        const id = r.card_id as string;
        map.set(id, {
          cardId: id,
          cardName: r.card_name as string,
          setName: r.set_name as string,
          price: Number(r.price),
          price1d: numOrNull(r.price_1d),
          price7d: numOrNull(r.price_7d),
          price30d: numOrNull(r.price_30d),
        });
      }
      if (page.length < DB_PAGE) break;
      from += DB_PAGE;
    }
    sealedPriceMap = map;
    sealedPriceMapAt = Date.now();
    return map;
  })();
  return sealedPriceMapPromise;
}

/** Drop both sealed caches so the next read refetches catalog + prices. */
export function resetSealedCaches(): void {
  sealedCache = null;
  sealedCacheAt = 0;
  sealedPriceMap = null;
  sealedPriceMapPromise = null;
  sealedPriceMapAt = 0;
}
registerCacheResetter(resetSealedCaches);

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
  // Sum the market value across the WHOLE filtered set (every matching item),
  // independent of pagination, so the header total doesn't ratchet as you scroll.
  const totalValue = filtered.reduce((sum, p) => sum + (getSealedMarketPrice(p) ?? 0), 0);
  const start = (page - 1) * pageSize;
  const products = filtered.slice(start, start + pageSize);

  return { products, page, pageSize, totalCount, totalValue };
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
