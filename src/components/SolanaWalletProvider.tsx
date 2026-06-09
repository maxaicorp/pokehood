import { ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

// Devnet while we prototype the vault marketplace. Point VITE_SOLANA_RPC at a
// Helius / mainnet URL when we go live. Scoped to the vault routes (lazy) so the
// wallet libs never load on the public site.
const ENDPOINT = (import.meta as { env?: Record<string, string> }).env?.VITE_SOLANA_RPC
  || "https://api.devnet.solana.com";

export default function SolanaWalletProvider({ children }: { children: ReactNode }) {
  // Empty list — the Wallet Standard auto-detects Phantom/Solflare/Backpack/etc.
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
