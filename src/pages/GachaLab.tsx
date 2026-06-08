import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import {
  BadgeCheck,
  CircleDollarSign,
  Home,
  Layers,
  PackageOpen,
  ShieldCheck,
  Trophy,
  Wallet,
  X,
} from "lucide-react";

type Pack = {
  id: string;
  name: string;
  subtitle: string;
  price: string;
  remaining: number;
  accent: string;
  image: string;
  cards: string[];
};

type Pull = {
  id: string;
  title: string;
  source: string;
  time: string;
  image: string;
  tier: string;
};

const PACKS: Pack[] = [
  {
    id: "genesis",
    name: "Genesis Vault Pack",
    subtitle: "Collector Crypt Pokemon slabs and sealed hits",
    price: "12 USDC",
    remaining: 184,
    accent: "#f4f4f5",
    image: "https://images.scrydex.com/pokemon/me4-116/large",
    cards: [
      "https://images.scrydex.com/pokemon/me4-116/large",
      "https://images.scrydex.com/pokemon/sv8pt5-161/large",
      "https://images.scrydex.com/pokemon/sv10-182/large",
    ],
  },
  {
    id: "chase",
    name: "Chase Slab Pack",
    subtitle: "Higher-value graded cards with tighter odds",
    price: "35 USDC",
    remaining: 42,
    accent: "#f4f4f5",
    image: "https://images.scrydex.com/pokemon/sv8pt5-161/large",
    cards: [
      "https://images.scrydex.com/pokemon/sv8pt5-161/large",
      "https://images.scrydex.com/pokemon/swsh7-215/large",
      "https://images.scrydex.com/pokemon/sv4pt5-234/large",
    ],
  },
  {
    id: "sealed",
    name: "Sealed Booster Pack",
    subtitle: "Sealed Pokemon product with rare slab inserts",
    price: "8 USDC",
    remaining: 310,
    accent: "#f4f4f5",
    image: "https://images.scrydex.com/pokemon/swsh7-215/large",
    cards: [
      "https://images.scrydex.com/pokemon/swsh7-215/large",
      "https://images.scrydex.com/pokemon/sv8-238/large",
      "https://images.scrydex.com/pokemon/me2pt5-284/large",
    ],
  },
];

const RECENT_PULLS: Pull[] = [
  {
    id: "pull-1",
    title: "Mega Greninja ex",
    source: "Genesis Vault Pack",
    time: "9 seconds ago",
    image: "https://images.scrydex.com/pokemon/me4-116/large",
    tier: "Chase",
  },
  {
    id: "pull-2",
    title: "Lillie - Special Illustration",
    source: "Chase Slab Pack",
    time: "14 seconds ago",
    image: "https://images.scrydex.com/pokemon/sv8pt5-161/large",
    tier: "Rare",
  },
  {
    id: "pull-3",
    title: "Evolving Skies Booster",
    source: "Sealed Booster Pack",
    time: "20 seconds ago",
    image: "https://images.scrydex.com/pokemon/swsh7-215/large",
    tier: "Sealed",
  },
  {
    id: "pull-4",
    title: "Charizard ex",
    source: "Genesis Vault Pack",
    time: "26 seconds ago",
    image: "https://images.scrydex.com/pokemon/sv4pt5-234/large",
    tier: "Chase",
  },
  {
    id: "pull-5",
    title: "Gengar VMAX",
    source: "Chase Slab Pack",
    time: "31 seconds ago",
    image: "https://images.scrydex.com/pokemon/swsh8-271/large",
    tier: "Rare",
  },
  {
    id: "pull-6",
    title: "Mewtwo ex",
    source: "Genesis Vault Pack",
    time: "38 seconds ago",
    image: "https://images.scrydex.com/pokemon/sv10-182/large",
    tier: "Rare",
  },
];

