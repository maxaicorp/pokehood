// ─── Data layer ───────────────────────────────────────────────────────────────
// Card/set metadata: single fetch from /data/all-cards.json (browser-cached)
// Pricing: DB snapshots (seeded at init via seedPricingCache) — zero live API calls per user
// Card detail: Scrydex proxy (primary) → TCGdex (fallback)

import { supabase } from "@/integrations/supabase/client";

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
let imageOverridesCache: Record<string, string> | null = null;

async function getImageOverrides(): Promise<Record<string, string>> {
  if (imageOverridesCache) return imageOverridesCache;
  try {
    const res = await fetch("/data/card-image-overrides.json");
    if (res.ok) imageOverridesCache = await res.json();
  } catch { /* file doesn't exist yet — that's fine */ }
  imageOverridesCache ??= {};
  return imageOverridesCache;
}
const pricingCache = new Map<string, PokemonCard["tcgplayer"]>();
const cardmarketAvgsSeeded = new Map<string, PokemonCard["cardmarketAvgs"]>();
// Secondary index: "cardName|setName" → same data, for cross-ID matching
const pricingByName = new Map<string, PokemonCard["tcgplayer"]>();
const avgsByName = new Map<string, PokemonCard["cardmarketAvgs"]>();

function nameKey(cardName: string, setName: string) {
  return `${cardName}|${setName}`;
}

/**
 * Pre-populate the pricing cache from database snapshot prices + % changes.
 * Also builds a name-based fallback map so Scrydex card IDs match old TCGdex snapshot entries.
 * Call this once on app init so Market page renders instantly.
 */
export function seedPricingCache(prices: Map<string, {
  price: number;
  cardName?: string;
  setName?: string;
  pricePct24h?: number | null;
  pricePct7d?: number | null;
  pricePct30d?: number | null;
}>) {
  // Fresh DB seed should always win over stale in-memory values from earlier navigation.
  pricingCache.clear();
  cardmarketAvgsSeeded.clear();
  pricingByName.clear();
  avgsByName.clear();
  cardmarketAvgsCache.clear();

  for (const [cardId, data] of prices) {
    const tcgplayer: PokemonCard["tcgplayer"] = {
      url: "",
      updatedAt: new Date().toISOString().split("T")[0],
      prices: { normal: { low: data.price, mid: data.price, high: data.price, market: data.price } },
    };

    pricingCache.set(cardId, tcgplayer);

    // Also index by name+set so Scrydex IDs can match TCGdex snapshot IDs
    if (data.cardName && data.setName) {
      const nk = nameKey(data.cardName, data.setName);
      // Keep the highest price when multiple snapshots exist for same name+set
      const existing = pricingByName.get(nk);
      if (!existing || data.price > (existing.prices?.normal?.market ?? 0)) {
        pricingByName.set(nk, tcgplayer);
      }
    }

    // Store % change data for the Market page columns
    if (data.pricePct24h != null || data.pricePct7d != null || data.pricePct30d != null) {
      const avgs: PokemonCard["cardmarketAvgs"] = {
        avg1: data.pricePct24h != null && data.price > 0 ? data.price / (1 + data.pricePct24h / 100) : null,
        avg7: data.pricePct7d != null && data.price > 0 ? data.price / (1 + data.pricePct7d / 100) : null,
        avg30: data.pricePct30d != null && data.price > 0 ? data.price / (1 + data.pricePct30d / 100) : null,
        trend: data.price,
      };
      cardmarketAvgsSeeded.set(cardId, avgs);
      if (data.cardName && data.setName) {
        const nk = nameKey(data.cardName, data.setName);
        if (!avgsByName.has(nk)) avgsByName.set(nk, avgs);
      }
    }
  }
}

// ─── Loader ───────────────────────────────────────────────────────────────────

