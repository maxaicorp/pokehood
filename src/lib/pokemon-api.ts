// ─── Data layer ───────────────────────────────────────────────────────────────
// Card/set metadata: single fetch from /data/all-cards.json (browser-cached)
// Pricing: DB snapshots (seeded at init via seedPricingCache) — zero live API calls per user
// Card detail: Scrydex proxy

import { supabase } from "@/integrations/supabase/client";
import { getLatestSnapshotPrices, type LatestPrice } from "@/lib/price-snapshots";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PokemonCard {
  id: string;
  name: string;
  supertype: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  set: {
    id: string;
    name: string;
    series: string;
    printedTotal: number;
    total: number;
    releaseDate: string;
    images: { symbol: string; logo: string };
  };
  number: string;
  rarity?: string;
  images: { small: string; large: string };
  tcgplayer?: {
    url: string;
    updatedAt: string;
    prices?: {
      normal?: PriceData;
      holofoil?: PriceData;
      reverseHolofoil?: PriceData;
      "1stEditionHolofoil"?: PriceData;
    };
  };
  /** Rolling Cardmarket averages from TCGdex (EUR-based, still useful for % change) */
  cardmarketAvgs?: {
    avg1: number | null;
    avg7: number | null;
    avg30: number | null;
    trend: number | null;
  };
}

interface PriceData {
  low: number;
  mid: number;
  high: number;
  market: number;
  directLow?: number;
}

export interface PokemonSet {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  releaseDate: string;
  updatedAt: string;
  isOnlineOnly: boolean; // true = TCG Pocket / digital-only
  images: { symbol: string; logo: string };
}

