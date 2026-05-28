import type { AdminReview, Token } from "@core/types";
import { appConfig } from "./config";

type VerifiedTokenRow = {
  mint: string;
  symbol: string;
  name: string;
  logo_url: string | null;
  decimals: number;
  status: Token["status"];
  price_usd: number | null;
  change_24h: number | null;
  balance: number | null;
  liquidity_usd: number | null;
  risk_level: Token["riskLevel"];
};

type TokenReviewRow = {
  id: string;
  submitted_by: string;
  submitted_at: string;
  note: string;
  token: VerifiedTokenRow;
};

export type ReviewDecision = "approved" | "rejected" | "paused";

export type SwapEventInput = {
  walletAddress: string;
  signature: string;
  inputMint: string;
  inputSymbol: string;
  inputAmount: number;
  outputMint: string;
  outputSymbol: string;
  outputAmount: number;
  outputUsd: number;
  route: string;
};

export type StoredPriceSnapshot = {
  mint: string;
  symbol: string;
  priceUsd: number;
  recordedAt: string;
};

export type ArcadeSessionInput = {
  walletAddress: string;
  gameKey: string;
  score: number;
  pointsEarned: number;
  maxCombo: number;
  correctCount: number;
  missedCount: number;
  wrongCount: number;
  durationSeconds: number;
  seed: string;
};

export async function fetchStoredVerifiedTokens(): Promise<Token[]> {
  if (!appConfig.supabaseConfigured) return [];

  const rows = await supabaseFetch<VerifiedTokenRow[]>("/rest/v1/verified_tokens?status=eq.verified&order=liquidity_usd.desc");
  return rows.map(rowToToken);
}

export async function fetchPriceSnapshots(mint: string, sinceIso: string): Promise<StoredPriceSnapshot[]> {
  if (!appConfig.supabaseConfigured) return [];

  const params = new URLSearchParams({
    mint: `eq.${mint}`,
    order: "recorded_at.asc",
    recorded_at: `gte.${sinceIso}`,
    select: "mint,symbol,price_usd,recorded_at"
  });

  const rows = await supabaseFetch<Array<{
    mint: string;
    symbol: string;
    price_usd: number | string;
    recorded_at: string;
  }>>(`/rest/v1/price_snapshots?${params.toString()}`);

  return rows.map((row) => ({
    mint: row.mint,
    symbol: row.symbol,
    priceUsd: Number(row.price_usd),
    recordedAt: row.recorded_at
  }));
}

export async function fetchStoredTokenReviews(): Promise<AdminReview[]> {
  if (!appConfig.supabaseConfigured) return [];

  const rows = await supabaseFetch<TokenReviewRow[]>("/rest/v1/token_reviews?status=eq.pending&select=id,submitted_by,submitted_at,note,token:verified_tokens(*)&order=submitted_at.desc");
  return rows.map((row) => ({
    id: row.id,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    note: row.note,
    token: rowToToken(row.token)
  }));
}

export async function persistPriceSnapshots(tokens: Token[]): Promise<void> {
  if (!appConfig.supabaseConfigured || !tokens.length) return;

  const recordedAt = new Date();
  const recordedMinute = new Date(recordedAt);
  recordedMinute.setSeconds(0, 0);

  await supabaseFetch("/rest/v1/price_snapshots?on_conflict=mint,recorded_minute", {
    body: JSON.stringify(tokens.map((token) => ({
      change_24h: token.change24h,
      liquidity_usd: token.liquidityUsd,
      mint: token.mint,
      price_usd: token.priceUsd,
      recorded_at: recordedAt.toISOString(),
      recorded_minute: recordedMinute.toISOString(),
      source: "jupiter",
      symbol: token.symbol
    }))),
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    method: "POST"
  });
}