const DESKTOP_NAV_ITEMS = [
  { label: "Machine", icon: Home, href: "#machine" },
  { label: "Packs", icon: Layers, href: "#packs" },
  { label: "Pulls", icon: PackageOpen, href: "#pulls" },
  { label: "Winners", icon: Trophy, href: "#pulls" },
];

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function PackRender({ pack }: { pack: Pack }) {
  return (
    <div className="relative h-[220px] w-[220px] sm:h-[300px] sm:w-[300px]">
      <div
        className="absolute left-3 top-10 h-44 w-[120px] rotate-[-7deg] rounded-xl border border-white/25 bg-zinc-50 shadow-[0_24px_54px_rgba(0,0,0,0.5)] sm:left-6 sm:h-60 sm:w-40"
        style={{
          background: `linear-gradient(145deg, ${pack.accent}, #f8fafc 42%, #08090d 44%, ${pack.accent})`,
        }}
      >
        <div className="absolute inset-x-3 top-4 h-8 rounded bg-black text-center text-[10px] font-black uppercase leading-8 text-white">
          Collectiblez
        </div>
        <div className="absolute inset-x-5 top-16 rounded-lg bg-white/95 px-3 py-3 text-center text-4xl font-black italic text-black shadow-inner sm:top-24 sm:text-6xl">
          G
        </div>
        <div className="absolute inset-x-4 bottom-6 rounded-full bg-white px-3 py-2 text-center text-[9px] font-black uppercase text-black">
          Vault Pack
        </div>
      </div>
      <div className="absolute right-2 top-7 h-48 w-[136px] rotate-[7deg] overflow-hidden rounded-lg bg-white p-1.5 shadow-[0_24px_54px_rgba(0,0,0,0.55)] sm:right-4 sm:h-[272px] sm:w-48">
        <div className="h-full rounded-md border border-zinc-300 bg-zinc-100 p-1.5">
          <div className="mb-1.5 grid h-8 grid-cols-[38px_1fr] overflow-hidden rounded border border-zinc-300 bg-white text-[7px] font-black uppercase text-zinc-900">
            <div className="grid place-items-center border-r border-zinc-300">PSA</div>
            <div className="grid place-items-center">Gem Mint 10</div>
          </div>
          <img src={pack.image} alt="" className="h-[calc(100%-48px)] w-full rounded object-cover" loading="eager" />
        </div>
      </div>
      <div className="absolute bottom-3 left-8 right-8 h-10 rounded-full bg-white/25 blur-2xl" />
    </div>
  );
}

