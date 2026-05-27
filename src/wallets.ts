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
  iconUrl: string;
};

type BrowserWalletProvider = {
  connect?: () => Promise<{ publicKey?: unknown } | void>;
  disconnect?: () => Promise<void>;
  publicKey?: unknown;
  isConnected?: boolean;
  icon?: string;
  signAndSendTransaction?: (transaction: VersionedTransaction) => Promise<{ signature?: string } | string>;
  signTransaction?: (transaction: VersionedTransaction) => Promise<VersionedTransaction>;
};

const supportedWallets: Array<{ id: SupportedWalletId; name: string; aliases: string[]; fallbackIconUrl: string }> = [
  { id: "phantom", name: "Phantom", aliases: ["phantom"], fallbackIconUrl: svgIcon("phantom") },
  { id: "solflare", name: "Solflare", aliases: ["solflare"], fallbackIconUrl: svgIcon("solflare") },
  { id: "backpack", name: "Backpack", aliases: ["backpack"], fallbackIconUrl: svgIcon("backpack") },
  { id: "jupiter", name: "Jupiter Wallet", aliases: ["jupiter"], fallbackIconUrl: svgIcon("jupiter") }
];

export function getWalletOptions(): WalletOption[] {
  return supportedWallets.map((wallet) => {
    const injectedProvider = findInjectedProvider(wallet.id);
    const standardWallet = findStandardWallet(wallet.aliases);

    return {
      iconUrl: getWalletIcon(wallet.id, injectedProvider, standardWallet) ?? wallet.fallbackIconUrl,
      id: wallet.id,
      installed: Boolean(injectedProvider || standardWallet),
      name: standardWallet?.name ?? wallet.name
    };
  });
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

function getWalletIcon(
  id: SupportedWalletId,
  injectedProvider: BrowserWalletProvider | undefined,
  standardWallet: ReturnType<typeof findStandardWallet>
): string | undefined {
  const standardIcon = standardWallet && "icon" in standardWallet && typeof standardWallet.icon === "string"
    ? standardWallet.icon
    : undefined;

  return standardIcon ?? injectedProvider?.icon ?? supportedWallets.find((wallet) => wallet.id === id)?.fallbackIconUrl;
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

function svgIcon(id: SupportedWalletId): string {
  const icons: Record<SupportedWalletId, string> = {
    backpack: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#e84242"/><path fill="#fff" d="M20 27c0-7 5-12 12-12s12 5 12 12v21H20V27Zm8 0h8c0-3-1.6-5-4-5s-4 2-4 5Zm-1 11h10v-5H27v5Z"/></svg>`,
    jupiter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#08110f"/><path fill="none" stroke="#7cffb2" stroke-linecap="round" stroke-width="4" d="M14 22c12-8 25-8 36 0M12 30c13-8 27-8 40 0M14 38c12-8 25-8 36 0M19 46c9-5 17-5 26 0"/></svg>`,
    phantom: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#ab9ff2"/><path fill="#fff" d="M14 34c0-12 8-20 19-20s17 8 17 20v10c0 3-2 5-5 5-2 0-4-1-5-3-2 2-4 3-7 3H22c-5 0-8-6-5-10l2-3c-3-1-5-1-5-2Zm24-3c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3Zm-13 0c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3Z"/></svg>`,
    solflare: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#fc6b22"/><path fill="#ffd34d" d="m32 10 4.2 14.4L50 19l-8.2 12.4L56 36l-14.2 4.6L50 53l-13.8-5.4L32 62l-4.2-14.4L14 53l8.2-12.4L8 36l14.2-4.6L14 19l13.8 5.4L32 10Z"/><circle cx="32" cy="36" r="9" fill="#fff7d1"/></svg>`
  };

  return `data:image/svg+xml,${encodeURIComponent(icons[id])}`;
}
