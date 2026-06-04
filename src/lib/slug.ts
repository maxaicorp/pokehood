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

// Vintage variant cards live in synthetic "virtual sets" whose display name is
// "<Base> (Unlimited|Shadowless|1st Edition)" (see getVirtualSetName). Those are
// NOT real sets, so for URL purposes the slug must collapse to the BASE set's
// slug — otherwise card links point at /sets/base-unlimited/... which
// findSetBySlug can't resolve and the page shows "Card not found". The card's
// own slug already carries the variant (e.g. chansey-unlimited-holo-3), so no
// information is lost. Stripping is safe: no real set name ends this way.
const VIRTUAL_SET_SUFFIX = /\s*\((?:Unlimited|Shadowless|1st Edition)\)\s*$/i;

export function setSlug(set: { name: string }): string {
  return kebab(set.name.replace(VIRTUAL_SET_SUFFIX, ""));
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

/** Build the canonical slug path from just a tcg_api_id + name + set name.
 *  Used by the Most-Visited stat rows on Market, which have these three
 *  pieces but no card.number. Scrydex IDs are `{expansion_id}-{local_id}`
 *  (e.g. "sv8pt5-161", "base1-4") so the local number is everything after
 *  the last "-". Strips our own "::variant" suffix first since Scrydex
 *  doesn't know about it. */
export function cardPathFromApiId(
  tcgApiId: string,
  name: string,
  setName: string,
): string {
  const baseId = tcgApiId.split("::")[0];
  const idx = baseId.lastIndexOf("-");
  const number = idx >= 0 ? baseId.slice(idx + 1) : baseId;
  return cardPath({ name: setName }, { name, number });
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
