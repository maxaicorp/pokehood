// slug.ts — keyword-rich URL slugs for sets and cards, with reverse lookup.
//
// Two URL patterns are introduced as part of the SEO overhaul on 2026-05-20:
//   /sets/{setSlug}                  e.g. /sets/ascended-heroes
//   /sets/{setSlug}/{cardSlug}       e.g. /sets/ascended-heroes/mega-gengar-ex-284
//
// Verified against the live data on 2026-05-20:
//   - 179 physical (non-online-only) sets → 179 unique kebab(name) slugs (no collisions)
//   - 23,450 cards → 0 in-set slug collisions using kebab(name) + "-" + localId
//
// So no year-disambiguator or numeric-ID suffix is needed for either. The old
// /card/:id route stays as a back-compat redirect — see CardDetail.tsx.

import type { PokemonCard, PokemonSet } from "@/lib/pokemon-api";

// ─── kebab() — the only stringly-typed surface ────────────────────────────────
//
// Lowercases, strips accents (so "Pokémon" → "pokemon" not "pok-mon"), replaces
// every non-alphanumeric run with a single "-", trims leading/trailing dashes.
// Stable: feeding kebab back into itself is a no-op.

export function kebab(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Slug builders ────────────────────────────────────────────────────────────

export function setSlug(set: { name: string }): string {
  return kebab(set.name);
}

/** Card slug = kebab(name) + "-" + localId.  e.g. "mega-gengar-ex-284" */
export function cardSlug(card: { name: string; number?: string; localId?: string }): string {
  const id = card.localId ?? card.number ?? "";
  const base = kebab(card.name);
  return id ? `${base}-${kebab(String(id))}` : base;
}

/** Full path for a card. */
export function cardPath(set: { name: string }, card: { name: string; number?: string; localId?: string }): string {
  return `/sets/${setSlug(set)}/${cardSlug(card)}`;
}

/** Full path for a set. */
export function setPath(set: { name: string }): string {
  return `/sets/${setSlug(set)}`;
}

// ─── Reverse lookup — slug → id ───────────────────────────────────────────────
//
// Both maps are built lazily on first use from the sets array passed in by the
// caller (typically loaded from public/data/market-sets.json or
// public/data/all-cards.json). They are memoized via WeakMap keyed by the
// input array so re-renders don't rebuild them, but a brand-new array (e.g.
// after a data refresh) gets a fresh map.

const setSlugMaps = new WeakMap<readonly PokemonSet[], Map<string, PokemonSet>>();

export function findSetBySlug(
  slug: string,
  sets: readonly PokemonSet[],
): PokemonSet | undefined {
  let map = setSlugMaps.get(sets);
  if (!map) {
    map = new Map();
    for (const s of sets) map.set(setSlug(s), s);
    setSlugMaps.set(sets, map);
  }
  return map.get(slug);
}

// Card lookup is keyed by setId so we don't walk all 23k cards every request.
// First call for a given (cards, setId) pair builds the per-set slug map; later
// calls reuse it.
const cardSlugMaps = new WeakMap<readonly PokemonCard[], Map<string, Map<string, PokemonCard>>>();

export function findCardBySlug(
  setId: string,
  cardSlugValue: string,
  cards: readonly PokemonCard[],
): PokemonCard | undefined {
  let bySet = cardSlugMaps.get(cards);
  if (!bySet) {
    bySet = new Map();
    cardSlugMaps.set(cards, bySet);
  }
  let inSet = bySet.get(setId);
  if (!inSet) {
    inSet = new Map();
    for (const c of cards) {
      if (c.set?.id !== setId) continue;
      inSet.set(cardSlug({ name: c.name, number: c.number }), c);
    }
    bySet.set(setId, inSet);
  }
  return inSet.get(cardSlugValue);
}