function DesktopNav() {
  return (
    <nav className="hidden items-center gap-1 rounded-xl border border-white/8 bg-[#111217] p-1 shadow-lg shadow-black/20 lg:flex">
      {DESKTOP_NAV_ITEMS.map((item, index) => {
        const Icon = item.icon;
        return (
          <a
            key={item.label}
            href={item.href}
            className={cx(
              "flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-black transition",
              index === 0 ? "bg-white text-black" : "text-zinc-400 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

function MobileBottomNav({
  walletConnected,
  onWalletToggle,
  onPull,
}: {
  walletConnected: boolean;
  onWalletToggle: () => void;
  onPull: () => void;
}) {
  return (
    <nav className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-[1fr_1fr_64px_1fr_1fr] items-center gap-1 rounded-2xl border border-white/10 bg-[#111217]/95 p-2 text-white shadow-2xl shadow-black/60 backdrop-blur lg:hidden">
      <a href="#machine" className="grid h-12 place-items-center rounded-xl text-[10px] font-black text-zinc-400">
        <Home className="mb-0.5 h-5 w-5" />
        Home
      </a>
      <a href="#packs" className="grid h-12 place-items-center rounded-xl text-[10px] font-black text-zinc-400">
        <Layers className="mb-0.5 h-5 w-5" />
        Packs
      </a>
      <button
        type="button"
        onClick={walletConnected ? onPull : onWalletToggle}
        className="grid h-14 place-items-center rounded-2xl bg-white text-[10px] font-black text-black shadow-lg shadow-white/10"
      >
        <PackageOpen className="mb-0.5 h-5 w-5" />
        {walletConnected ? "Rip" : "Link"}
      </button>
      <a href="#pulls" className="grid h-12 place-items-center rounded-xl text-[10px] font-black text-zinc-400">
        <Trophy className="mb-0.5 h-5 w-5" />
        Pulls
      </a>
      <button
        type="button"
        onClick={onWalletToggle}
        className="grid h-12 place-items-center rounded-xl text-[10px] font-black text-zinc-400"
      >
        <Wallet className={cx("mb-0.5 h-5 w-5", walletConnected && "text-white")} />
        {walletConnected ? "Linked" : "Wallet"}
      </button>
    </nav>
  );
}

function PullCard({ pull }: { pull: Pull }) {
  return (
    <article className="min-w-[208px] max-w-[208px] rounded-xl bg-[#1a1b20] p-2 shadow-lg shadow-black/20 sm:min-w-[236px] sm:max-w-[236px]">
      <div className="relative mb-3 flex h-44 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-zinc-700 to-zinc-950 sm:h-48">
        <img src={pull.image} alt="" className="h-full max-w-full object-contain p-1.5" loading="lazy" />
        <div className="absolute left-2.5 top-2.5 rounded-full bg-black/65 px-2 py-1 text-[9px] font-black uppercase text-white backdrop-blur">
          {pull.tier}
        </div>
      </div>
      <h3 className="line-clamp-2 min-h-[38px] text-base font-black leading-tight text-white">{pull.title}</h3>
      <div className="mt-3 border-t border-white/10 pt-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/8 ring-1 ring-white/10">
            <PackageOpen className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-zinc-300">{pull.source}</p>
            <p className="text-xs font-semibold text-zinc-500">{pull.time}</p>
          </div>
        </div>
      </div>
    </article>
  );
}

function PackTile({ pack, selected, onSelect }: { pack: Pack; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cx(
        "group min-w-[220px] rounded-xl border bg-[#17181e] p-3 text-left transition sm:min-w-[240px]",
        selected ? "border-white/70 shadow-[0_0_0_1px_rgba(255,255,255,0.45)]" : "border-white/8 hover:border-white/20",
      )}
    >
      <div className="mb-3 flex h-32 items-center justify-center overflow-hidden rounded-lg bg-[#24262c]">
        <img src={pack.image} alt="" className="h-full max-w-full object-contain p-2 transition group-hover:scale-105" loading="lazy" />
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-black text-white">{pack.name}</h3>
          <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-zinc-500">{pack.subtitle}</p>
        </div>
        {selected && <BadgeCheck className="h-5 w-5 shrink-0 text-white" />}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="font-black text-white">{pack.price}</span>
        <span className="font-bold text-zinc-500">{pack.remaining} left</span>
      </div>
    </button>
  );
}

function RevealOverlay({
  pull,
  pack,
  onClose,
}: {
  pull: Pull | null;
  pack: Pack;
  onClose: () => void;
}) {
  if (!pull) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 px-4 backdrop-blur-xl">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#121319] shadow-2xl shadow-black">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/15"
          aria-label="Close reveal"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="grid gap-0 md:grid-cols-[1fr_1.1fr]">
          <div className="grid min-h-[360px] place-items-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.18),transparent_62%)] p-6">
            <div className="rounded-xl bg-white p-2 shadow-[0_32px_90px_rgba(255,255,255,0.14)]">
              <img src={pull.image} alt="" className="h-72 w-48 rounded-lg object-contain" />
            </div>
          </div>
          <div className="flex flex-col justify-center p-7">
            <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-zinc-300">Pull settled</p>
            <h2 className="text-3xl font-black leading-tight text-white">{pull.title}</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-zinc-400">Reserved from {pack.name}.</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs font-bold uppercase text-zinc-500">Tier</p>
                <p className="mt-1 text-lg font-black text-white">{pull.tier}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs font-bold uppercase text-zinc-500">Price</p>
                <p className="mt-1 text-lg font-black text-white">{pack.price}</p>
              </div>
            </div>
            <Button onClick={onClose} className="mt-6 h-11 rounded-lg bg-white text-sm font-black text-black hover:bg-zinc-200">
              Back to machine
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GachaLab() {
  const [walletConnected, setWalletConnected] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState(PACKS[0].id);
  const [revealedPull, setRevealedPull] = useState<Pull | null>(null);
  const selectedPack = useMemo(
    () => PACKS.find((pack) => pack.id === selectedPackId) ?? PACKS[0],
    [selectedPackId],
  );

  const handlePull = () => {
    const pull = RECENT_PULLS.find((item) => item.source === selectedPack.name) ?? RECENT_PULLS[0];
    setRevealedPull(pull);
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#090a0d] font-sans text-white">
      <SEO
        title="Gacha Lab - Collectiblez"
        description="Private Solana gacha machine prototype for Collectiblez."
        path="/lab/gacha"
        noindex
      />

      <header className="fixed left-0 right-0 top-0 z-40 grid h-[72px] grid-cols-[1fr_auto_1fr] items-center bg-black px-4 text-white sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-3 justify-self-start">
          <img src="/logo.png" alt="" className="h-8 w-8 object-contain" />
          <span className="text-lg font-black tracking-tight">Collectiblez</span>
        </Link>
        <DesktopNav />
        <div className="flex items-center gap-3 justify-self-end">
          <button
            type="button"
            onClick={() => setWalletConnected((v) => !v)}
            className={cx(
              "hidden h-10 items-center gap-2 rounded-lg px-4 text-sm font-black transition sm:flex",
              walletConnected ? "bg-white text-black hover:bg-zinc-200" : "bg-white text-black hover:bg-zinc-200",
            )}
          >
            <Wallet className="h-4 w-4" />
            {walletConnected ? "Wallet linked" : "Connect wallet"}
          </button>
        </div>
      </header>

      <main className="w-full max-w-full overflow-x-hidden pb-24 pt-[82px] lg:pb-0">
        <section id="machine" className="scroll-mt-24 px-4 sm:px-6 lg:px-8">
          <div className="relative w-full max-w-full overflow-hidden rounded-2xl bg-[#15161b]">
            <div className="absolute inset-0">
              <img
                src="https://images.unsplash.com/photo-1607462109225-6b64ae2dd3cb?auto=format&fit=crop&w=2200&q=80"
                alt=""
                className="h-full w-full object-cover opacity-55"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-black/15" />
              <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/75 to-transparent" />
            </div>
            <div className="relative grid min-h-[430px] w-full min-w-0 items-center gap-5 px-5 py-8 md:grid-cols-[0.95fr_1.05fr] md:px-12">
              <div className="min-w-0 max-w-2xl">
                <h1 className="max-w-full break-words text-[40px] font-black leading-[0.95] tracking-tight text-white sm:text-6xl">
                  Solana Vault Pack
                </h1>
                <p className="mt-4 max-w-full text-base font-bold leading-7 text-white/85 sm:max-w-xl sm:text-lg">
                  Pull from a private onchain machine loaded with slabs, sealed packs, and redeemable vault prizes.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button
                    onClick={walletConnected ? handlePull : () => setWalletConnected(true)}
                    className="h-12 rounded-full bg-white px-6 text-sm font-black text-black hover:bg-zinc-200"
                  >
                    {walletConnected ? "Rip now" : "Connect wallet"}
                  </Button>
                  <div className="flex h-12 items-center gap-2 rounded-full bg-black/50 px-4 text-sm font-black text-white ring-1 ring-white/10 backdrop-blur">
                    <CircleDollarSign className="h-4 w-4 text-white" />
                    {selectedPack.price}
                  </div>
                </div>
              </div>
              <div className="flex justify-center md:justify-end">
                <PackRender pack={selectedPack} />
              </div>
            </div>
          </div>
        </section>

        <section id="pulls" className="scroll-mt-24 px-4 py-7 sm:px-6 lg:px-8">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-white">Just Pulled</h2>
            </div>
            <button type="button" className="shrink-0 text-sm font-black text-white hover:text-zinc-300">
              Grab a pack
            </button>
          </div>
          <div className="-mx-4 overflow-x-auto px-4 pb-5 [scrollbar-color:#777_#111217] sm:mx-0 sm:px-0">
            <div className="flex gap-4">
              {RECENT_PULLS.map((pull) => (
                <PullCard key={pull.id} pull={pull} />
              ))}
            </div>
          </div>
        </section>

        <section id="packs" className="scroll-mt-24 px-4 pb-12 sm:px-6 lg:px-8">
          <div className="mb-5 flex items-end justify-between gap-4">
            <h2 className="text-2xl font-black tracking-tight text-white">Packs</h2>
            <div className="hidden items-center gap-2 rounded-full bg-[#15161b] px-3 py-2 text-[11px] font-black uppercase tracking-wide text-zinc-400 ring-1 ring-white/5 sm:flex">
              <ShieldCheck className="h-4 w-4 text-white" />
              Devnet machine
            </div>
          </div>
          <div className="-mx-4 overflow-x-auto px-4 pb-5 [scrollbar-color:#777_#111217] sm:mx-0 sm:px-0">
            <div className="flex gap-4">
              {PACKS.map((pack) => (
                <PackTile
                  key={pack.id}
                  pack={pack}
                  selected={pack.id === selectedPack.id}
                  onSelect={() => setSelectedPackId(pack.id)}
                />
              ))}
            </div>
          </div>
        </section>

      </main>

      <MobileBottomNav
        walletConnected={walletConnected}
        onWalletToggle={() => setWalletConnected((v) => !v)}
        onPull={handlePull}
      />
      <RevealOverlay pull={revealedPull} pack={selectedPack} onClose={() => setRevealedPull(null)} />
    </div>
  );
}
