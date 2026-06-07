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

async function proxyFetchFirst(endpoints: string[]) {
  let lastError: unknown;
  for (const endpoint of endpoints) {
    try {
      return await proxyFetch(endpoint);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Scrydex API error");
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
  type: string;            // "raw" | "graded"
  low: number;
  market: number;
  currency: string;
  // Scrydex ships rolling price deltas per condition. We use these to derive
  // the prior-day/7d/30d prices for the admin price audit (price - price_change).
  trends?: Record<string, { price_change: number; percent_change: number }>;
  // ─── Fields present only when type === "graded" ───
  // Scrydex omits these on raw entries. We keep them optional so existing
  // raw-only code (snapshot-prices, market reads) is untouched.
  mid?: number;
  high?: number;
  grade?: number;          // 10, 9.5, 9, 8.5, 8, 7, ...
  company?: string;        // "PSA" | "CGC" | "BGS" | "TAG" | "SGC" | "ACE"
}

// ─── Graded price helpers ────────────────────────────────────────────────────
//
// Used by the GradedPriceTiles component on CardDetail. Selects the 6 specific
// (company, grade) combos the tile row shows. Excludes signed / error / perfect
// variants — those are collectible specialities that would mislead a generic
// "what does a PSA 10 of this card sell for" comparison.
export const GRADED_TILE_KEYS = [
  { company: "PSA", grade: 10 },
  { company: "PSA", grade: 9  },
  { company: "BGS", grade: 10 },
  { company: "BGS", grade: 9  },
  { company: "CGC", grade: 10 },
  { company: "CGC", grade: 9  },
] as const;

export interface GradedTilePrice {
  company: string;
  grade: number;
  market: number | null;
  low: number | null;
  high: number | null;
  mid: number | null;
  currency: string;
}

/** Pluck the 6 standard graded-tile prices out of a Scrydex card.
 *  Returns one entry per tile key, with `market` (and friends) null when
 *  Scrydex has no data for that (company, grade). Picking by the first
 *  matching variant — most cards only have one variant carrying graded data
 *  (e.g. "holofoil"), and Scrydex doesn't disambiguate graded prices across
 *  variants anyway. */
export function extractGradedTilePrices(card: ScrydexCard): GradedTilePrice[] {
  return GRADED_TILE_KEYS.map(({ company, grade }) => {
    let match: ScrydexCardPrice | undefined;
    for (const v of card.variants ?? []) {
      match = (v.prices ?? []).find(
        (p) =>
          p.type === "graded" &&
          p.company === company &&
          p.grade === grade &&
          !p.is_signed &&
          !p.is_error &&
          !p.is_perfect,
      );
      if (match) break;
    }
    return {
      company,
      grade,
      market: match?.market ?? null,
      low: match?.low ?? null,
      high: match?.high ?? null,
      mid: match?.mid ?? null,
      currency: match?.currency ?? "USD",
    };
  });
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

/** Extract best NM market price from a Scrydex card.
 *  Prefers Unlimited/Normal variants over 1st Edition for older sets,
 *  matching the priority used by the snapshot-prices edge function. */
export function getScrydexCardPrice(card: ScrydexCard): number | null {
  const order = ["normal", "holofoil", "reverseHolofoil", "1stEditionNormal", "1stEditionHolofoil", "1stEdition", "unlimitedHolofoil"];
  const sorted = [...card.variants].sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  for (const variant of sorted) {
    // NM raw only — no condition fallback. A played/damaged-grade market is not
    // this card's value (it fabricates lows that match nothing on Scrydex's own
    // page). If no NM market exists, return null and show N/A.
    const nm = variant.prices.find((p) => p.condition === "NM" && p.type === "raw");
    if (nm && nm.market > 0) return nm.market;
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
    const data = await proxyFetchFirst([
      `/pokemon/v1/cards/${id}?include=prices`,
      `/pokemon/v1/en/cards/${id}?include=prices`,
    ]);
    return data as ScrydexCard;
  } catch {
    return null;
  }
}

/** Live NM-raw-USD market + Scrydex-derived 1d/7d/30d prior prices for one card.
 *  Powers the admin price audit. Accepts a bare id ("me2pt5-284") or a
 *  variant id ("base1-4::unlimitedShadowlessHolofoil"). Returns null when the
 *  card has no NM raw USD price (which is exactly when the site should show
 *  N/A rather than a fabricated lower-grade number). */
export interface ScrydexNmAudit {
  market: number;
  price1d: number | null;
  price7d: number | null;
  price30d: number | null;
  variant: string | null;
}

const AUDIT_PRIORITY = ["normal", "holofoil", "reverseHolofoil"];

function nmRawUsd(prices: ScrydexCardPrice[] | undefined): ScrydexCardPrice | undefined {
  return prices?.find(
    (p) => p.condition === "NM" && p.type === "raw" && p.currency === "USD" && p.market > 0,
  );
}

export async function getScrydexNmAudit(cardId: string): Promise<ScrydexNmAudit | null> {
  const [base, want] = cardId.split("::");
  const card = await getScrydexCard(base);
  return getScrydexNmAuditFromCard(card, want);
}

export function getScrydexNmAuditFromCard(card: ScrydexCard | null, want?: string): ScrydexNmAudit | null {
  const variants = card?.variants;
  if (!variants?.length) return null;

  let variant;
  if (want) {
    variant = variants.find((v) => v.name === want);
  } else {
    // Canonical: first variant (in priority order) that actually has an NM price.
    variant = [...variants]
      .sort((a, b) => {
        const ia = AUDIT_PRIORITY.indexOf(a.name); const ib = AUDIT_PRIORITY.indexOf(b.name);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .find((v) => nmRawUsd(v.prices));
  }
  const e = nmRawUsd(variant?.prices);
  if (!variant || !e) return null;

  const t = e.trends ?? {};
  const back = (k: string) => {
    const c = t[k]?.price_change;
    return c != null ? Math.round((e.market - c) * 100) / 100 : null;
  };
  return {
    market: e.market,
    price1d: back("days_1"),
    price7d: back("days_7"),
    price30d: back("days_30"),
    variant: variant.name,
  };
}

/** Fetch all cards in an expansion with pricing (handles pagination) */
export async function getExpansionCards(
  expansionId: string,
  onPage?: (cards: ScrydexCard[]) => void
): Promise<ScrydexCard[]> {
  const PAGE_SIZE = 100;
  let basePath = `/pokemon/v1/expansions/${expansionId}/cards`;
  const endpoint = (page: number) => `${basePath}?page=${page}&page_size=${PAGE_SIZE}&include=prices`;
  let first;
  try {
    first = await proxyFetch(endpoint(1));
  } catch {
    basePath = `/pokemon/v1/en/expansions/${expansionId}/cards`;
    first = await proxyFetch(endpoint(1));
  }
  const totalCount: number = first.total_count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const all: ScrydexCard[] = first.data ?? [];
  onPage?.(all);

  for (let p = 2; p <= totalPages; p++) {
    const r = await proxyFetch(endpoint(p));
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

  const data = await proxyFetchFirst([
    `/pokemon/v1/cards?${params.toString()}`,
    `/pokemon/v1/en/cards?${params.toString()}`,
  ]);
  return {
    cards: (data.data ?? []) as ScrydexCard[],
    totalCount: data.total_count ?? 0,
  };
}
