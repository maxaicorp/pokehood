// ─── Local-first data layer ───────────────────────────────────────────
// Reads from the TCGdex JSON files we downloaded into /public/data/
// and maps them into the PokemonCard / PokemonSet interfaces the UI expects.

// ─── Interfaces (unchanged for UI compatibility) ──────────────────────

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
    images: {
      symbol: string;
      logo: string;
    };
  };
  number: string;
  rarity?: string;
  images: {
    small: string;
    large: string;
  };
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
  images: {
    symbol: string;
    logo: string;
  };
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

// ─── Local data cache ─────────────────────────────────────────────────

interface TCGDexCard {
  id: string;
  name: string;
  image: string;
  localId: string;
  rarity?: string;
  category?: string;
  hp?: number;
  types?: string[];
}

interface TCGDexSet {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  releaseDate?: string;
  serie?: { id: string; name: string };
  cardCount?: { total: number; official: number };
  cards?: TCGDexCard[];
}

let setsListCache: TCGDexSet[] | null = null;
let allCardsCache: PokemonCard[] | null = null;

const CACHE_VERSION = "v1";
const SETS_CACHE_KEY = `pokevault_sets_${CACHE_VERSION}`;
const CARDS_CACHE_KEY = `pokevault_cards_${CACHE_VERSION}`;

async function loadSetsList(): Promise<TCGDexSet[]> {
  if (setsListCache) return setsListCache;

  // Try localStorage first
  try {
    const cached = localStorage.getItem(SETS_CACHE_KEY);
    if (cached) {
      setsListCache = JSON.parse(cached);
      return setsListCache!;
    }
  } catch { /* ignore */ }

  const res = await fetch("/data/sets-list.json");
  if (!res.ok) throw new Error("Failed to load sets list");
  setsListCache = await res.json();

  // Cache to localStorage
  try { localStorage.setItem(SETS_CACHE_KEY, JSON.stringify(setsListCache)); } catch { /* ignore */ }
  return setsListCache!;
}

async function loadSetData(setId: string): Promise<TCGDexSet> {
  const res = await fetch(`/data/sets/${setId}.json`);
  if (!res.ok) throw new Error(`Failed to load set ${setId}`);
  return res.json();
}

function mapCard(card: TCGDexCard, set: TCGDexSet): PokemonCard {
  return {
    id: card.id,
    name: card.name,
    supertype: card.category || "Pokémon",
    hp: card.hp ? String(card.hp) : undefined,
    types: card.types,
    set: {
      id: set.id,
      name: set.name,
      series: set.serie?.name || "Unknown",
      printedTotal: set.cardCount?.official || 0,
      total: set.cardCount?.total || 0,
      releaseDate: set.releaseDate || "2000-01-01",
      images: {
        symbol: set.symbol || "",
        logo: set.logo || "",
      },
    },
    number: card.localId,
    rarity: card.rarity,
    images: {
      small: card.image + "/low.webp",
      large: card.image + "/high.webp",
    },
  };
}

function mapSet(set: TCGDexSet): PokemonSet {
  return {
    id: set.id,
    name: set.name,
    series: set.serie?.name || "Unknown",
    printedTotal: set.cardCount?.official || 0,
    total: set.cardCount?.total || 0,
    releaseDate: set.releaseDate || "2000-01-01",
    updatedAt: set.releaseDate || "2000-01-01",
    images: {
      symbol: set.symbol || "",
      logo: set.logo || "",
    },
  };
}

