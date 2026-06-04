// ─── Data layer ───────────────────────────────────────────────────────────────
// Card/set metadata: single fetch from /data/all-cards.json (browser-cached)
// Pricing: DB snapshots (seeded at init via seedPricingCache) — zero live API calls per user
// Card detail: Scrydex proxy

import { supabase } from "@/integrations/supabase/client";
import { getLatestSnapshotPrices, getLatestPricesForSet, type LatestPrice } from "@/lib/price-snapshots";
import { PRICE_CACHE_TTL_MS, registerCacheResetter } from "@/lib/cache-invalidation";

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
  artist?: string;
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
  // Scrydex CDN URLs — single source of truth. No legacy TCGdex fallback.
  imageSmall: string;
  imageLarge: string;
  localId: string;
  setId: string;
  rarity?: string;
  supertype?: string;
  subtypes?: string[];
  types?: string[];
  hp?: string | null;
  artist?: string | null;
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
const CARD_INDEX_VERSION = "2026-06-02-me4-chase-cards";
let pricingSeedPromise: Promise<void> | null = null;
let pricingSeededAt = 0;

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
  // No clear() — appendPricingCache overwrites every key present in `prices`
  // with the current values, so fresh data still wins for the cards in this
  // batch. Keys NOT in `prices` persist as the most recent value we have,
  // which is preferable to losing an Explore-page hydrate that ran in parallel.
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

  // Set totals/series/logo come from the LIGHTWEIGHT market-sets.json (~80 KB),
  // NOT all-cards.json (~9.9 MB). Card images are derived from card_id below, so
  // the list views (Market/Explore) never need to download the full card index.
  // This is the core fix for the >1s blank-screen slowdown on list pages.
  const { data: sets } = await getMarketSets();
  const setMetaById = new Map(sets.map((s) => [s.id, s]));

  return prices.map((price) => {
    const [baseId, variant] = price.cardId.split("::");
    const setId = baseId.split("-").slice(0, -1).join("-") || baseId;
    const number = baseId.split("-").at(-1) ?? "";
    const meta = setMetaById.get(setId);
    const baseSet = {
      id: setId,
      name: price.setName,
      series: meta?.series ?? "",
      printedTotal: meta?.printedTotal ?? meta?.total ?? 0,
      total: meta?.total ?? meta?.printedTotal ?? 0,
      releaseDate: meta?.releaseDate ?? "",
      images: meta?.images ?? { symbol: "", logo: "" },
    };
    const enriched: PokemonCard = {
      id: price.cardId,
      name: price.cardName,
      supertype: "Pokémon",
      set: baseSet,
      number,
      images: {
        small: `https://images.scrydex.com/pokemon/${baseId}/small`,
        large: `https://images.scrydex.com/pokemon/${baseId}/large`,
      },
      tcgplayer: pricingCache.get(price.cardId),
    };
    if (variant && isEarlyVariantSetId(setId)) {
      const category = getVintageVariantCategory(variant);
      enriched.name = `${price.cardName} (${formatVariantName(variant)})`;
      enriched.set = category ? { ...baseSet, id: `${setId}::${category}`, name: getVirtualSetName(price.setName, category) } : baseSet;
    }
    const avgs = cardmarketAvgsSeeded.get(price.cardId) ?? cardmarketAvgsCache.get(price.cardId);
    if (avgs) enriched.cardmarketAvgs = avgs;
    return enriched;
  });
}

async function ensurePricingCacheSeeded(): Promise<void> {
  // Fresh = seeded AND within TTL. A long-open tab past the TTL re-seeds on the
  // next access; an explicit reset (force-refresh) clears it immediately.
  const fresh = pricingCache.size > 0 && Date.now() - pricingSeededAt < PRICE_CACHE_TTL_MS;
  if (fresh) return;
  if (!pricingSeedPromise) {
    pricingSeedPromise = getLatestSnapshotPrices().then((prices) => {
      seedPricingCache(prices);
      pricingSeededAt = Date.now();
    }).catch(() => undefined).finally(() => { pricingSeedPromise = null; });
  }
  await pricingSeedPromise;
}

// Per-set seed timestamps so single-card / single-set pages can price just
// their own set (~250 rows) instead of blocking on the full ~22k-row table.
const seededSets = new Map<string, number>();

/**
 * Seed pricing for ONE set only (base + variant rows). This is the targeted
 * path for CardDetail / SetDetail — it replaces ensurePricingCacheSeeded()'s
 * full-table pull, which was the cause of the multi-second "extreme lag" on
 * the first card/set page of a session. Cheap enough to call on every nav;
 * a short per-set TTL guard avoids re-querying the same set repeatedly.
 */
