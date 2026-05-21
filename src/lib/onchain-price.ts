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

  // DO NOT use rawToNumber on priceInfo.solPrice. Magic Eden reports it with
  // decimals=9 but the rawAmount is actually at 10^18 scale (attoSOL or
  // similar), so applying the documented decimals yields nine-figure SOL
  // numbers (verified 2026-05-20: a 3.4 SOL bid rendered as "8637200000.000").
  // The top-level `price` field is already in human SOL units and matches
  // every Magic Eden UI display, so use that.
  const sol = fallbackPriceSol > 0 ? fallbackPriceSol : null;

  if (splUsdc != null) {
    // USDC trade. Primary is the actual USDC amount; secondary is SOL equivalent.
    return {
      primary: `$${splUsdc.toFixed(2)}`,
      secondary: sol != null ? `≈ ◎ ${sol.toFixed(3)}` : "",
      isUsdc: true,
    };
  }

  // SOL trade. Primary is SOL; secondary is USD equivalent if we have a spot rate.
  if (sol == null) {
    return { primary: "—", secondary: "", isUsdc: false };
  }
  const usd = solUsdSpot != null ? sol * solUsdSpot : null;
  return {
    primary: `◎ ${sol.toFixed(3)}`,
    secondary: usd != null ? `≈ $${usd.toFixed(2)}` : "",
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
