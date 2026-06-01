// onchain-price.ts — shared helpers for rendering Solana NFT trade prices.
//
// Magic Eden returns prices in two flavors. The `price` top-level field is
// always a SOL-equivalent number computed at trade time. The truth lives in
// `priceInfo`:
//   - priceInfo.solPrice  — always present, even when the trade was in USDC
//   - priceInfo.splPrice  — present only when the trade was denominated in
//                            an SPL token (USDC, BONK, etc.)
//
// We pick the display currency by inspecting priceInfo.splPrice.address.
// If it matches the USDC mint, render USDC primary + SOL subtitle. If
// splPrice is absent, render SOL primary + USD subtitle (using the spot
// SOL/USD price from the sol-price edge function).

import { useQuery } from "@tanstack/react-query";

// Canonical SPL mint addresses on Solana mainnet.
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface RawAmount {
  rawAmount: string;
  address?: string;
  decimals: number;
}

export interface PriceInfo {
  solPrice?: RawAmount;
  splPrice?: RawAmount;
  // Collector Crypt native trades (ingest-cc-native) use a FLAT shape instead
  // of Magic Eden's nested rawAmount/decimals: a already-human `amount`, the
  // `currency` ("USDC"), and the SPL mint `splAddress`. Must be handled
  // explicitly or it falls through to the SOL path and renders amount*solUsd.
  amount?: number;
  currency?: string;
  splAddress?: string;
}

/** Convert a raw on-chain amount string into a human-readable number. */
export function rawToNumber(r: RawAmount | undefined): number | null {
  if (!r) return null;
  const n = Number(r.rawAmount);
  if (!Number.isFinite(n)) return null;
  return n / Math.pow(10, r.decimals);
}

export interface DisplayPrice {
  primary: string;     // "$30.80 USDC" or "◎ 0.366"
  secondary: string;   // "≈ ◎ 0.366" or "≈ $54.90"
  isUsdc: boolean;     // for downstream styling decisions
}

/**
 * Build the display strings for one trade given its priceInfo and the current
 * SOL/USD spot price. When the trade was in USDC, USDC is primary. Otherwise
 * SOL is primary and we show USD equivalent if we have a spot rate.
 */
export function formatTradePrice(
  fallbackPriceSol: number,
  priceInfo: PriceInfo | undefined,
  solUsdSpot: number | null,
): DisplayPrice {
  const splUsdc =
    priceInfo?.splPrice && priceInfo.splPrice.address === USDC_MINT
      ? rawToNumber(priceInfo.splPrice)
      : null;

  // Collector Crypt native shape: { amount, currency:"USDC", splAddress }.
  // `amount` is already a human USD figure (e.g. 580 = $580), so use it
  // directly. Before this, CC USDC sales fell through to the SOL branch and
  // rendered amount * solUsd (a $580 sale showed as ~$90,000).
  const ccUsdc =
    typeof priceInfo?.amount === "number" &&
    priceInfo.amount > 0 &&
    (priceInfo.currency === "USDC" || priceInfo.splAddress === USDC_MINT)
      ? priceInfo.amount
      : null;

  const usdc = splUsdc ?? ccUsdc;

  // DO NOT use rawToNumber on priceInfo.solPrice. Magic Eden reports it with
  // decimals=9 but the rawAmount is actually at 10^18 scale (attoSOL or
  // similar), so applying the documented decimals yields nine-figure SOL
  // numbers (verified 2026-05-20: a 3.4 SOL bid rendered as "8637200000.000").
  // The top-level `price` field is already in human SOL units and matches
  // every Magic Eden UI display, so use that.
  const sol = fallbackPriceSol > 0 ? fallbackPriceSol : null;

  // USD-only display (per user spec 2026-05-21). Drop the SOL subtitle on
  // every row — site visitors don't care about lamport precision, they want
  // dollar amounts that match what they'd pay. The green tint on isUsdc
  // distinguishes real USDC settlement from a SOL trade we converted, which
  // is the one piece of cross-currency signal worth keeping.
  if (usdc != null) {
    return {
      primary: `$${usdc.toFixed(2)}`,
      secondary: "",
      isUsdc: true,
    };
  }

  // SOL trade — show the USD equivalent. If the SOL/USD spot rate isn't
  // available (both Jupiter and Pyth down), render a dash; never fall back
  // to a SOL number per the no-SOL spec.
  if (sol == null) {
    return { primary: "—", secondary: "", isUsdc: false };
  }
  if (solUsdSpot == null) {
    return { primary: "—", secondary: "", isUsdc: false };
  }
  return {
    primary: `$${(sol * solUsdSpot).toFixed(2)}`,
    secondary: "",
    isUsdc: false,
  };
}

/** React Query hook for the current SOL/USD spot price. Cached 60s. */
export function useSolPrice(): { solUsd: number | null; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["sol-price"],
    queryFn: async () => {
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sol-price`;
      const res = await fetch(baseUrl, {
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });
      if (!res.ok) return null;
      const j = await res.json() as { price?: number };
      return typeof j.price === "number" && j.price > 0 ? j.price : null;
    },
    // Refresh once a minute; SOL price moves but not on the second-by-second
    // scale that NFT browsing cares about.
    staleTime: 60_000,
    refetchInterval: 60_000,
    // Don't block the page on it — UI degrades to SOL-only if this is null.
    refetchOnWindowFocus: false,
  });
  return { solUsd: data ?? null, isLoading };
}
