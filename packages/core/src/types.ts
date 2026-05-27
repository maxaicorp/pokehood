export type TokenStatus = "pending" | "verified" | "rejected" | "paused";

export type Token = {
  mint: string;
  symbol: string;
  name: string;
  logoUrl: string;
  decimals: number;
  status: TokenStatus;
  priceUsd: number;
  change24h: number;
  balance: number;
  liquidityUsd: number;
  riskLevel: "low" | "medium" | "high";
};

export type PortfolioPoint = {
  timestamp: string;
  valueUsd: number;
};

export type TradeSide = "buy" | "sell";

export type TradePreview = {
  side: TradeSide;
  token: Token;
  inputAmountUsd: number;
  estimatedTokenAmount: number;
  networkFeeUsd: number;
  platformFeeUsd: number;
  priceImpactPct: number;
  slippagePct: number;
};

export type AdminReview = {
  id: string;
  token: Token;
  submittedBy: string;
  submittedAt: string;
  note: string;
};
