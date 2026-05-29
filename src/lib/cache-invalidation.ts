// Central invalidation for the in-memory price/catalog caches.
//
// Background: pricingCache (pokemon-api), allLatestRowsPromise (price-snapshots),
// and sealedCache / sealedPriceMap (sealed-store) are module-level singletons.
// Before this, they were seeded once per tab and NEVER refreshed — so after the
// DB updated, an open tab kept showing stale prices until a hard reload. This
// caused "the site shows old data" reports that looked like backend bugs.
//
// This is NOT a persistence cache (no localStorage/SWR) — that's explicitly
// banned by the market rendering contract. These are purely in-memory caches;
// here we only BOUND their lifetime (a TTL) and clear them on an explicit
// refresh signal. Stale-but-bounded, never stale-forever.

/** Max age of any in-memory price/catalog cache before a read refetches. */
export const PRICE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Each cache module registers a reset callback so a single signal clears all.
const resetters = new Set<() => void>();

export function registerCacheResetter(fn: () => void): void {
  resetters.add(fn);
}

/** Clear every registered in-memory cache so the next read refetches from DB. */
export function invalidateAllPriceCaches(): void {
  for (const fn of resetters) {
    try { fn(); } catch { /* a broken resetter must not block the others */ }
  }
}

// Cross-tab: the admin "Master refresh" button writes collectiblez:force-refresh
// to localStorage; the `storage` event fires in OTHER tabs. Installed once from
// main.tsx, before any page mounts, so it runs before page-level bump handlers.
let installed = false;
export function installCacheInvalidation(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("storage", (e) => {
    if (e.key === "collectiblez:force-refresh") invalidateAllPriceCaches();
  });
}
