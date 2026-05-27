import { VersionedTransaction } from "@solana/web3.js";
import { getWallets } from "@wallet-standard/app";

export type SupportedWalletId = "phantom" | "solflare" | "backpack" | "jupiter";

export type WalletConnection = {
  id: SupportedWalletId;
  name: string;
  address: string;
  source: "injected" | "wallet-standard";
};

export type WalletOption = {
  id: SupportedWalletId;
  name: string;
  installed: boolean;
};

type BrowserWalletProvider = {
  connect?: () => Promise<{ publicKey?: unknown } | void>;
  disconnect?: () => Promise<void>;
  publicKey?: unknown;
  isConnected?: boolean;
  signAndSendTransaction?: (transaction: VersionedTransaction) => Promise<{ signature?: string } | string>;
  signTransaction?: (transaction: VersionedTransaction) => Promise<VersionedTransaction>;
};

const supportedWallets: Array<{ id: SupportedWalletId; name: string; aliases: string[] }> = [
  { id: "phantom", name: "Phantom", aliases: ["phantom"] },
  { id: "solflare", name: "Solflare", aliases: ["solflare"] },
  { id: "backpack", name: "Backpack", aliases: ["backpack"] },
  { id: "jupiter", name: "Jupiter Wallet", aliases: ["jupiter"] }
];

export function getWalletOptions(): WalletOption[] {
  return supportedWallets.map((wallet) => ({
    id: wallet.id,
    name: wallet.name,
    installed: Boolean(findInjectedProvider(wallet.id) || findStandardWallet(wallet.aliases))
  }));
}

export async function connectWallet(id: SupportedWalletId): Promise<WalletConnection> {
  const wallet = supportedWallets.find((item) => item.id === id);
  if (!wallet) {
    throw new Error("Unsupported wallet");
  }

  const injectedProvider = findInjectedProvider(id);
  if (injectedProvider?.connect) {
    const result = await injectedProvider.connect();
    const publicKey = getAddress(result?.publicKey ?? injectedProvider.publicKey);
    if (!publicKey) {
      throw new Error(`${wallet.name} did not return a public key`);
    }

    return { id, name: wallet.name, address: publicKey, source: "injected" };
  }

  const standardWallet = findStandardWallet(wallet.aliases);
  const connectFeature = standardWallet?.features["standard:connect"] as
    | { connect?: () => Promise<{ accounts?: readonly { address: string }[] }> }
    | undefined;

  if (standardWallet && connectFeature?.connect) {
    const result = await connectFeature.connect();
    const address = result.accounts?.[0]?.address;
    if (!address) {
      throw new Error(`${wallet.name} connected without an account`);
    }

    return { id, name: standardWallet.name, address, source: "wallet-standard" };
  }

  throw new Error(`${wallet.name} is not installed in this browser`);
}

export function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export async function signAndSendSwapTransaction(wallet: WalletConnection, swapTransactionBase64: string): Promise<string> {
  if (wallet.source !== "injected") {
    throw new Error("Wallet-standard signing will be added after injected wallet signing is verified");
  }

  const provider = findInjectedProvider(wallet.id);
  if (!provider) {
    throw new Error(`${wallet.name} is not available for signing`);
  }

  const transaction = VersionedTransaction.deserialize(base64ToBytes(swapTransactionBase64));

  if (provider.signAndSendTransaction) {
    const result = await provider.signAndSendTransaction(transaction);
    if (typeof result === "string") return result;
    if (result.signature) return result.signature;
  }

  if (provider.signTransaction) {
    throw new Error(`${wallet.name} can sign the swap, but sending through RPC is not wired yet`);
  }

  throw new Error(`${wallet.name} does not expose transaction signing`);
}

function findStandardWallet(aliases: string[]) {
  return getWallets()
    .get()
    .find((wallet) => aliases.some((alias) => wallet.name.toLowerCase().includes(alias)));
}

function findInjectedProvider(id: SupportedWalletId): BrowserWalletProvider | undefined {
  const browserWindow = window as unknown as {
    solana?: BrowserWalletProvider & { isPhantom?: boolean };
    phantom?: { solana?: BrowserWalletProvider };
    solflare?: BrowserWalletProvider;
    backpack?: BrowserWalletProvider | { solana?: BrowserWalletProvider };
    jupiter?: BrowserWalletProvider | { solana?: BrowserWalletProvider };
  };

  if (id === "phantom") return browserWindow.phantom?.solana ?? (browserWindow.solana?.isPhantom ? browserWindow.solana : undefined);
  if (id === "solflare") return browserWindow.solflare;
  if (id === "backpack") return unwrapSolanaProvider(browserWindow.backpack);
  if (id === "jupiter") return unwrapSolanaProvider(browserWindow.jupiter);
}

function getAddress(publicKey: unknown): string {
  if (!publicKey) return "";
  if (typeof publicKey === "string") return publicKey;
  if (typeof publicKey === "object" && "toString" in publicKey && typeof publicKey.toString === "function") {
    return publicKey.toString();
  }
  return "";
}

function unwrapSolanaProvider(
  provider: BrowserWalletProvider | { solana?: BrowserWalletProvider } | undefined
): BrowserWalletProvider | undefined {
  if (!provider) return undefined;
  const nested = provider as { solana?: BrowserWalletProvider };
  if (nested.solana) return nested.solana;
  return provider as BrowserWalletProvider;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
