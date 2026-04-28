import type { PokemonCard, PokemonSet } from "./pokemon-api";

const KEY = "market-cache-v4-early-variants-only";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface MarketCache {
  sets: PokemonSet[];
  cards: PokemonCard[];
  selectedSetId: string;
  savedAt: number;
}

export function loadMarketCache(selectedSetId: string): MarketCache | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MarketCache;
    if (!parsed?.cards?.length || !parsed?.sets?.length || !parsed?.savedAt) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    if (parsed.selectedSetId !== selectedSetId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveMarketCache(payload: Omit<MarketCache, "savedAt">) {
  try {
    const toSave: MarketCache = { ...payload, savedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(toSave));
  } catch {
    // Quota exceeded or disabled — ignore
  }
}
