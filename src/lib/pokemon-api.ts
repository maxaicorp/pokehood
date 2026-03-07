const BASE_URL = "/api";

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

export async function searchCards(
  query: string,
  page = 1,
  pageSize = 20,
): Promise<SearchResult> {
  const params = new URLSearchParams({
    q: `name:"${query}*"`,
    page: String(page),
    pageSize: String(pageSize),
    orderBy: "-set.releaseDate",
  });

  const res = await fetch(`${BASE_URL}/cards?${params}`);
  if (!res.ok) throw new Error("Failed to search cards");
  return res.json();
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
  const qParts: string[] = [];
  if (query) qParts.push(`name:"${query}*"`);
  if (filters.setId) qParts.push(`set.id:"${filters.setId}"`);
  if (filters.rarity) qParts.push(`rarity:"${filters.rarity}"`);
  if (filters.supertype) qParts.push(`supertype:"${filters.supertype}"`);
  if (filters.types?.length) {
    qParts.push(`types:"${filters.types.join('" OR types:"')}"`);
  }

  const params = new URLSearchParams({
    q: qParts.join(" "),
    page: String(page),
    pageSize: String(pageSize),
    orderBy: filters.sortBy || "-set.releaseDate",
  });

  const res = await fetch(`${BASE_URL}/cards?${params}`);
  if (!res.ok) throw new Error("Failed to search cards");
  return res.json();
}

export async function getLatestCards(
  page = 1,
  pageSize = 20,
): Promise<SearchResult> {
  const params = new URLSearchParams({
    q: 'supertype:"Pokémon"',
    page: String(page),
    pageSize: String(pageSize),
    orderBy: "-set.releaseDate",
  });

  const res = await fetch(`${BASE_URL}/cards?${params}`);
  if (!res.ok) throw new Error("Failed to fetch latest cards");
  return res.json();
}

export async function getSets(): Promise<SetSearchResult> {
  const params = new URLSearchParams({
    orderBy: "-releaseDate",
    pageSize: "50",
  });

  const res = await fetch(`${BASE_URL}/sets?${params}`);
  if (!res.ok) throw new Error("Failed to fetch sets");
  return res.json();
}

export async function getSetCards(
  setId: string,
  page = 1,
  pageSize = 20,
): Promise<SearchResult> {
  const params = new URLSearchParams({
    q: `set.id:"${setId}"`,
    page: String(page),
    pageSize: String(pageSize),
    orderBy: "number",
  });

  const res = await fetch(`${BASE_URL}/cards?${params}`);
  if (!res.ok) throw new Error("Failed to fetch set cards");
  return res.json();
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
