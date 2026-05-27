import type { AdminReview, PortfolioPoint, Token, TradePreview, TradeSide } from "./types";

export const approvedTokens: Token[] = [
  {
    mint: "So11111111111111111111111111111111111111112",
    symbol: "SOL",
    name: "Solana",
    logoUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
    decimals: 9,
    status: "verified",
    priceUsd: 183.42,
    change24h: 2.84,
    balance: 8.6214,
    liquidityUsd: 892_000_000,
    riskLevel: "low"
  },
  {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    name: "USD Coin",
    logoUrl: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
    decimals: 6,
    status: "verified",
    priceUsd: 1,
    change24h: 0.01,
    balance: 428.75,
    liquidityUsd: 1_200_000_000,
    riskLevel: "low"
  },
  {
    mint: "DezXAZ8z7PnrnRJjz3VHDMWgP1sowwRHfbT53FQetkUM",
    symbol: "BONK",
    name: "Bonk",
    logoUrl: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/DezXAZ8z7PnrnRJjz3VHDMWgP1sowwRHfbT53FQetkUM/logo.png",
    decimals: 5,
    status: "verified",
    priceUsd: 0.000028,
    change24h: -3.12,
    balance: 4_250_000,
    liquidityUsd: 64_000_000,
    riskLevel: "medium"
  },
  {
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    symbol: "JUP",
    name: "Jupiter",
    logoUrl: "https://static.jup.ag/jup/icon.png",
    decimals: 6,
    status: "verified",
    priceUsd: 1.38,
    change24h: 5.41,
    balance: 126.2,
    liquidityUsd: 118_000_000,
    riskLevel: "medium"
  }
];

export const tokenReviews: AdminReview[] = [
  {
    id: "review-1",
    token: {
      mint: "METAewjDfs4S6zV6r1pQ3G8tQ3demoMint11111111111",
      symbol: "META",
      name: "Metaplex",
      logoUrl: "https://placehold.co/80x80/f2f4f7/111?text=M",
      decimals: 6,
      status: "pending",
      priceUsd: 0.61,
      change24h: -1.8,
      balance: 0,
      liquidityUsd: 9_800_000,
      riskLevel: "medium"
    },
    submittedBy: "ops@soltrade.local",
    submittedAt: "2026-05-26T09:15:00-07:00",
    note: "Known Solana ecosystem token. Verify liquidity routing and token metadata before enabling trades."
  },
  {
    id: "review-2",
    token: {
      mint: "RISK9wfeP4YbL73BadLiquidityDemo111111111111",
      symbol: "RISK",
      name: "Risk Token",
      logoUrl: "https://placehold.co/80x80/f2f4f7/111?text=R",
      decimals: 9,
      status: "pending",
      priceUsd: 0.0041,
      change24h: 18.3,
      balance: 0,
      liquidityUsd: 82_000,
      riskLevel: "high"
    },
    submittedBy: "reviewer@soltrade.local",
    submittedAt: "2026-05-26T10:40:00-07:00",
    note: "Low liquidity and volatile movement. Should remain pending until manual due diligence is complete."
  }
];

export const portfolioSeries: PortfolioPoint[] = [
  { timestamp: "09:00", valueUsd: 2108 },
  { timestamp: "10:00", valueUsd: 2164 },
  { timestamp: "11:00", valueUsd: 2139 },
  { timestamp: "12:00", valueUsd: 2218 },
  { timestamp: "13:00", valueUsd: 2206 },
  { timestamp: "14:00", valueUsd: 2297 },
  { timestamp: "15:00", valueUsd: 2358 },
  { timestamp: "16:00", valueUsd: 2312 },
  { timestamp: "17:00", valueUsd: 2386 }
];

export function getVerifiedTokens(tokens: Token[]): Token[] {
  return tokens.filter((token) => token.status === "verified");
}

export function getPortfolioValue(tokens: Token[]): number {
  return tokens.reduce((total, token) => total + token.balance * token.priceUsd, 0);
}

export function createTradePreview(side: TradeSide, token: Token, inputAmountUsd: number): TradePreview {
  const estimatedTokenAmount = inputAmountUsd / token.priceUsd;
  const priceImpactPct = inputAmountUsd > 1000 ? 0.34 : 0.08;

  return {
    side,
    token,
    inputAmountUsd,
    estimatedTokenAmount,
    networkFeeUsd: 0.002,
    platformFeeUsd: inputAmountUsd * 0.001,
    priceImpactPct,
    slippagePct: 0.5
  };
}
