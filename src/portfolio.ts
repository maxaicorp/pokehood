import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { appConfig } from "./config";
import type { Token } from "@core/types";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export type WalletPortfolio = {
  tokens: Token[];
  fetchedAt: string;
};

export async function fetchWalletPortfolio(walletAddress: string, approvedTokens: Token[]): Promise<WalletPortfolio> {
  const connection = new Connection(appConfig.heliusRpcUrl, "confirmed");
  const owner = new PublicKey(walletAddress);
  const balances = new Map<string, number>();

  const [lamports, tokenAccounts] = await Promise.all([
    connection.getBalance(owner),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })
  ]);

  balances.set(SOL_MINT, lamports / LAMPORTS_PER_SOL);

  for (const account of tokenAccounts.value) {
    const parsedInfo = account.account.data.parsed.info as {
      mint?: string;
      tokenAmount?: {
        uiAmount?: number | null;
        uiAmountString?: string;
      };
    };
    const mint = parsedInfo.mint;
    const rawAmount = parsedInfo.tokenAmount?.uiAmount ?? Number(parsedInfo.tokenAmount?.uiAmountString ?? 0);

    if (mint) {
      balances.set(mint, rawAmount);
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    tokens: approvedTokens.map((token) => ({
      ...token,
      balance: balances.get(token.mint) ?? 0
    }))
  };
}
