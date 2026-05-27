export type SolanaCluster = "mainnet-beta" | "devnet";

const heliusApiKey = import.meta.env.VITE_HELIUS_API_KEY ?? "";
const jupiterApiKey = import.meta.env.VITE_JUPITER_API_KEY ?? "";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const cluster = (import.meta.env.VITE_SOLANA_CLUSTER ?? "mainnet-beta") as SolanaCluster;

export const appConfig = {
  cluster,
  heliusApiKey,
  jupiterApiKey,
  supabaseUrl,
  supabaseAnonKey,
  supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  heliusRpcUrl: heliusApiKey
    ? `https://${cluster}.helius-rpc.com/?api-key=${heliusApiKey}`
    : "https://api.mainnet-beta.solana.com",
  jupiterPriceUrl: "https://api.jup.ag/price/v3",
  jupiterQuoteUrl: "https://api.jup.ag/swap/v1/quote",
  adminEmails: parseCsv(import.meta.env.VITE_ADMIN_EMAILS),
  adminWallets: parseCsv(import.meta.env.VITE_ADMIN_WALLETS)
};

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