// Load ALL cards from ALL sets (cached after first load)
async function loadAllCards(): Promise<PokemonCard[]> {
  if (allCardsCache) return allCardsCache;

  // Try localStorage first
  try {
    const cached = localStorage.getItem(CARDS_CACHE_KEY);
    if (cached) {
      allCardsCache = JSON.parse(cached);
      return allCardsCache!;
    }
  } catch { /* ignore */ }
  
  const setsList = await loadSetsList();
  const allCards: PokemonCard[] = [];
  
  // Load sets in parallel batches of 10
  for (let i = 0; i < setsList.length; i += 10) {
    const batch = setsList.slice(i, i + 10);
    const results = await Promise.allSettled(
      batch.map(async (s) => {
        try {
          const setData = await loadSetData(s.id);
          return (setData.cards || []).map((c) => mapCard(c, setData));
        } catch {
          return [];
        }
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") allCards.push(...r.value);
    }
  }

  allCardsCache = allCards;

  // Cache to localStorage (may fail if too large, that's ok)
  try { localStorage.setItem(CARDS_CACHE_KEY, JSON.stringify(allCards)); } catch { /* ignore */ }
  return allCards;
}

// ─── Public API functions (same signatures as before) ─────────────────

export async function searchCards(
  query: string,
  page = 1,
  pageSize = 20,
): Promise<SearchResult> {
  const allCards = await loadAllCards();
  const q = query.toLowerCase();
  const filtered = allCards.filter((c) =>
    c.name.toLowerCase().includes(q)
  );
  // Sort newest first
  filtered.sort((a, b) => b.set.releaseDate.localeCompare(a.set.releaseDate));
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
  } = {},
  page = 1,
  pageSize = 20,
): Promise<SearchResult> {
  const allCards = await loadAllCards();
  let filtered = [...allCards];

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
  filtered.sort((a, b) => {
    let valA: string, valB: string;
    if (field === "set.releaseDate") {
      valA = a.set.releaseDate;
      valB = b.set.releaseDate;
    } else if (field === "name") {
      valA = a.name;
      valB = b.name;
    } else if (field === "number") {
      valA = a.number.padStart(5, "0");
      valB = b.number.padStart(5, "0");
    } else {
      valA = a.name;
      valB = b.name;
    }
    const cmp = valA.localeCompare(valB);
    return desc ? -cmp : cmp;
  });

  return paginate(filtered, page, pageSize);
}

export async function getLatestCards(
  page = 1,
  pageSize = 20,
): Promise<SearchResult> {
  const allCards = await loadAllCards();
  // Sort newest first by set release date
  const sorted = [...allCards].sort((a, b) =>
    b.set.releaseDate.localeCompare(a.set.releaseDate)
  );
  return paginate(sorted, page, pageSize);
}

export async function getSets(): Promise<SetSearchResult> {
  const setsList = await loadSetsList();
  const mapped = setsList.map(mapSet);
  // Sort newest first
  mapped.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  return {
    data: mapped,
    page: 1,
    pageSize: mapped.length,
    count: mapped.length,
    totalCount: mapped.length,
  };
}

export async function getSetCards(
  setId: string,
  page = 1,
  pageSize = 20,
): Promise<SearchResult> {
  const setData = await loadSetData(setId);
  const cards = (setData.cards || []).map((c) => mapCard(c, setData));
  // Sort by card number
  cards.sort((a, b) => a.number.padStart(5, "0").localeCompare(b.number.padStart(5, "0")));
  return paginate(cards, page, pageSize);
}

// ─── Helpers ──────────────────────────────────────────────────────────

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

export const CARD_RARITIES = [
  "Common",
  "Uncommon",
  "Rare",
  "Rare Holo",
  "Rare Holo EX",
  "Rare Holo GX",
  "Rare Holo V",
  "Rare VMAX",
  "Rare VSTAR",
  "Rare Ultra",
  "Rare Secret",
  "Rare Rainbow",
  "Illustration Rare",
  "Special Illustration Rare",
  "Hyper Rare",
  "Double Rare",
  "Ultra Rare",
  "Shiny Rare",
  "Shiny Ultra Rare",
  "ACE SPEC Rare",
  "Amazing Rare",
  "Promo",
];

export const CARD_TYPES = [
  "Colorless",
  "Darkness",
  "Dragon",
  "Fairy",
  "Fighting",
  "Fire",
  "Grass",
  "Lightning",
  "Metal",
  "Psychic",
  "Water",
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
