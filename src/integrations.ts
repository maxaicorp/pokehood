import { appConfig } from "./config";
import type { Token } from "@core/types";

export type SwapQuoteRequest = {
  inputToken: Token;
  outputToken: Token;
  inputAmount: number;
  slippageBps: number;
};

export type JupiterQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  platformFee?: {
    amount: string;
    feeBps: number;
  };
  priceImpactPct: string;
  routePlan?: Array<{
    percent: number;
    swapInfo: {
      label?: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
  }>;
  contextSlot?: number;
  timeTaken?: number;
};

export type JupiterSwapResponse = {
  swapTransaction: string;
  lastValidBlockHeight?: number;
  prioritizationFeeLamports?: number;
};

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function getHeliusStatus() {
  return {
    configured: Boolean(appConfig.heliusApiKey),
    rpcUrl: appConfig.heliusRpcUrl,
    cluster: appConfig.cluster
  };
}

export function buildJupiterQuoteUrl(request: SwapQuoteRequest): string {
  const { inputMint, outputMint, amount } = getQuoteParams(request);
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: request.slippageBps.toString()
  });

  return `${appConfig.jupiterQuoteUrl}?${params.toString()}`;
}

export async function fetchJupiterQuote(request: SwapQuoteRequest): Promise<JupiterQuote> {
  const headers = appConfig.jupiterApiKey ? { "x-api-key": appConfig.jupiterApiKey } : undefined;
  const response = await fetch(buildJupiterQuoteUrl(request), { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Jupiter quote failed with ${response.status}`);
  }

  return (await response.json()) as JupiterQuote;
}

export async function fetchJupiterSwapTransaction(quote: JupiterQuote, userPublicKey: string): Promise<JupiterSwapResponse> {
  if (!appConfig.jupiterApiKey) {
    throw new Error("Jupiter API key is required to build swap transactions");
  }

  const response = await fetch("https://api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": appConfig.jupiterApiKey
    },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: 1_000_000,
          priorityLevel: "high"
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Jupiter swap failed with ${response.status}`);
  }

  return (await response.json()) as JupiterSwapResponse;
}

export function getQuoteOutputAmount(quote: JupiterQuote, outputDecimals: number): number {
  return Number(quote.outAmount) / 10 ** outputDecimals;
}

export function getQuoteInputAmount(quote: JupiterQuote, inputDecimals: number): number {
  return Number(quote.inAmount) / 10 ** inputDecimals;
}

export function getRouteLabels(quote: JupiterQuote): string[] {
  return [...new Set((quote.routePlan ?? []).map((route) => route.swapInfo.label).filter(Boolean) as string[])];
}

function getQuoteParams(request: SwapQuoteRequest) {
  if (request.inputToken.mint === request.outputToken.mint) {
    throw new Error("Choose two different tokens to swap.");
  }

  return {
    inputMint: request.inputToken.mint,
    outputMint: request.outputToken.mint,
    amount: Math.max(1, Math.round(request.inputAmount * 10 ** request.inputToken.decimals)).toString()
  };
}
