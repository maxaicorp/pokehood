import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Package, ShieldCheck, Boxes, Flame } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import SolanaWalletProvider from "@/components/SolanaWalletProvider";

function Step({ done, label, sub }: { done: boolean; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-green-500/15 text-green-600" : "bg-muted text-muted-foreground"}`}>
        {done ? "✓" : "•"}
      </span>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function VaultInner() {
  const { publicKey, connected } = useWallet();

  return (
    <div className="container px-4 sm:px-8 py-8">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <Package className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Vault Marketplace</h1>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30 font-semibold">
          Admin · Prototype · devnet
        </span>
      </div>
      <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
        Tokenized sealed product — each vaulted box is a <strong>1:1 redeemable NFT</strong>. Buy/sell the
        token instantly; burn to redeem the physical box. This page is admin-only while we build it.
      </p>

      <div className="grid gap-4 sm:grid-cols-[320px_1fr]">
        {/* Wallet */}
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Wallet</p>
          <WalletMultiButton />
          {connected && publicKey ? (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">Connected (devnet)</p>
              <p className="text-sm font-mono break-all">{publicKey.toBase58()}</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Connect a Solana wallet (Phantom) to continue. Pointed at <strong>devnet</strong> — no real funds.
            </p>
          )}
        </div>

        {/* Build progress */}
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Build progress</p>
          <Step done={connected} label="Phase 1 · Wallet layer" sub="Connect a Solana wallet (this page)" />
          <Step done={false} label="Phase 2 · Mint collection" sub="Candy Machine, supply-locked, 1 box-NFT = 1 box" />
          <Step done={false} label="Phase 3 · Buy" sub="Atomic pay → receive NFT + supply tracker" />
          <Step done={false} label="Phase 4 · Redeem" sub="Burn NFT → admin fulfillment queue → ship" />
          <Step done={false} label="Phase 5 · Secondary + royalties" sub="List on Magic Eden / Tensor" />
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-card p-4">
          <ShieldCheck className="w-4 h-4 text-primary mb-1" />
          <p className="text-sm font-semibold">1:1 backed</p>
          <p className="text-xs text-muted-foreground">Supply locked to vaulted boxes; proof-of-reserves page comes with Phase 6.</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-card p-4">
          <Boxes className="w-4 h-4 text-primary mb-1" />
          <p className="text-sm font-semibold">Instant liquidity</p>
          <p className="text-xs text-muted-foreground">Trade the box NFT in seconds — no shipping until you redeem.</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-card p-4">
          <Flame className="w-4 h-4 text-primary mb-1" />
          <p className="text-sm font-semibold">Burn to redeem</p>
          <p className="text-xs text-muted-foreground">Burn the NFT → we ship the physical box → it leaves the vault.</p>
        </div>
      </div>
    </div>
  );
}

export default function Vault() {
  return (
    <SolanaWalletProvider>
      <AppHeader activePage="vault">
        <VaultInner />
      </AppHeader>
    </SolanaWalletProvider>
  );
}