export async function persistReviewDecision(review: AdminReview, decision: ReviewDecision, reviewedBy: string): Promise<void> {
  if (!appConfig.supabaseConfigured) return;

  const tokenStatus: Token["status"] = decision === "approved" ? "verified" : decision === "paused" ? "paused" : "rejected";

  await supabaseFetch(`/rest/v1/verified_tokens?mint=eq.${encodeURIComponent(review.token.mint)}`, {
    body: JSON.stringify({
      status: tokenStatus,
      updated_at: new Date().toISOString()
    }),
    method: "PATCH"
  });

  await supabaseFetch(`/rest/v1/token_reviews?id=eq.${encodeURIComponent(review.id)}`, {
    body: JSON.stringify({
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
      status: decision
    }),
    method: "PATCH"
  });
}

export async function persistTokenSubmission(review: AdminReview): Promise<void> {
  if (!appConfig.supabaseConfigured) return;

  await supabaseFetch("/rest/v1/verified_tokens?on_conflict=mint", {
    body: JSON.stringify({
      balance: review.token.balance,
      change_24h: review.token.change24h,
      decimals: review.token.decimals,
      liquidity_usd: review.token.liquidityUsd,
      logo_url: review.token.logoUrl,
      mint: review.token.mint,
      name: review.token.name,
      price_usd: review.token.priceUsd,
      risk_level: review.token.riskLevel,
      status: "pending",
      symbol: review.token.symbol,
      updated_at: new Date().toISOString()
    }),
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    method: "POST"
  });

  await supabaseFetch("/rest/v1/token_reviews", {
    body: JSON.stringify({
      mint: review.token.mint,
      note: review.note,
      status: "pending",
      submitted_at: review.submittedAt,
      submitted_by: review.submittedBy
    }),
    method: "POST"
  });
}

export async function persistSwapEvent(event: SwapEventInput): Promise<void> {
  if (!appConfig.supabaseConfigured) return;

  await supabaseFetch("/rest/v1/swap_events", {
    body: JSON.stringify({
      input_amount: event.inputAmount,
      input_mint: event.inputMint,
      input_symbol: event.inputSymbol,
      output_amount: event.outputAmount,
      output_mint: event.outputMint,
      output_symbol: event.outputSymbol,
      output_usd: event.outputUsd,
      route: event.route,
      signature: event.signature,
      wallet_address: event.walletAddress
    }),
    method: "POST"
  });

  await supabaseFetch("/rest/v1/rpc/record_swap_reward", {
    body: JSON.stringify({
      output_usd_input: event.outputUsd,
      wallet_address_input: event.walletAddress
    }),
    method: "POST"
  });
}

export async function persistArcadeSession(session: ArcadeSessionInput): Promise<void> {
  if (!appConfig.supabaseConfigured) return;

  await supabaseFetch("/rest/v1/arcade_sessions", {
    body: JSON.stringify({
      correct_count: session.correctCount,
      duration_seconds: session.durationSeconds,
      game_key: session.gameKey,
      max_combo: session.maxCombo,
      missed_count: session.missedCount,
      points_earned: session.pointsEarned,
      score: session.score,
      seed: session.seed,
      wallet_address: session.walletAddress || null,
      wrong_count: session.wrongCount
    }),
    method: "POST"
  });

  if (session.walletAddress && session.pointsEarned > 0) {
    await supabaseFetch("/rest/v1/rpc/record_arcade_reward", {
      body: JSON.stringify({
        points_input: session.pointsEarned,
        wallet_address_input: session.walletAddress
      }),
      method: "POST"
    });
  }
}

function rowToToken(row: VerifiedTokenRow): Token {
  return {
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    logoUrl: row.logo_url ?? `https://placehold.co/80x80/111820/eef3f8?text=${encodeURIComponent(row.symbol.slice(0, 1))}`,
    decimals: row.decimals,
    status: row.status,
    priceUsd: row.price_usd ?? 0,
    change24h: row.change_24h ?? 0,
    balance: row.balance ?? 0,
    liquidityUsd: row.liquidity_usd ?? 0,
    riskLevel: row.risk_level
  };
}

async function supabaseFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${appConfig.supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: appConfig.supabaseAnonKey,
      Authorization: `Bearer ${appConfig.supabaseAnonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...init.headers
    }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
