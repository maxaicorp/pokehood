import { appConfig } from "./config";
import type { Token, TradePreview } from "@core/types";

export type AdminSession = {
  email: string;
  walletAddress: string;
  authenticatedAt: string;
};

export type SecurityCheck = {
  label: string;
  status: "pass" | "warn" | "blocked";
  detail: string;
};

export function canAccessAdmin(email: string, walletAddress: string): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedWallet = walletAddress.trim();

  const emailAllowed = appConfig.adminEmails.length === 0 || appConfig.adminEmails.includes(normalizedEmail);
  const walletAllowed = appConfig.adminWallets.length === 0 || appConfig.adminWallets.includes(normalizedWallet);

  return Boolean(normalizedEmail && normalizedWallet && emailAllowed && walletAllowed);
}

export function createAdminSession(email: string, walletAddress: string): AdminSession {
  return {
    email: email.trim().toLowerCase(),
    walletAddress: walletAddress.trim(),
    authenticatedAt: new Date().toISOString()
  };
}

export function getTradeSecurityChecks(token: Token, preview: TradePreview): SecurityCheck[] {
  return [
    {
      label: "Token verification",
      status: token.status === "verified" ? "pass" : "blocked",
      detail: token.status === "verified" ? "Admin-approved for trading" : "Trading blocked until admin approval"
    },
    {
      label: "Slippage limit",
      status: preview.slippagePct <= 1 ? "pass" : "warn",
      detail: `${preview.slippagePct.toFixed(2)}% max slippage for this preview`
    },
    {
      label: "Price impact",
      status: preview.priceImpactPct <= 1 ? "pass" : "warn",
      detail: `${preview.priceImpactPct.toFixed(2)}% estimated route impact`
    },
    {
      label: "RPC provider",
      status: appConfig.heliusApiKey ? "pass" : "warn",
      detail: appConfig.heliusApiKey ? "Helius RPC configured" : "Using public Solana RPC until Helius key is added"
    },
    {
      label: "Private key custody",
      status: "pass",
      detail: "Non-custodial: signatures stay inside the connected wallet"
    }
  ];
}