export interface SearchResult {
  data: PokemonCard[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
}

export interface SetSearchResult {
  data: PokemonSet[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
}

// ─── Card index types (all-cards.json shape) ──────────────────────────────────

interface CardIndexSet {
  name: string;
  logo: string;
  symbol: string;
  releaseDate: string;
  series: string;
  serieId?: string;
  isOnlineOnly?: boolean; // true = TCG Pocket / digital-only (from Scrydex)
  printedTotal: number;
  total: number;
}

interface CardIndexCard {
  id: string;
  name: string;
  // Legacy TCGdex format (base URL, /low.webp and /high.webp appended)
  image?: string;
  // Scrydex format (full CDN URLs stored directly)
  imageSmall?: string;
  imageLarge?: string;
  localId: string;
  setId: string;
  rarity?: string;
  supertype?: string;
  subtypes?: string[];
  types?: string[];
  hp?: string | null;
}

interface CardIndex {
  sets: Record<string, CardIndexSet>;
  cards: CardIndexCard[];
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

let allCardsCache: PokemonCard[] | null = null;
let allSetsCache: PokemonSet[] | null = null;
const pricingCache = new Map<string, PokemonCard["tcgplayer"]>();
const cardmarketAvgsSeeded = new Map<string, PokemonCard["cardmarketAvgs"]>();
const CARD_INDEX_VERSION = "2026-04-13-ascended-heroes-fix";
let pricingSeedPromise: Promise<void> | null = null;

/**
 * Pre-populate the pricing cache from database snapshot prices + % changes.
 * Call this once on app init so Market page renders instantly.
 */
export function seedPricingCache(prices: Map<string, {
  price: number;
  cardName?: string;
  setName?: string;
  price1d?: number | null;
  price7d?: number | null;
  price30d?: number | null;
}>) {
  // Fresh DB seed should always win over stale in-memory values from earlier navigation.
  pricingCache.clear();
  cardmarketAvgsSeeded.clear();
  cardmarketAvgsCache.clear();

  appendPricingCache(prices);
}

export function appendPricingCache(prices: Map<string, {
  price: number;
  cardName?: string;
  setName?: string;
  price1d?: number | null;
  price7d?: number | null;
  price30d?: number | null;
}>) {

  for (const [cardId, data] of prices) {
    const tcgplayer: PokemonCard["tcgplayer"] = {
      url: "",
      updatedAt: new Date().toISOString().split("T")[0],
      prices: { normal: { low: data.price, mid: data.price, high: data.price, market: data.price } },
    };

    pricingCache.set(cardId, tcgplayer);

    // Store raw prior-day prices in avg1/7/30. Display-side code computes % change
    // from these directly — no reverse-engineering, no error amplification.
    if (data.price1d != null || data.price7d != null || data.price30d != null) {
      const avgs: PokemonCard["cardmarketAvgs"] = {
        avg1: data.price1d ?? null,
        avg7: data.price7d ?? null,
        avg30: data.price30d ?? null,
        trend: data.price,
      };
      cardmarketAvgsSeeded.set(cardId, avgs);
      cardmarketAvgsCache.set(cardId, avgs);
    }
  }
}

export async function hydrateCardsFromLatestPrices(prices: LatestPrice[]): Promise<PokemonCard[]> {
  const priceMap = new Map(prices.map((p) => [p.cardId, p]));
  appendPricingCache(priceMap);

  const { cards } = await loadCardIndex();
  const byId = new Map(cards.map((card) => [card.id, card]));

  return prices.flatMap((price) => {
    const [baseId, variant] = price.cardId.split("::");
    const base = byId.get(baseId);
    if (!base) return [];
    const enriched: PokemonCard = { ...base, id: price.cardId, tcgplayer: pricingCache.get(price.cardId) };
    if (variant) {
      const category = getVintageVariantCategory(variant);
      enriched.name = `${base.name} (${formatVariantName(variant)})`;
      enriched.set = category ? { ...base.set, id: `${base.set.id}::${category}`, name: getVirtualSetName(base.set.name, category) } : base.set;
    }
    const avgs = cardmarketAvgsSeeded.get(price.cardId) ?? cardmarketAvgsCache.get(price.cardId);
    if (avgs) enriched.cardmarketAvgs = avgs;
    return [enriched];
  });
}

async function ensurePricingCacheSeeded(): Promise<void> {
  if (pricingCache.size > 0) return;
  if (!pricingSeedPromise) {
    pricingSeedPromise = getLatestSnapshotPrices().then((prices) => {
      seedPricingCache(prices);
    }).catch(() => undefined);
  }
  await pricingSeedPromise;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

async function loadCardIndex(): Promise<{ cards: PokemonCard[]; sets: PokemonSet[] }> {
  if (allCardsCache && allSetsCache) {
    return { cards: allCardsCache, sets: allSetsCache };
  }

  const res = await fetch(`/data/all-cards.json?v=${CARD_INDEX_VERSION}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to load card index");
  const index: CardIndex = await res.json();

  // Map sets
  const sets: PokemonSet[] = Object.entries(index.sets).map(([id, s]) => ({
    id,
    name: s.name,
    series: s.series,
    printedTotal: s.printedTotal,
    total: s.total,
    releaseDate: s.releaseDate,
    updatedAt: s.releaseDate,
    // Use isOnlineOnly flag if present (from new syncs), otherwise fall back to series name check
    isOnlineOnly: s.isOnlineOnly ?? TCGP_SERIES_IDS.includes(s.series.toLowerCase()),
    images: { symbol: s.symbol, logo: s.logo },
  }));
  sets.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));

  // Map cards (deduplicate by ID — Scrydex can return duplicate entries)
  const seenIds = new Set<string>();
  const cards: PokemonCard[] = [];
  for (const c of index.cards) {
    if (seenIds.has(c.id)) continue;
    seenIds.add(c.id);
    const s = index.sets[c.setId];
    // Scrydex CDN images — imageSmall/imageLarge stored directly in all-cards.json
    const imageSmall = c.imageSmall ?? (c.image ? c.image + "/low.webp" : "");
    const imageLarge = c.imageLarge ?? (c.image ? c.image + "/high.webp" : "");
    cards.push({
      id: c.id,
      name: c.name,
      supertype: c.supertype ?? "Pokémon",
      subtypes: c.subtypes,
      types: c.types?.length ? c.types : undefined,
      hp: c.hp ?? undefined,
      rarity: c.rarity || undefined,
      set: {
        id: c.setId,
        name: s?.name ?? c.setId,
        series: s?.series ?? "Unknown",
        printedTotal: s?.printedTotal ?? 0,
        total: s?.total ?? 0,
        releaseDate: s?.releaseDate ?? "2000-01-01",
        images: { symbol: s?.symbol ?? "", logo: s?.logo ?? "" },
      },
      number: c.localId,
      images: {
        small: imageSmall,
        large: imageLarge,
      },
    });
  }

  // Sort newest-first so getLatestCards() and default view show recent cards
  cards.sort((a, b) => b.set.releaseDate.localeCompare(a.set.releaseDate));

  allCardsCache = cards;
  allSetsCache = sets;
  return { cards, sets };
}

function formatVariantName(variant: string): string {
  if (!variant) return "";
  switch (variant) {
    case "holofoil": return "Holo";
    case "reverseHolofoil": return "Reverse Holo";
    case "1stEditionNormal":
    case "firstEdition":
      return "1st Edition";
    case "firstEditionShadowless":
      return "1st Edition Shadowless";
    case "1stEditionHolofoil":
    case "firstEditionHolofoil":
      return "1st Edition Holo";
    case "firstEditionShadowlessHolofoil":
      return "1st Edition Shadowless Holo";
    case "1stEdition":
      return "1st Edition";
    case "unlimitedHolofoil":
      return "Unlimited Holo";
    case "unlimitedShadowless":
      return "Shadowless";
    case "unlimitedShadowlessHolofoil":
      return "Shadowless Holo";
    default:
      return variant
        .replace(/([A-Z])/g, " $1")
        .replace(/^first Edition/i, "1st Edition")
        .trim();
  }
}

const MODERN_SUFFIXES = ["", "::holofoil", "::reverseHolofoil"];

function getVintageVariantCategory(variantOrSuffix: string): "unlimited" | "shadowless" | "firstEdition" | null {
  const variant = variantOrSuffix.replace(/^::/, "").toLowerCase();
  if (variant.includes("1stedition") || variant.includes("firstedition")) return "firstEdition";
  if (variant.includes("shadowless")) return "shadowless";
  if (variant.startsWith("unlimited")) return "unlimited";
  return null;
}

function getVirtualSetName(baseName: string, category: ReturnType<typeof getVintageVariantCategory>): string {
  if (category === "firstEdition") return `${baseName} (1st Edition)`;
  if (category === "shadowless") return `${baseName} (Shadowless)`;
  if (category === "unlimited") return `${baseName} (Unlimited)`;
  return baseName;
}

function isVintageVariantSuffix(suffix: string): boolean {
  return suffix.startsWith("::") && getVintageVariantCategory(suffix) !== null;
}

function expandVariants(cards: PokemonCard[], allowedSetIds?: Set<string>): PokemonCard[] {
  const expanded: PokemonCard[] = [];
  const requestedVariantSets = new Set<string>();
  const requestedBaseSets = new Set<string>();

  if (allowedSetIds) {
    for (const sid of allowedSetIds) {
      if (sid.includes("::")) {
        requestedVariantSets.add(sid);
      } else {
        requestedBaseSets.add(sid);
      }
    }
  }

  const suffixesByBaseId = new Map<string, string[]>();
  for (const cardId of pricingCache.keys()) {
    const [baseId, rawSuffix] = cardId.split("::");
    const suffix = rawSuffix ? `::${rawSuffix}` : "";
    const existing = suffixesByBaseId.get(baseId);
    if (existing) {
      if (!existing.includes(suffix)) existing.push(suffix);
    } else {
      suffixesByBaseId.set(baseId, [suffix]);
    }
  }

  for (const card of cards) {
    const potentialSuffixes = suffixesByBaseId.get(card.id) ?? [];

    // First pass: collect every suffix that has a price in the cache.
    const matches: { suffix: string; priceData: NonNullable<PokemonCard["tcgplayer"]> }[] = [];
    for (const suffix of potentialSuffixes) {
      const priceData = pricingCache.get(`${card.id}${suffix}`);
      if (priceData) matches.push({ suffix, priceData });
    }

    if (matches.length === 0) {
      // No pricing at all — emit the base card for the unpriced section of set views.
      if (!allowedSetIds || requestedBaseSets.has(card.set.id) || allowedSetIds.has(card.set.id)) {
        expanded.push(card);
      }
      continue;
    }

    const hasVintage = matches.some((m) => isVintageVariantSuffix(m.suffix));

    if (!hasVintage) {
      // Modern card: Scrydex sometimes returns duplicate "normal"+"holofoil"
      // entries for the same physical card. Collapse to one row using the best
      // available price (prefer bare → holofoil → reverseHolofoil), keep the
      // base card id so /card/:id links work, and don't stamp "(Holo)" onto the name.
      const best = MODERN_SUFFIXES.map((p) => matches.find((m) => m.suffix === p)).find(Boolean) ?? matches[0];
      const matchesBaseSet = !allowedSetIds || requestedBaseSets.has(card.set.id) || allowedSetIds.has(card.set.id);
      if (!matchesBaseSet) continue;

      const enriched: PokemonCard = { ...card, tcgplayer: best!.priceData };
      const avgs =
        cardmarketAvgsSeeded.get(card.id) ??
        cardmarketAvgsSeeded.get(`${card.id}${best!.suffix}`) ??
        cardmarketAvgsCache.get(card.id) ??
        cardmarketAvgsCache.get(`${card.id}${best!.suffix}`);
      if (avgs) enriched.cardmarketAvgs = avgs;
      expanded.push(enriched);
      continue;
    }

    // Vintage card: if specific suffixed variants exist, never surface the bare
    // row because Scrydex's unsuffixed price is ambiguous and often maps to the
    // wrong printing (for Base/Jungle/Fossil it frequently mirrors 1st Edition).
    const vintageMatches = matches.some((m) => m.suffix !== "")
      ? matches.filter((m) => m.suffix !== "" && isVintageVariantSuffix(m.suffix))
      : matches;

    for (const { suffix, priceData } of vintageMatches) {
      const variantId = `${card.id}${suffix}`;
      const variantName = suffix.replace("::", "");
      const category = getVintageVariantCategory(variantName);

      let isRequestedVariant = true;
      if (allowedSetIds) {
        const wants1stEdition = requestedVariantSets.has(`${card.set.id}::firstEdition`);
        const wantsShadowless = requestedVariantSets.has(`${card.set.id}::shadowless`);
        const wantsUnlimited = requestedVariantSets.has(`${card.set.id}::unlimited`) || requestedBaseSets.has(card.set.id);
        if (category === "firstEdition" && !wants1stEdition) isRequestedVariant = false;
        if (category === "shadowless" && !wantsShadowless) isRequestedVariant = false;
        if (category === "unlimited" && !wantsUnlimited) isRequestedVariant = false;
      }
      if (!isRequestedVariant) continue;

      const enriched: PokemonCard = { ...card, id: variantId, tcgplayer: priceData };
      if (variantName) {
        enriched.name = `${card.name} (${formatVariantName(variantName)})`;
        enriched.set = category ? { ...card.set, id: `${card.set.id}::${category}`, name: getVirtualSetName(card.set.name, category) } : card.set;
      }
      const avgs = cardmarketAvgsSeeded.get(variantId) ?? cardmarketAvgsCache.get(variantId);
      if (avgs) enriched.cardmarketAvgs = avgs;
      expanded.push(enriched);
    }
  }

  return expanded;
}

/** Fetch pricing for cards with concurrency limit to avoid flooding the network. */
export async function enrichPageWithPricing(
  cards: PokemonCard[],
  concurrency = 15,
): Promise<PokemonCard[]> {
  const results: PokemonCard[] = new Array(cards.length);
  // Use a queue to avoid race conditions — each worker pops its own index
  const queue = cards.map((_, i) => i);

  async function worker() {
    while (queue.length > 0) {
      const i = queue.shift()!;
      results[i] = await enrichCardWithPricing(cards[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, cards.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Progressive pricing: enrich cards in batches and call onBatch after each chunk. */
export async function enrichCardsProgressively(
  cards: PokemonCard[],
  batchSize = 50,
  concurrency = 15,
  onBatch?: (enrichedSoFar: PokemonCard[]) => void,
): Promise<PokemonCard[]> {
  const allEnriched: PokemonCard[] = [];
  for (let i = 0; i < cards.length; i += batchSize) {
    const batch = cards.slice(i, i + batchSize);
    const enriched = await enrichPageWithPricing(batch, concurrency);
    allEnriched.push(...enriched);
    onBatch?.(allEnriched);
  }
  return allEnriched;
}

// Cache for cardmarket averages (separate from tcgplayer pricing)
const cardmarketAvgsCache = new Map<string, PokemonCard["cardmarketAvgs"]>();

export async function enrichCardWithPricing(card: PokemonCard): Promise<PokemonCard> {
  // Already has prices
  if (card.tcgplayer?.prices) {
    if (!card.cardmarketAvgs && cardmarketAvgsCache.has(card.id)) {
      return { ...card, cardmarketAvgs: cardmarketAvgsCache.get(card.id) ?? undefined };
    }
    return card;
  }

  // Check in-memory cache (populated from DB snapshots via seedPricingCache at app init)
  if (pricingCache.has(card.id)) {
    const cached = pricingCache.get(card.id);
    const avgs = cardmarketAvgsCache.get(card.id) ?? cardmarketAvgsSeeded.get(card.id);
    return cached ? { ...card, tcgplayer: cached, cardmarketAvgs: avgs ?? undefined } : card;
  }

  // No price in DB — mark as checked so we don't retry this session
  pricingCache.set(card.id, undefined);
  return card;
}

// ─── Public API functions ─────────────────────────────────────────────────────

export async function getSets(): Promise<SetSearchResult> {
  await ensurePricingCacheSeeded();
  const { sets, cards } = await loadCardIndex();
  
  // Dynamically inject virtual vintage sets so Unlimited, Shadowless, and
  // 1st Edition cards can be selected independently.
  const vintageSets = new Map<string, Set<"shadowless" | "firstEdition">>();
  for (const [cardId] of pricingCache) {
    const category = getVintageVariantCategory(cardId);
    if (category !== "shadowless" && category !== "firstEdition") continue;
    const baseCardId = cardId.split("::")[0];
    const baseCard = cards.find(c => c.id === baseCardId);
    if (!baseCard) continue;
    const existing = vintageSets.get(baseCard.set.id) ?? new Set<"shadowless" | "firstEdition">();
    existing.add(category);
    vintageSets.set(baseCard.set.id, existing);
  }

  const virtualSets: PokemonSet[] = [];
  for (const [setId, categories] of vintageSets) {
    const baseSet = sets.find(s => s.id === setId);
    if (baseSet) {
      for (const category of categories) {
        virtualSets.push({
          ...baseSet,
          id: `${baseSet.id}::${category}`,
          name: getVirtualSetName(baseSet.name, category),
        });
      }
    }
  }

  const combinedSets = [...sets, ...virtualSets].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));

  return {
    data: combinedSets,
    page: 1,
    pageSize: combinedSets.length,
    count: combinedSets.length,
    totalCount: combinedSets.length,
  };
}

export async function getLatestCards(
  page = 1,
  pageSize = 35,
): Promise<SearchResult> {
  const { cards, sets } = await loadCardIndex();
  const physicalSetIds = new Set(sets.filter((s) => !s.isOnlineOnly).map((s) => s.id));
  const physical = cards.filter((c) => physicalSetIds.has(c.set.id));
  return paginate(physical, page, pageSize);
}

export async function searchCards(
  query: string,
  page = 1,
  pageSize = 35,
): Promise<SearchResult> {
  const { cards } = await loadCardIndex();
  const q = query.toLowerCase();
  const filtered = cards.filter((c) => c.name.toLowerCase().includes(q));
  return paginate(filtered, page, pageSize);
}

export async function searchCardsAdvanced(
  query: string,
  filters: {
    setId?: string;
    rarity?: string;
    supertype?: string;
    types?: string[];
    sortBy?: string;
    productType?: string;
  } = {},
  page = 1,
  pageSize = 35,
): Promise<SearchResult> {
  await ensurePricingCacheSeeded();
  const { cards, sets } = await loadCardIndex();
  const physicalSetIds = new Set(sets.filter((s) => !s.isOnlineOnly).map((s) => s.id));
  const pocketSetIds = new Set(sets.filter((s) => s.isOnlineOnly).map((s) => s.id));

  // Default: physical TCG only (never show TCG Pocket unless explicitly requested)
  let filtered = filters.productType === "pocket"
    ? cards.filter((c) => pocketSetIds.has(c.set.id))
    : cards.filter((c) => physicalSetIds.has(c.set.id));

  if (query) {
    const q = query.toLowerCase();
    filtered = filtered.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.set.name.toLowerCase().includes(q) ||
      c.set.id.toLowerCase().includes(q)
    );
  }
  // Filter by sets
  if (filters.setId) {
    let baseSetId = filters.setId;
    if (filters.setId.includes("::")) baseSetId = filters.setId.split("::")[0];
    filtered = filtered.filter((c) => c.set.id === baseSetId);
  }
  if (filters.rarity) {
    filtered = filtered.filter((c) => c.rarity === filters.rarity);
  }
  if (filters.supertype) {
    filtered = filtered.filter((c) => c.supertype === filters.supertype);
  }
  if (filters.types?.length) {
    filtered = filtered.filter((c) =>
      filters.types!.some((t) => c.types?.includes(t))
    );
  }

  // Expand variants
  const expanded = expandVariants(filtered, filters.setId ? new Set([filters.setId]) : undefined);

  // Sort
  const sortBy = filters.sortBy || "number";
  const desc = sortBy.startsWith("-");
  const field = sortBy.replace(/^-/, "");

  const sorted = [...expanded];
  sorted.sort((a, b) => {
    let cmp: number;
    if (field === "price") {
      const pa = getMarketPrice(a) ?? 0;
      const pb = getMarketPrice(b) ?? 0;
      cmp = pa - pb;
    } else if (field === "name") {
      cmp = a.name.localeCompare(b.name);
    } else if (field === "number") {
      cmp = a.number.padStart(5, "0").localeCompare(b.number.padStart(5, "0"));
    } else {
      cmp = a.name.localeCompare(b.name);
    }
    return desc ? -cmp : cmp;
  });
  return paginate(sorted, page, pageSize);
}

export async function getSetCards(
  setId: string,
  page = 1,
  pageSize = 20,
): Promise<SearchResult> {
  await ensurePricingCacheSeeded();
  const { cards } = await loadCardIndex();
  let baseSetId = setId;
  if (setId.includes("::")) baseSetId = setId.split("::")[0];

  const filtered = cards.filter((c) => c.set.id === baseSetId);
  const expanded = expandVariants(filtered, new Set([setId]));

  expanded.sort((a, b) => a.number.padStart(5, "0").localeCompare(b.number.padStart(5, "0")));
  return paginate(expanded, page, pageSize);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function paginate(cards: PokemonCard[], page: number, pageSize: number): SearchResult {
  const start = (page - 1) * pageSize;
  const sliced = cards.slice(start, start + pageSize);
  return {
    data: sliced,
    page,
    pageSize,
    count: sliced.length,
    totalCount: cards.length,
  };
}

export function getMarketPrice(card: PokemonCard): number | null {
  const prices = card.tcgplayer?.prices ?? pricingCache.get(card.id)?.prices;
  if (!prices) return null;
  // Because variants now have their own IDs (e.g. base1-4::holofoil) and are loaded
  // into the normal price field in DB, the 'normal' field holds the actual variant price.
  const priceData = prices.normal || prices.holofoil || prices.reverseHolofoil || prices["1stEditionHolofoil"];
  return priceData?.market ?? priceData?.mid ?? null;
}

export function getLowPrice(card: PokemonCard): number | null {
  const prices = card.tcgplayer?.prices ?? pricingCache.get(card.id)?.prices;
  if (!prices) return null;
  const priceData = prices.normal || prices.holofoil || prices.reverseHolofoil || prices["1stEditionHolofoil"];
  return priceData?.low ?? null;
}

export function formatPrice(price: number | null): string {
  if (price === null) return "N/A";
  return `$${price.toFixed(2)}`;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HIGH_VALUE_RARITIES = new Set([
  "Rare Holo EX", "Rare Holo GX", "Rare VMAX", "Rare V", "Rare VSTAR",
  "Rare Ultra", "Rare Secret", "Rare Rainbow", "Rare Holo VMAX",
  "Rare Holo V", "Rare Holo VSTAR", "Illustration Rare", "Special Art Rare",
  "Hyper Rare", "Double Rare", "Ultra Rare", "ACE SPEC Rare",
  "Shiny Rare", "Shiny Ultra Rare", "Trainer Gallery Rare Holo",
  "Art Rare", "Super Rare", "Immersive Art Rare", "Crown Rare",
  "Special Illustration Rare",
]);

/** Reorder cards so high-rarity (likely expensive) cards are enriched first. */
function prioritiseByRarity(cards: PokemonCard[]): PokemonCard[] {
  const high = cards.filter((c) => c.rarity && HIGH_VALUE_RARITIES.has(c.rarity));
  const rest = cards.filter((c) => !c.rarity || !HIGH_VALUE_RARITIES.has(c.rarity));
  return [...high, ...rest];
}

export const CARD_RARITIES = [
  "Common", "Uncommon", "Rare", "Rare Holo", "Rare Holo EX", "Rare Holo GX",
  "Rare Holo V", "Rare VMAX", "Rare VSTAR", "Rare Ultra", "Rare Secret",
  "Rare Rainbow", "Illustration Rare", "Special Illustration Rare", "Hyper Rare",
  "Double Rare", "Ultra Rare", "Shiny Rare", "Shiny Ultra Rare", "ACE SPEC Rare",
  "Amazing Rare", "Promo",
];

export const CARD_TYPES = [
  "Colorless", "Darkness", "Dragon", "Fairy", "Fighting", "Fire",
  "Grass", "Lightning", "Metal", "Psychic", "Water",
];

export const SORT_OPTIONS = [
  { value: "number", label: "Card Number" },
  { value: "price", label: "Price: Low → High" },
  { value: "-price", label: "Price: High → Low" },
  { value: "name", label: "Name A-Z" },
  { value: "-name", label: "Name Z-A" },
];

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type CardCondition = (typeof CONDITIONS)[number];

// All series names Scrydex uses for TCG Pocket content (lowercased for comparison)
// Mega Evolution is a physical TCG series and should NOT be filtered out.
export const TCGP_SERIES_IDS = ["pokémon tcg pocket"];

export const PRODUCT_TYPES = [
  { value: "all", label: "All Products" },
  { value: "tcg", label: "Pokémon TCG" },
  { value: "pocket", label: "TCG Pocket" },
];

export async function getCardById(id: string): Promise<PokemonCard | null> {
  await ensurePricingCacheSeeded();
  const { cards } = await loadCardIndex();
  if (id.includes("::")) {
    const [baseId, variant] = id.split("::");
    const base = cards.find((c) => c.id === baseId);
    const priceData = pricingCache.get(id);
    if (!base) return null;
    const enriched: PokemonCard = { ...base, id, tcgplayer: priceData };
    if (variant) {
      const category = getVintageVariantCategory(variant);
      enriched.name = `${base.name} (${formatVariantName(variant)})`;
      enriched.set = category ? { ...base.set, id: `${base.set.id}::${category}`, name: getVirtualSetName(base.set.name, category) } : base.set;
    }
    const avgs = cardmarketAvgsSeeded.get(id) ?? cardmarketAvgsCache.get(id);
    if (avgs) enriched.cardmarketAvgs = avgs;
    return enriched;
  }
  return cards.find((c) => c.id === id) ?? null;
}

// ─── Market leaderboard ───────────────────────────────────────────────────────

/**
 * Instant market cards — applies cached/seeded prices without any API calls.
 * Cards with no cached price are excluded (they'll appear once the daily snapshot runs).
 */
export async function getMarketCards(opts: {
  setIds?: Set<string>;
  limit?: number;
}): Promise<PokemonCard[]> {
  await ensurePricingCacheSeeded();
  const { cards, sets } = await loadCardIndex();
  const physicalSetIds = new Set(sets.filter((s) => !s.isOnlineOnly).map((s) => s.id));
  
  let allowedBaseIds = physicalSetIds;
  if (opts.setIds) {
    const requestedBaseSetIds = new Set<string>();
    for (const sid of opts.setIds) {
      requestedBaseSetIds.add(sid.split("::")[0]);
    }
    allowedBaseIds = new Set([...requestedBaseSetIds].filter((id) => physicalSetIds.has(id)));
  }
  
  const filtered = cards.filter((c) => allowedBaseIds.has(c.set.id));
  
  // Expand into variant rows based on cache
  const withPrices = expandVariants(filtered, opts.setIds);

  return withPrices
    .filter((c) => getMarketPrice(c) !== null)
    .sort((a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0))
    .slice(0, opts.limit ?? 200);
}

/** Top cards across ALL sets, sorted by price descending. Progressive callback supported. */
export async function getTopPricedCards(
  limit = 100,
  onProgress?: (cards: PokemonCard[]) => void,
): Promise<PokemonCard[]> {
  const { cards, sets } = await loadCardIndex();
  const physicalSets = sets.filter((s) => !s.isOnlineOnly);
  const physicalSetIds = new Set(physicalSets.map((s) => s.id));
  const candidates = cards.filter((c) => physicalSetIds.has(c.set.id));

  // Prioritise high-rarity cards, then cap to a sane amount for enrichment
  const prioritised = prioritiseByRarity(candidates).slice(0, 800);

  const priced = await enrichCardsProgressively(prioritised, 50, 15, (soFar) => {
    const sorted = soFar
      .filter((c) => getMarketPrice(c) !== null)
      .sort((a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0))
      .slice(0, limit);
    onProgress?.(sorted);
  });
  return priced
    .filter((c) => getMarketPrice(c) !== null)
    .sort((a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0))
    .slice(0, limit);
}

/** Top cards from the N most recent sets, sorted by price descending. */
export async function getRecentSetCards(
  limit = 100,
  numSets = 5,
  onProgress?: (cards: PokemonCard[]) => void,
): Promise<PokemonCard[]> {
  const { cards, sets } = await loadCardIndex();
  const physicalSets = sets.filter((s) => !s.isOnlineOnly);
  const recentSetIds = new Set(physicalSets.slice(0, numSets).map((s) => s.id));
  const candidates = cards.filter((c) => recentSetIds.has(c.set.id));
  const prioritised = prioritiseByRarity(candidates);
  const priced = await enrichCardsProgressively(prioritised, 50, 15, (soFar) => {
    const sorted = soFar
      .filter((c) => getMarketPrice(c) !== null)
      .sort((a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0))
      .slice(0, limit);
    onProgress?.(sorted);
  });
  return priced
    .filter((c) => getMarketPrice(c) !== null)
    .sort((a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0))
    .slice(0, limit);
}

/** Get the IDs of the 5 most recent physical sets. */
export async function getRecentSetIds(): Promise<string[]> {
  const { sets } = await loadCardIndex();
  const physicalSets = sets.filter((s) => !s.isOnlineOnly);
  return physicalSets.slice(0, 5).map((s) => s.id);
}

/** All cards in a specific set, sorted by price descending. */
export async function getSetCardsByPrice(
  setId: string,
  onProgress?: (cards: PokemonCard[]) => void,
): Promise<PokemonCard[]> {
  const result = await getSetCards(setId, 1, 500);
  const prioritised = prioritiseByRarity(result.data);
  const priced = await enrichCardsProgressively(prioritised, 50, 15, (soFar) => {
    const sorted = [...soFar].sort(
      (a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0)
    );
    onProgress?.(sorted);
  });
  return priced.sort(
    (a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0)
  );
}