async function loadCardIndex(): Promise<{ cards: PokemonCard[]; sets: PokemonSet[] }> {
  if (allCardsCache && allSetsCache) {
    return { cards: allCardsCache, sets: allSetsCache };
  }

  const [res, overrides] = await Promise.all([
    fetch("/data/all-cards.json"),
    getImageOverrides(),
  ]);
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
    // Use cached Supabase URL if available (top 1000 cards), else Scrydex CDN, else TCGdex
    const imageSmall = overrides[c.id] ?? c.imageSmall ?? (c.image ? c.image + "/low.webp" : "");
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

/** Fetch pricing for cards with concurrency limit to avoid flooding the network. */
export async function enrichPageWithPricing(
  cards: PokemonCard[],
  concurrency = 15,
): Promise<PokemonCard[]> {
  const results: PokemonCard[] = new Array(cards.length);
  let idx = 0;

  async function worker() {
    while (idx < cards.length) {
      const i = idx++;
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
    const avgs = cardmarketAvgsCache.get(card.id);
    return cached ? { ...card, tcgplayer: cached, cardmarketAvgs: avgs ?? undefined } : card;
  }

  // Name+set fallback — handles cards whose DB entry still uses the old TCGdex ID
  const nk = nameKey(card.name, card.set.name);
  const byName = pricingByName.get(nk);
  if (byName) {
    const avgs = avgsByName.get(nk);
    pricingCache.set(card.id, byName);
    if (avgs) cardmarketAvgsCache.set(card.id, avgs);
    return { ...card, tcgplayer: byName, cardmarketAvgs: avgs ?? undefined };
  }

  // No price in DB — mark as checked so we don't retry this session
  pricingCache.set(card.id, undefined);
  return card;
}

// ─── Public API functions ─────────────────────────────────────────────────────

export async function getSets(): Promise<SetSearchResult> {
  const { sets } = await loadCardIndex();
  return {
    data: sets,
    page: 1,
    pageSize: sets.length,
    count: sets.length,
    totalCount: sets.length,
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
  const { cards, sets } = await loadCardIndex();
  const physicalSetIds = new Set(sets.filter((s) => !s.isOnlineOnly).map((s) => s.id));
  const pocketSetIds = new Set(sets.filter((s) => s.isOnlineOnly).map((s) => s.id));

  // Default: physical TCG only (never show TCG Pocket unless explicitly requested)
  let filtered = filters.productType === "pocket"
    ? cards.filter((c) => pocketSetIds.has(c.set.id))
    : cards.filter((c) => physicalSetIds.has(c.set.id));

  if (query) {
    const q = query.toLowerCase();
    filtered = filtered.filter((c) => c.name.toLowerCase().includes(q));
  }
  if (filters.setId) {
    filtered = filtered.filter((c) => c.set.id === filters.setId);
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

  // Sort
  const sortBy = filters.sortBy || "-set.releaseDate";
  const desc = sortBy.startsWith("-");
  const field = sortBy.replace(/^-/, "");

  if (field !== "set.releaseDate" || desc !== true) {
    // Default sort (newest-first) is already applied at load time; only re-sort when different
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let valA: string, valB: string;
      if (field === "set.releaseDate") { valA = a.set.releaseDate; valB = b.set.releaseDate; }
      else if (field === "name") { valA = a.name; valB = b.name; }
      else if (field === "number") { valA = a.number.padStart(5, "0"); valB = b.number.padStart(5, "0"); }
      else { valA = a.name; valB = b.name; }
      const cmp = valA.localeCompare(valB);
      return desc ? -cmp : cmp;
    });
    return paginate(sorted, page, pageSize);
  }

  return paginate(filtered, page, pageSize);
}

export async function getSetCards(
  setId: string,
  page = 1,
  pageSize = 20,
): Promise<SearchResult> {
  const { cards } = await loadCardIndex();
  const filtered = cards
    .filter((c) => c.set.id === setId)
    .sort((a, b) => a.number.padStart(5, "0").localeCompare(b.number.padStart(5, "0")));
  return paginate(filtered, page, pageSize);
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
  const prices = card.tcgplayer?.prices;
  if (!prices) return null;
  const priceData =
    prices.holofoil ||
    prices.normal ||
    prices.reverseHolofoil ||
    prices["1stEditionHolofoil"];
  return priceData?.market ?? priceData?.mid ?? null;
}

export function getLowPrice(card: PokemonCard): number | null {
  const prices = card.tcgplayer?.prices;
  if (!prices) return null;
  const priceData =
    prices.holofoil ||
    prices.normal ||
    prices.reverseHolofoil ||
    prices["1stEditionHolofoil"];
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
  { value: "-set.releaseDate", label: "Newest First" },
  { value: "set.releaseDate", label: "Oldest First" },
  { value: "name", label: "Name A-Z" },
  { value: "-name", label: "Name Z-A" },
  { value: "number", label: "Card Number" },
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

// ─── Card detail (full TCGdex card shape) ─────────────────────────────────────

export interface CardDetailFull {
  id: string;
  name: string;
  hp?: number;
  types?: string[];
  stage?: string;
  suffix?: string;
  illustrator?: string;
  rarity?: string;
  regulationMark?: string;
  attacks?: Array<{
    cost?: string[];
    name: string;
    damage?: string;
    effect?: string;
  }>;
  abilities?: Array<{
    type: string;
    name: string;
    effect: string;
  }>;
  weaknesses?: Array<{ type: string; value: string }>;
  resistances?: Array<{ type: string; value: string }>;
  retreat?: number;
  variants?: {
    firstEdition?: boolean;
    holo?: boolean;
    normal?: boolean;
    reverse?: boolean;
  };
  legal?: { standard?: boolean; expanded?: boolean };
  pricing?: {
    tcgplayer?: Record<string, {
      lowPrice?: number;
      midPrice?: number;
      highPrice?: number;
      marketPrice?: number;
    }>;
    cardmarket?: Record<string, number>;
  };
  set?: { id: string; name: string; releaseDate?: string };
}

export async function getCardById(id: string): Promise<PokemonCard | null> {
  const { cards } = await loadCardIndex();
  return cards.find((c) => c.id === id) ?? null;
}

/** Map a Scrydex card response to the CardDetailFull shape used by CardDetail page. */
function mapScrydexToCardDetail(s: Record<string, unknown>): CardDetailFull {
  const attacks = (s.attacks as Array<Record<string, unknown>> | undefined)?.map((a) => ({
    cost: a.cost as string[] | undefined,
    name: String(a.name ?? ""),
    damage: a.damage != null ? String(a.damage) : undefined,
    effect: a.effect != null ? String(a.effect) : undefined,
  }));
  const abilities = (s.abilities as Array<Record<string, unknown>> | undefined)?.map((a) => ({
    type: String(a.type ?? "Ability"),
    name: String(a.name ?? ""),
    effect: String(a.effect ?? ""),
  }));
  const weaknesses = (s.weaknesses as Array<Record<string, unknown>> | undefined)?.map((w) => ({
    type: String(w.type ?? ""),
    value: String(w.value ?? ""),
  }));
  const resistances = (s.resistances as Array<Record<string, unknown>> | undefined)?.map((r) => ({
    type: String(r.type ?? ""),
    value: String(r.value ?? ""),
  }));

  // Extract market price from Scrydex variants for the detail page
  const variants = s.variants as Array<{ name: string; prices?: Array<{ market: number; low: number; currency: string }> }> | undefined;
  let marketPrice: number | undefined;
  for (const v of variants ?? []) {
    for (const p of v.prices ?? []) {
      if (p.currency === "USD" && p.market > 0) { marketPrice = p.market; break; }
    }
    if (marketPrice) break;
  }

  const exp = s.expansion as Record<string, unknown> | undefined;

  return {
    id: String(s.id ?? ""),
    name: String(s.name ?? ""),
    hp: s.hp != null ? Number(s.hp) : undefined,
    types: s.types as string[] | undefined,
    stage: s.stage as string | undefined,
    rarity: s.rarity as string | undefined,
    illustrator: s.illustrator as string | undefined,
    regulationMark: s.regulation_mark as string | undefined,
    attacks: attacks?.length ? attacks : undefined,
    abilities: abilities?.length ? abilities : undefined,
    weaknesses: weaknesses?.length ? weaknesses : undefined,
    resistances: resistances?.length ? resistances : undefined,
    retreat: s.retreat_cost != null ? Number(s.retreat_cost) : undefined,
    set: exp ? { id: String(exp.id ?? ""), name: String(exp.name ?? ""), releaseDate: exp.release_date as string | undefined } : undefined,
    pricing: marketPrice
      ? { tcgplayer: { normal: { marketPrice, lowPrice: marketPrice, midPrice: marketPrice, highPrice: marketPrice } } }
      : undefined,
  };
}

export async function fetchCardDetail(id: string): Promise<CardDetailFull | null> {
  // Try Scrydex first (cards now use Scrydex IDs)
  try {
    const { data, error } = await supabase.functions.invoke("scrydex-proxy", {
      body: { endpoint: `/pokemon/v1/en/cards/${id}` },
    });
    if (!error && data?.status === 200 && data.data) {
      return mapScrydexToCardDetail(data.data as Record<string, unknown>);
    }
  } catch { /* fall through to TCGdex */ }

  // Fall back to TCGdex (works for legacy IDs, may still match some cards)
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${id}`);
    if (res.ok) return await res.json();
  } catch { /* ignore */ }

  return null;
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
  const { cards, sets } = await loadCardIndex();
  // Always restrict to physical (non-online) sets — never show TCG Pocket on market
  const physicalSetIds = new Set(sets.filter((s) => !s.isOnlineOnly).map((s) => s.id));
  const allowedIds = opts.setIds
    ? new Set([...opts.setIds].filter((id) => physicalSetIds.has(id)))
    : physicalSetIds;
  let filtered = cards.filter((c) => allowedIds.has(c.set.id));

  // Apply cached prices + % change data (from DB snapshots seeded at init)
  // ID lookup is exact (Scrydex ID → Scrydex snapshot). Name fallback is used only while
  // price_snapshots still has old TCGdex IDs — but we must deduplicate by name+set when
  // using it, since multiple Scrydex variants share a name and would all get the same price.
  const nameUsedForPrice = new Set<string>(); // guards against duplicate name-matched cards

  const withPrices = filtered.map((card) => {
    let enriched = card;
    if (!enriched.tcgplayer?.prices) {
      const byId = pricingCache.get(card.id);
      if (byId) {
        // Exact Scrydex ID match — always use
        enriched = { ...enriched, tcgplayer: byId };
      } else {
        // Name+set fallback: only apply to the FIRST card with this name+set
        // (prevents duplicates while DB still holds old TCGdex IDs)
        const nk = nameKey(card.name, card.set.name);
        if (!nameUsedForPrice.has(nk)) {
          const byName = pricingByName.get(nk);
          if (byName) {
            nameUsedForPrice.add(nk);
            enriched = { ...enriched, tcgplayer: byName };
          }
        }
      }
    }
    if (!enriched.cardmarketAvgs) {
      const avgs = cardmarketAvgsSeeded.get(card.id) ?? avgsByName.get(nameKey(card.name, card.set.name));
      if (avgs) enriched = { ...enriched, cardmarketAvgs: avgs };
    }
    return enriched;
  });

  // Deduplicate: keep only one listing per name+set (highest price wins)
  const seenNameSet = new Set<string>();
  return withPrices
    .filter((c) => getMarketPrice(c) !== null)
    .sort((a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0))
    .filter((c) => {
      const nk = nameKey(c.name, c.set.name);
      if (seenNameSet.has(nk)) return false;
      seenNameSet.add(nk);
      return true;
    })
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