async function seedPricesForSet(setId: string): Promise<void> {
  if (!setId) return;
  const at = seededSets.get(setId);
  if (at && Date.now() - at < PRICE_CACHE_TTL_MS) return;
  const prices = await getLatestPricesForSet(setId);
  appendPricingCache(prices);
  seededSets.set(setId, Date.now());
}

/** Drop the seeded pricing so the next read re-pulls from the DB. */
export function resetPricingCache(): void {
  pricingCache.clear();
  pricingSeedPromise = null;
  pricingSeededAt = 0;
  seededSets.clear();
}
registerCacheResetter(resetPricingCache);

// ─── Loader ───────────────────────────────────────────────────────────────────

// Live catalog from the `cards` DB table (populated weekly by the
// sync-cards-catalog edge fn from Scrydex). This is the self-updating
// replacement for the frozen static all-cards.json — once it's populated, new
// cards in any set (e.g. me4's 101-122 chase cards) appear with no rebuild.
// Returns null when the table is empty/unavailable so loadCardIndex falls back
// to the static JSON — which makes shipping this a no-op until the table exists.
async function loadCatalogFromDb(): Promise<{ cards: PokemonCard[]; sets: PokemonSet[] } | null> {
  type Row = { id: string; name: string; set_id: string; set_name: string; number: string; rarity: string | null; supertype: string | null; series: string | null; artist?: string | null };
  const PAGE = 2000;
  const rows: Row[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await (supabase.rpc as any)("get_card_catalog", { p_limit: PAGE, p_offset: offset });
    if (error) {
      if (offset === 0) return null; // table/RPC not deployed yet → fall back
      break;                          // partial read → use what we have
    }
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  // Sanity gate: never switch off the static index for a half-populated table
  // (a partial sync shouldn't shrink the catalog the whole site renders from).
  if (rows.length < 1000) return null;

  const { data: marketSets } = await getMarketSets();
  const setMetaById = new Map(marketSets.map((s) => [s.id, s]));

  // Build the set list from the catalog, enriched with market-sets.json
  // metadata (logo/symbol/dates). `total` takes the live catalog count so new
  // secret rares bump the set size; logos for sets not yet in market-sets.json
  // are derived from the Scrydex CDN pattern (same one market-sets.json uses).
  const setCounts = new Map<string, number>();
  const setNames = new Map<string, string>();
  const setSeries = new Map<string, string>();
  for (const r of rows) {
    setCounts.set(r.set_id, (setCounts.get(r.set_id) ?? 0) + 1);
    if (r.set_name) setNames.set(r.set_id, r.set_name);
    if (r.series) setSeries.set(r.set_id, r.series);
  }
  const sets: PokemonSet[] = [...setCounts.keys()].map((id) => {
    const meta = setMetaById.get(id);
    const series = meta?.series ?? setSeries.get(id) ?? "Unknown";
    return {
      id,
      name: meta?.name ?? setNames.get(id) ?? id,
      series,
      printedTotal: meta?.printedTotal ?? setCounts.get(id) ?? 0,
      total: Math.max(meta?.total ?? 0, setCounts.get(id) ?? 0),
      releaseDate: meta?.releaseDate ?? "2000-01-01",
      updatedAt: meta?.releaseDate ?? "2000-01-01",
      isOnlineOnly: meta?.isOnlineOnly ?? TCGP_SERIES_IDS.includes(series.toLowerCase()),
      images: meta?.images ?? {
        symbol: `https://images.scrydex.com/pokemon/${id}-symbol/symbol`,
        logo: `https://images.scrydex.com/pokemon/${id}-logo/logo`,
      },
    };
  });
  sets.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));

  const setById = new Map(sets.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const cards: PokemonCard[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const s = setById.get(r.set_id);
    cards.push({
      id: r.id,
      name: r.name,
      supertype: r.supertype ?? "Pokémon",
      rarity: r.rarity || undefined,
      artist: r.artist || undefined,
      set: {
        id: r.set_id,
        name: s?.name ?? r.set_name ?? r.set_id,
        series: s?.series ?? "Unknown",
        printedTotal: s?.printedTotal ?? 0,
        total: s?.total ?? 0,
        releaseDate: s?.releaseDate ?? "2000-01-01",
        images: s?.images ?? { symbol: "", logo: "" },
      },
      number: r.number,
      // Scrydex CDN, derived from the card id — same as hydrateCardsFromLatestPrices.
      images: {
        small: `https://images.scrydex.com/pokemon/${r.id}/small`,
        large: `https://images.scrydex.com/pokemon/${r.id}/large`,
      },
    });
  }
  cards.sort((a, b) => b.set.releaseDate.localeCompare(a.set.releaseDate));
  return { cards, sets };
}

