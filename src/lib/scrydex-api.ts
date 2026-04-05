// Scrydex data layer — all card/expansion/pricing data routed through scrydex-proxy edge function

import { supabase } from "@/integrations/supabase/client";

// ─── Proxy helper ─────────────────────────────────────────────────────────────

async function proxyFetch(endpoint: string) {
  const { data, error } = await supabase.functions.invoke("scrydex-proxy", {
    body: { endpoint },
  });
  if (error) throw new Error(error.message);
  if (!data || data.status !== 200)
    throw new Error(`Scrydex API error: ${data?.status}`);
  return data.data;
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ScrydexExpansion {
  id: string;
  name: string;
  series: string;
  code: string;
  total: number;
  printed_total?: number;
  language_code: string;
  release_date: string; // "YYYY/MM/DD"
  is_online_only: boolean;
  logo?: string;
  symbol?: string;
}

export interface ScrydexCardPrice {
  condition: string;
  is_perfect: boolean;
  is_signed: boolean;
  is_error: boolean;
  type: string;
  low: number;
  market: number;
  currency: string;
}

export interface ScrydexCardVariant {
  name: string;
  prices: ScrydexCardPrice[];
}

export interface ScrydexCard {
  id: string;
  name: string;
  supertype: string;
  subtypes?: string[];
  types?: string[];
  hp?: string;
  number: string;
  printed_number?: string;
  rarity?: string;
  rarity_code?: string;
  artist?: string;
  regulation_mark?: string;
  images: Array<{ type: string; small: string; medium: string; large: string }>;
  expansion: ScrydexExpansion;
  variants: ScrydexCardVariant[];
  language_code: string;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Convert Scrydex date "YYYY/MM/DD" → "YYYY-MM-DD" */
export function normalizeDate(d: string): string {
  return d ? d.replace(/\//g, "-") : "";
}

/** Extract best NM market price from a Scrydex card */
export function getScrydexCardPrice(card: ScrydexCard): number | null {
  const order = ["holofoil", "reverseHolofoil", "normal", "firstEdition"];
  const sorted = [...card.variants].sort(
    (a, b) => order.indexOf(a.name) - order.indexOf(b.name)
  );
  for (const variant of sorted) {
    const nm = variant.prices.find((p) => p.condition === "NM" && p.type === "raw");
    if (nm && nm.market > 0) return nm.market;
    const any = variant.prices.find((p) => p.type === "raw" && p.market > 0);
    if (any) return any.market;
  }
  return null;
}

// ─── Expansions ───────────────────────────────────────────────────────────────

/** Fetch all English expansions from Scrydex (handles pagination automatically) */
export async function getExpansions(): Promise<ScrydexExpansion[]> {
  const PAGE_SIZE = 100;
  const first = await proxyFetch(
    `/pokemon/v1/en/expansions?page=1&page_size=${PAGE_SIZE}&orderBy=-release_date`
  );
  const totalCount: number = first.total_count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  let all: ScrydexExpansion[] = first.data ?? [];

  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        proxyFetch(
          `/pokemon/v1/en/expansions?page=${i + 2}&page_size=${PAGE_SIZE}&orderBy=-release_date`
        ).then((r) => (r.data ?? []) as ScrydexExpansion[])
      )
    );
    all = [...all, ...rest.flat()];
  }

  return all;
}

// ─── Cards ────────────────────────────────────────────────────────────────────

/** Fetch a single card by Scrydex ID with pricing */
export async function getScrydexCard(id: string): Promise<ScrydexCard | null> {
  try {
    const data = await proxyFetch(`/pokemon/v1/cards/${id}?include=prices`);
    return data as ScrydexCard;
  } catch {
    return null;
  }
}

/** Fetch all cards in an expansion with pricing (handles pagination) */
export async function getExpansionCards(
  expansionId: string,
  onPage?: (cards: ScrydexCard[]) => void
): Promise<ScrydexCard[]> {
  const PAGE_SIZE = 100;
  const first = await proxyFetch(
    `/pokemon/v1/en/expansions/${expansionId}/cards?page=1&page_size=${PAGE_SIZE}&include=prices`
  );
  const totalCount: number = first.total_count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const all: ScrydexCard[] = first.data ?? [];
  onPage?.(all);

  for (let p = 2; p <= totalPages; p++) {
    const r = await proxyFetch(
      `/pokemon/v1/en/expansions/${expansionId}/cards?page=${p}&page_size=${PAGE_SIZE}&include=prices`
    );
    const batch = (r.data ?? []) as ScrydexCard[];
    all.push(...batch);
    onPage?.(all);
  }

  return all;
}

/** Fetch a page of cards across all expansions with pricing */
export async function getCards(opts: {
  page?: number;
  pageSize?: number;
  query?: string;
  expansionId?: string;
  orderBy?: string;
}): Promise<{ cards: ScrydexCard[]; totalCount: number }> {
  const {
    page = 1,
    pageSize = 100,
    query,
    expansionId,
    orderBy = "-expansion.release_date",
  } = opts;

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(Math.min(pageSize, 100)),
    include: "prices",
    orderBy,
  });

  const qParts: string[] = [];
  if (query) qParts.push(`name:${query}*`);
  if (expansionId) qParts.push(`expansion.id:${expansionId}`);
  if (qParts.length) params.set("q", qParts.join(" "));

  const data = await proxyFetch(`/pokemon/v1/en/cards?${params.toString()}`);
  return {
    cards: (data.data ?? []) as ScrydexCard[],
    totalCount: data.total_count ?? 0,
  };
}
