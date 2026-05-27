/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HELIUS_API_KEY?: string;
  readonly VITE_JUPITER_API_KEY?: string;
  readonly VITE_SOLANA_CLUSTER?: "mainnet-beta" | "devnet";
  readonly VITE_ADMIN_EMAILS?: string;
  readonly VITE_ADMIN_WALLETS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
