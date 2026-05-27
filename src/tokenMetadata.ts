import { appConfig } from "./config";

export type DetectedTokenMetadata = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
  liquidityUsd: number;
  priceUsd: number;
  change24h: number;
  riskLevel: "low" | "medium" | "high";
  note: string;
  source: "jupiter" | "helius";
};

type JupiterTokenSearchItem = {
  id?: string;
  address?: string;
  mint?: string;
  name?: string;
  symbol?: string;
  icon?: string;
  logoURI?: string;
  decimals?: number;
  isVerified?: boolean;
  organicScore?: number;
  organicScoreLabel?: string;
  usdPrice?: number;
  mcap?: number;
  liquidity?: number;
  liquidityUsd?: number;
  volume24h?: number;
  stats24h?: {
    liquidity?: number;
    priceChange?: number;
    volume?: number;
  };
  tags?: string[];
};

type HeliusAssetResponse = {
  result?: {
    content?: {
      metadata?: {
        name?: string;
        symbol?: string;
      };
      links?: {
        image?: string;
      };
      files?: Array<{
        uri?: string;
        cdn_uri?: string;
      }>;
    };
    token_info?: {
      decimals?: number;
      symbol?: string;
      price_info?: {
        price_per_token?: number;
      };
    };
  };
};

export async function detectTokenMetadata(mint: string): Promise<DetectedTokenMetadata> {
  const jupiterMetadata = await detectWithJupiter(mint).catch(() => undefined);
  if (jupiterMetadata) return jupiterMetadata;

  const heliusMetadata = await detectWithHelius(mint).catch(() => undefined);
  if (heliusMetadata) return heliusMetadata;

  throw new Error("No token metadata found for this mint.");
}

async function detectWithJupiter(mint: string): Promise<DetectedTokenMetadata | undefined> {
  if (!appConfig.jupiterApiKey) return undefined;

  const params = new URLSearchParams({ query: mint });
  const response = await fetch(`${appConfig.jupiterTokenSearchUrl}?${params.toString()}`, {
    headers: {
      "x-api-key": appConfig.jupiterApiKey
    }
  });

  if (!response.ok) return undefined;

  const results = (await response.json()) as JupiterTokenSearchItem[];
  const exactToken = results.find((token) => [token.id, token.address, token.mint].includes(mint)) ?? results[0];
  if (!exactToken?.symbol || !exactToken.name) return undefined;

  const score = exactToken.organicScore ?? 0;
  const riskLevel = exactToken.isVerified || score >= 70
    ? "low"
    : score >= 35
      ? "medium"
      : "high";

  return {
    change24h: exactToken.stats24h?.priceChange ?? 0,
    decimals: exactToken.decimals ?? 6,
    liquidityUsd: exactToken.liquidityUsd ?? exactToken.liquidity ?? exactToken.stats24h?.liquidity ?? 0,
    logoUrl: exactToken.icon ?? exactToken.logoURI ?? "",
    mint: exactToken.id ?? exactToken.address ?? exactToken.mint ?? mint,
    name: exactToken.name,
    note: [
      "Autofilled from Jupiter Tokens API.",
      exactToken.isVerified ? "Jupiter marked this token verified." : "Jupiter did not mark this token verified.",
      exactToken.organicScoreLabel ? `Organic score: ${exactToken.organicScoreLabel}.` : ""
    ].filter(Boolean).join(" "),
    priceUsd: exactToken.usdPrice ?? 0,
    riskLevel,
    source: "jupiter",
    symbol: exactToken.symbol
  };
}

async function detectWithHelius(mint: string): Promise<DetectedTokenMetadata | undefined> {
  if (!appConfig.heliusApiKey) return undefined;

  const response = await fetch(appConfig.heliusRpcUrl, {
    body: JSON.stringify({
      id: "token-metadata",
      jsonrpc: "2.0",
      method: "getAsset",
      params: {
        id: mint,
        options: {
          showFungible: true
        }
      }
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) return undefined;

  const asset = (await response.json()) as HeliusAssetResponse;
  const metadata = asset.result?.content?.metadata;
  const tokenInfo = asset.result?.token_info;
  const symbol = tokenInfo?.symbol ?? metadata?.symbol;
  const name = metadata?.name;
  if (!symbol || !name) return undefined;

  const fileImage = asset.result?.content?.files?.find((file) => file.cdn_uri || file.uri);

  return {
    change24h: 0,
    decimals: tokenInfo?.decimals ?? 6,
    liquidityUsd: 0,
    logoUrl: asset.result?.content?.links?.image ?? fileImage?.cdn_uri ?? fileImage?.uri ?? "",
    mint,
    name,
    note: "Autofilled from Helius DAS metadata. Price/liquidity should be confirmed with Jupiter before approval.",
    priceUsd: tokenInfo?.price_info?.price_per_token ?? 0,
    riskLevel: "medium",
    source: "helius",
    symbol
  };
}
