import { appConfig } from "./config";
import type { Token } from "@core/types";

type JupiterPriceItem = {
  usdPrice?: number;
  liquidity?: number;
  priceChange24h?: number;
  decimals?: number;
};

type JupiterPriceResponse = Record<string, JupiterPriceItem | undefined>;

export type PriceRefreshResult = {
  tokens: Token[];
  fetchedAt: string;
  source: "jupiter" | "fallback";
  error?: string;
};

export async function refreshTokenPrices(tokens: Token[]): Promise<PriceRefreshResult> {
  if (!appConfig.jupiterApiKey) {
    return {
      tokens,
      fetchedAt: new Date().toISOString(),
      source: "fallback",
      error: "Jupiter API key is not configured"
    };
  }

  const mints = tokens.map((token) => token.mint).join(",");
  const url = `${appConfig.jupiterPriceUrl}?ids=${encodeURIComponent(mints)}`;

  const response = await fetch(url, {
    headers: {
      "x-api-key": appConfig.jupiterApiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Jupiter prices failed with ${response.status}`);
  }

  const prices = (await response.json()) as JupiterPriceResponse;

  return {
    fetchedAt: new Date().toISOString(),
    source: "jupiter",
    tokens: tokens.map((token) => {
      const price = prices[token.mint];

      return {
        ...token,
        priceUsd: price?.usdPrice ?? token.priceUsd,
        change24h: price?.priceChange24h ?? token.change24h,
        liquidityUsd: price?.liquidity ?? token.liquidityUsd,
        decimals: price?.decimals ?? token.decimals
      };
    })
  };
}
