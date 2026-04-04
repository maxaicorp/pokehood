// Sealed products data layer — fetches from Scrydex API via edge function proxy

import { supabase } from "@/integrations/supabase/client";

export interface SealedProduct {
  id: string;
  name: string;
  type: string;
  description?: string;
  images: Array<{ type: string; small: string; medium: string; large: string }>;
  expansion: {
    id: string;
    name: string;
    series: string;
    code: string;
    release_date: string;
    logo?: string;
    symbol?: string;
  };
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

/** Fetch sealed products from Scrydex via the proxy edge function */
export async function fetchSealedProducts(opts: {
  page?: number;
  pageSize?: number;
  query?: string;
  type?: string;
  orderBy?: string;
}): Promise<SealedSearchResult> {
  const {
    page = 1,
    pageSize = 50,
    query,
    type,
    orderBy = "-expansion.release_date",
  } = opts;

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(Math.min(pageSize, 100)),
    include: "prices",
    orderBy,
  });

  // Build search query
  const qParts: string[] = [];
  if (query) qParts.push(`name:${query}*`);
  if (type && type !== "all") qParts.push(`type:"${type}"`);
  if (qParts.length > 0) params.set("q", qParts.join(" "));

  const endpoint = `/pokemon/v1/sealed?${params.toString()}`;

  const { data, error } = await supabase.functions.invoke("scrydex-proxy", {
    body: { endpoint },
  });

  if (error) {
    console.error("Scrydex proxy error:", error);
    return { products: [], page, pageSize, totalCount: 0 };
  }

  const response = data?.data;
  if (!response || response.error) {
    console.error("Scrydex API error:", response?.error);
    return { products: [], page, pageSize, totalCount: 0 };
  }

  // Filter out "Case" products (bulk wholesale items)
  const allProducts = (response.data ?? []) as SealedProduct[];
  const filtered = allProducts.filter(
    (p) => !p.name.toLowerCase().includes("case")
  );

  return {
    products: filtered,
    page: response.page ?? page,
    pageSize: response.page_size ?? pageSize,
    totalCount: (response.total_count ?? 0) - (allProducts.length - filtered.length),
  };
}

/** Sealed product type filter options */
export const SEALED_TYPES = [
  { value: "all", label: "All Products" },
  { value: "Booster Box", label: "Booster Box" },
  { value: "Booster Pack", label: "Booster Pack" },
  { value: "Elite Trainer Box", label: "ETB" },
  { value: "Collection", label: "Collection" },
  { value: "Bundle", label: "Bundle" },
  { value: "Tin", label: "Tin" },
];
