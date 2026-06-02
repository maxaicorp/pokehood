// TCGplayer affiliate link helper. Centralized so every "Buy on TCGplayer"
// button earns commission, and so the format can be upgraded in ONE place.
//
// `oN0bnW` is the user's Impact (TCGplayer affiliate) link. Two modes:
//   • As-is → redirects to TCGplayer with the affiliate cookie set (commission
//     tracks), but lands wherever the vanity link points (likely the homepage).
//   • With a destination → we append Impact's `?u=` deep-link param so the click
//     lands on the specific card/search AND still tracks. NOTE: not all vanity
//     short links honor `?u=`. If a test click lands on the homepage instead of
//     the destination, swap TCG_AFFILIATE_BASE below for the full Impact
//     deep-link template (the `…/c/XXXX/YYYY/ZZZZ` form from the Impact
//     dashboard's link generator) — the rest of the app needs no change.

export const TCG_AFFILIATE_BASE = "https://partner.tcgplayer.com/oN0bnW";

/** Build an affiliate-tracked TCGplayer URL. Pass the intended TCGplayer
 *  destination (product/search URL) to attempt a deep link; omit it for the
 *  plain tracked link. */
export function tcgAffiliateLink(destinationUrl?: string): string {
  if (!destinationUrl) return TCG_AFFILIATE_BASE;
  return `${TCG_AFFILIATE_BASE}?u=${encodeURIComponent(destinationUrl)}`;
}