async function loadCardIndex(): Promise<{ cards: PokemonCard[]; sets: PokemonSet[] }> {
  if (allCardsCache && allSetsCache) {
    return { cards: allCardsCache, sets: allSetsCache };
  }

  // The static all-cards.json is built FIRST and used as the completeness
  // floor: we only switch to the live DB catalog if it's at least as complete
  // (see the end of this fn). That way a PARTIAL sync-cards-catalog run can
  // never drop older sets from the site.

  // The ?v=CARD_INDEX_VERSION query param is the cache-buster: when the catalog
  // is rebuilt the version changes → new URL → fresh fetch. So we WANT the
  // browser to cache this 9.9 MB file aggressively between loads. The old
  // `cache: "no-store"` re-downloaded all 9.9 MB on every navigation — that was
  // the >1s blank-screen slowdown on dedicated pages.
  const res = await fetch(`/data/all-cards.json?v=${CARD_INDEX_VERSION}`, {
    cache: "force-cache",
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
    // Scrydex CDN images — single source of truth. No legacy fallback.
    // If imageSmall/Large is missing on any card, that's a data sync bug to fix
    // upstream, not something to paper over here.
    const imageSmall = c.imageSmall ?? "";
    const imageLarge = c.imageLarge ?? "";
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

  // Upgrade to the live DB catalog ONLY if it's at least as complete as the
  // static index. A partial sync (fewer cards than we ship statically) is
  // ignored so it can never drop sets; once the catalog is fully populated
  // (>= static count) it takes over and new cards appear automatically.
  try {
    const live = await loadCatalogFromDb();
    if (live && live.cards.length >= cards.length) {
      allCardsCache = live.cards;
      allSetsCache = live.sets;
      return live;
    }
    // The live catalog is present but SMALLER than the static index — by design,
    // because sync-cards-catalog excludes TCG Pocket / online-only cards that the
    // static file includes (~3k of them). So we must NOT switch wholesale (that
    // would drop every Pocket card). Instead overlay the live catalog's richer
    // fields — artist — onto the static cards by id, so the Explore artist filter
    // has something to match. Without this the filter dropdown lists artists
    // (read straight from the DB) but matches zero cards (static cards have no
    // artist), which looks like "the filter is broken".
    if (live?.cards.length) {
      const artistById = new Map<string, string>();
      for (const lc of live.cards) if (lc.artist) artistById.set(lc.id, lc.artist);
      if (artistById.size) {
        for (const c of cards) {
          const a = artistById.get(c.id);
          if (a) c.artist = a;
        }
      }
    }
  } catch (e) {
    console.warn("[catalog] live cards table unavailable/incomplete; using static all-cards.json", e);
  }

  allCardsCache = cards;
  allSetsCache = sets;
  return { cards, sets };
}

/** Distinct card artists (with counts) for the Explore "Artist" filter.
 *  Backed by the get_card_artists RPC over the live `cards` table — returns []
 *  until the catalog is synced with artist data (graceful empty filter). */
let artistListCache: { artist: string; count: number }[] | null = null;
export async function getCardArtists(): Promise<{ artist: string; count: number }[]> {
  if (artistListCache) return artistListCache;
  try {
    const { data, error } = await (supabase.rpc as any)("get_card_artists");
    if (error || !Array.isArray(data)) return [];
    artistListCache = (data as { artist: string; card_count: number }[])
      .filter((r) => r.artist)
      .map((r) => ({ artist: r.artist, count: Number(r.card_count) || 0 }));
    return artistListCache;
  } catch {
    return [];
  }
}

// Per-set card cache — set-scoped pages load one small file instead of the
// 10MB monolith.
const setCardCache = new Map<string, PokemonCard[]>();

/** Derive the setId from a card id ("{setId}-{localId}"). Handles multi-dash
 *  set ids like "tcgp-PB-11" → "tcgp-PB". */
function setIdFromCardId(cardId: string): string {
  const base = cardId.split("::")[0];
  return base.split("-").slice(0, -1).join("-") || base;
}

/** Load a SINGLE set's cards from its per-set file
 *  (public/data/cards/{setId}.json, ~50-200KB) instead of the 10MB
 *  all-cards.json. Returns [] if the file is missing so callers can fall back
 *  (e.g. buildCardFromDb for a brand-new card whose set file isn't built yet). */
async function loadSetCardIndex(setId: string): Promise<PokemonCard[]> {
  const cached = setCardCache.get(setId);
  if (cached) return cached;
  let res: Response;
  try {
    res = await fetch(`/data/cards/${encodeURIComponent(setId)}.json?v=${CARD_INDEX_VERSION}`, { cache: "force-cache" });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = (await res.json()) as { set: CardIndexSet & { id: string }; cards: CardIndexCard[] };
  const s = data.set;
  const setMeta: PokemonCard["set"] = {
    id: setId,
    name: s?.name ?? setId,
    series: s?.series ?? "Unknown",
    printedTotal: s?.printedTotal ?? 0,
    total: s?.total ?? 0,
    releaseDate: s?.releaseDate ?? "2000-01-01",
    images: { symbol: s?.symbol ?? "", logo: s?.logo ?? "" },
  };
  const seen = new Set<string>();
  const cards: PokemonCard[] = [];
  for (const c of data.cards ?? []) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    cards.push({
      id: c.id,
      name: c.name,
      supertype: c.supertype ?? "Pokémon",
      subtypes: c.subtypes,
      types: c.types?.length ? c.types : undefined,
      hp: c.hp ?? undefined,
      rarity: c.rarity || undefined,
      set: setMeta,
      number: c.localId,
      images: { small: c.imageSmall ?? "", large: c.imageLarge ?? "" },
    });
  }
  setCardCache.set(setId, cards);
  return cards;
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
const EARLY_VARIANT_SET_IDS = new Set([
  "base1", "base2", "base3", "base4", "base5", "base6",
  "gym1", "gym2",
  "neo1", "neo2", "neo3", "neo4",
]);

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

function isEarlyVariantSetId(setId: string): boolean {
  return EARLY_VARIANT_SET_IDS.has(setId.split("::")[0]);
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

    const hasVintage = isEarlyVariantSetId(card.set.id) && matches.some((m) => isVintageVariantSuffix(m.suffix));

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

    // Vintage card: drop the bare row (it's an ambiguous duplicate of one of
    // the suffixed printings) but keep ALL non-bare variants — including
    // modern markers like ::holofoil and ::reverseHolofoil. A Legendary
    // Collection card can legitimately have BOTH a 1st Edition Holo and a
    // Reverse Holo printing, and previous logic was hiding the Reverse Holo.
    const vintageMatches = matches.filter((m) => m.suffix !== "");

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

  // Ensure the in-memory cache holds THIS card's price before we peek at it.
  // Market/Explore seed in bulk on mount; other pages (SetDetail, CardDetail,
  // GlobalSearch) reach here. If the card isn't cached yet, seed only its set
  // (~250 rows) — NOT the full ~22k table, which was the multi-second stall on
  // the first card/set page of a session. No-op once the set is seeded.
  if (!pricingCache.has(card.id)) {
    await seedPricesForSet(setIdFromCardId(card.id));
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
    if (!isEarlyVariantSetId(baseCard.set.id)) continue;
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

/** Lightweight set metadata for Market. Avoids downloading/parsing all cards on the public homepage. */
export async function getMarketSets(): Promise<SetSearchResult> {
  const res = await fetch(`/data/market-sets.json?v=${CARD_INDEX_VERSION}`, {
    cache: "force-cache",
  });
  if (!res.ok) return getSets();

  const json = await res.json() as { sets?: PokemonSet[] };
  const sets = (json.sets ?? []).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));

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

// Shared search haystack — everything a query token can match against. Uses the
// fields we actually store (name / set / number / rarity / supertype / subtypes
// / types). NOTE: variant/finish terms (cosmos holo, reverse holo) are NOT here
// — the pipeline doesn't store per-variant finish names, so those need a data
// step before they're searchable.
export function buildCardSearchText(c: PokemonCard): string {
  return [
    c.name,
    c.set?.name,
    c.set?.id,
    c.number,
    c.rarity,
    c.supertype,
    c.artist,
    ...(c.subtypes ?? []),
    ...(c.types ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
}

// Query-token synonyms → words that actually appear in the haystack, so "sir"
// finds a Special Illustration Rare, "fa" finds Full Art, etc.
const SEARCH_ALIASES: Record<string, string[]> = {
  sir: ["special illustration rare"],
  ir: ["illustration rare"],
  ur: ["ultra rare"],
  sr: ["secret rare", "super rare"],
  hr: ["hyper rare"],
  fa: ["full art"],
  alt: ["alternate art", "illustration rare"],
};

/** Clean buy-search string: strips the "(Unlimited Holo)" variant parenthetical
 *  from name + set, since selling sites list cards as "<Pokémon> <Set>". */
export function buyQueryForCard(card: { name: string; set: { name: string } }): string {
  const strip = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return `${strip(card.name)} ${strip(card.set.name)}`.trim();
}

export async function searchCardsAdvanced(
  query: string,
  filters: {
    setId?: string;
    rarity?: string;
    supertype?: string;
    types?: string[];
    artist?: string;
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
    // Per-token matching across name / set / number, so multi-word queries
    // like "charmander 38" find a specific Charmander #38. Previously the
    // whole query was substring-matched only against name + set, which
    // returned zero results the moment the user added a card number.
    //
    // Rules per token:
    //   - Numeric token (digits only) matches if the card's number,
    //     printed_number, or trailing card_id portion includes it.
    //   - Alphabetic token matches name OR set name OR set id.
    //   - All tokens must match (logical AND) so adding tokens narrows.
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      filtered = filtered.filter((c) => {
        const number = (c.number ?? "").toLowerCase();
        const hay = buildCardSearchText(c); // name/set/number/rarity/supertype/subtypes/types
        return tokens.every((tok) => {
          if (/^\d+$/.test(tok)) {
            // Numeric: match the local card number. Lenient — accepts both
            // "38" and "038" against a number like "38" or "038".
            const padded = tok.padStart(3, "0");
            return number === tok
              || number === padded
              || number.replace(/^0+/, "") === tok.replace(/^0+/, "")
              || number.includes(tok);
          }
          // Match the full haystack, then try alias expansions (sir → special
          // illustration rare, etc.). All tokens must match (AND) so adding a
          // word narrows: "fire charizard", "sir pikachu".
          if (hay.includes(tok)) return true;
          const alts = SEARCH_ALIASES[tok];
          return alts ? alts.some((a) => hay.includes(a)) : false;
        });
      });
    }
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
  if (filters.artist) {
    filtered = filtered.filter((c) => c.artist === filters.artist);
  }

  // Expand variants
  const expanded = expandVariants(filtered, filters.setId ? new Set([filters.setId]) : undefined);
  const sorted = [...expanded];

  // Relevance mode: when there's a query and the caller didn't request an
  // explicit sort (e.g. the global search box passes no sortBy), rank by how
  // well the NAME matches so the obvious hit surfaces first. Previously
  // "charizard" came back sorted by card number, burying Charizard under
  // unrelated cards that merely shared a token in their set name. Explore
  // always passes a sortBy, so its dropdown still wins.
  if (query && filters.sortBy == null) {
    const q = query.toLowerCase().trim();
    const relevance = (c: PokemonCard): number => {
      const n = c.name.toLowerCase();
      if (n === q) return 0;          // exact name
      if (n.startsWith(q)) return 1;  // name prefix
      if (n.includes(q)) return 2;    // name substring
      return 3;                        // matched only via set / number token
    };
    sorted.sort((a, b) => {
      const ra = relevance(a), rb = relevance(b);
      if (ra !== rb) return ra - rb;
      // Tiebreak: more valuable cards first (the notable printings), then name.
      const priceDelta = (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0);
      if (priceDelta !== 0) return priceDelta;
      return a.name.localeCompare(b.name);
    });
    return paginate(sorted, page, pageSize);
  }

  // Explicit sort (Explore dropdown, etc.)
  const sortBy = filters.sortBy || "number";
  const desc = sortBy.startsWith("-");
  const field = sortBy.replace(/^-/, "");
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

// Unified catalog search result (cards + sealed) from the search_catalog RPC.
export interface CatalogSearchResult {
  id: string;
  name: string;
  setName: string;
  kind: "card" | "sealed";
  image: string;
}

/**
 * DB-backed, typo-tolerant search across single cards AND sealed products via
 * the search_catalog Postgres RPC (pg_trgm). Returns null if the RPC isn't
 * present yet (migration not run) so callers can fall back to the client
 * search — that keeps the box working before and after the migration.
 */
export async function searchCatalog(query: string, limit = 8): Promise<CatalogSearchResult[] | null> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await (supabase.rpc as any)("search_catalog", { p_query: q, p_limit: limit });
  if (error || !Array.isArray(data)) return null; // RPC missing/failed → fall back
  return data.map((r: any) => ({
    id: r.id,
    name: r.name,
    setName: r.set_name ?? "",
    kind: r.kind === "sealed" ? "sealed" : "card",
    image: r.image ?? "",
  }));
}

export async function getSetCards(
  setId: string,
  page = 1,
  pageSize = 20,
): Promise<SearchResult> {
  let baseSetId = setId;
  if (setId.includes("::")) baseSetId = setId.split("::")[0];

  // Price only this set (base + variant rows), not the full ~22k table.
  await seedPricesForSet(baseSetId);

  // Per-set file — already scoped to this set, no full-index scan.
  const filtered = await loadSetCardIndex(baseSetId);
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

export function formatPrice(price: number | null | undefined): string {
  // Guard null/undefined AND NaN/Infinity — a malformed price (e.g. Number("")
  // → NaN) would otherwise render "$NaN" across the UI.
  if (price == null || !Number.isFinite(price)) return "N/A";
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
  { value: "number", label: "Card Number: Low → High" },
  { value: "-number", label: "Card Number: High → Low" },
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

// Fallback for cards missing from the static index (e.g. a brand-new set whose
// catalog hasn't been rebuilt yet). Builds a minimal card from latest_card_prices
// + a derived image so the page renders real data instead of "Card not found".
// Full metadata (rarity/types/hp) is omitted until the catalog catches up.
async function buildCardFromDb(id: string): Promise<PokemonCard | null> {
  const baseId = id.split("::")[0];
  // Full metadata from the `cards` catalog table (Phase 4). Falls back to the
  // minimal latest_card_prices row if the catalog hasn't been populated yet.
  const { data: c } = await (supabase.from as any)("cards")
    .select("id, name, set_id, set_name, number, rarity, supertype, subtypes, types, hp, series")
    .eq("id", baseId)
    .maybeSingle();
  const { data: p } = c ? { data: null } : await (supabase.from as any)("latest_card_prices")
    .select("card_id, card_name, set_name")
    .eq("card_id", baseId)
    .maybeSingle();
  const src = c ?? (p ? { id: baseId, name: p.card_name, set_name: p.set_name } : null);
  if (!src) return null;

  const setId = (c?.set_id as string) || baseId.split("-").slice(0, -1).join("-") || baseId;
  const number = (c?.number as string) || baseId.split("-").at(-1) || "";
  let setMeta: PokemonSet | undefined;
  try { const { data: sets } = await getMarketSets(); setMeta = sets.find((s) => s.id === setId); } catch { /* tiny file; ignore */ }
  return {
    id: baseId,
    name: src.name,
    supertype: (c?.supertype as string) ?? "Pokémon",
    rarity: (c?.rarity as string) ?? undefined,
    subtypes: (c?.subtypes as string[]) ?? undefined,
    types: (c?.types as string[]) ?? undefined,
    hp: (c?.hp as string) ?? undefined,
    set: {
      id: setId, name: src.set_name, series: (c?.series as string) ?? setMeta?.series ?? "",
      printedTotal: setMeta?.printedTotal ?? setMeta?.total ?? 0,
      total: setMeta?.total ?? setMeta?.printedTotal ?? 0,
      releaseDate: setMeta?.releaseDate ?? "",
      images: setMeta?.images ?? { symbol: "", logo: "" },
    },
    number,
    images: {
      small: `https://images.scrydex.com/pokemon/${baseId}/small`,
      large: `https://images.scrydex.com/pokemon/${baseId}/large`,
    },
    tcgplayer: pricingCache.get(baseId),
  };
}

export async function getCardById(id: string): Promise<PokemonCard | null> {
  // Price only this card's set (~250 rows) instead of the full ~22k table —
  // the full pull was the "extreme lag" on the first card page of a session.
  await seedPricesForSet(setIdFromCardId(id));
  // Load only the card's own set file (~100KB) instead of the 10MB monolith.
  const cards = await loadSetCardIndex(setIdFromCardId(id));
  if (id.includes("::")) {
    const [baseId, variant] = id.split("::");
    const base = cards.find((c) => c.id === baseId);
    const priceData = pricingCache.get(id);
    if (!base) return await buildCardFromDb(id);
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
  const found = cards.find((c) => c.id === id);
  if (found) return found;
  // Not in the static index → build from DB so new-set cards render instead of
  // showing the broken "Card not found" shell.
  return await buildCardFromDb(id);
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

