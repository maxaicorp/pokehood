import { CSSProperties, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Bell,
  ChevronRight,
  Crown,
  Eye,
  Heart,
  LineChart,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  TrendingUp,
  WalletCards,
} from "lucide-react";

type BrandConcept = {
  id: string;
  name: string;
  thesis: string;
  logoText: string;
  logoSub: string;
  headline: string;
  subhead: string;
  primaryCta: string;
  secondaryCta: string;
  colors: {
    bg: string;
    surface: string;
    surface2: string;
    text: string;
    muted: string;
    border: string;
    primary: string;
    primaryText: string;
    accent: string;
    accent2: string;
    good: string;
    bad: string;
  };
};

const concepts: BrandConcept[] = [
  {
    id: "signal",
    name: "Vault Signal",
    thesis: "A sharp market tool for collectors who want signal before noise.",
    logoText: "CZ",
    logoSub: "Vault",
    headline: "Track the move. Build the vault.",
    subhead: "Live card prices, sealed product signals, and one-tap actions for inventory, watchlists, alerts, and buys.",
    primaryCta: "Scan Market",
    secondaryCta: "Open Vault",
    colors: {
      bg: "#08111F",
      surface: "#101B2E",
      surface2: "#16243A",
      text: "#F5FAFF",
      muted: "#93A7BD",
      border: "#26364E",
      primary: "#28D6B2",
      primaryText: "#041311",
      accent: "#4F8CFF",
      accent2: "#F6B73C",
      good: "#38D99A",
      bad: "#FF677A",
    },
  },
  {
    id: "holo",
    name: "Holo Night",
    thesis: "A collectible, premium, high-energy look with stronger chase-card emotion.",
    logoText: "CZ",
    logoSub: "Holo",
    headline: "Find the chase before it runs.",
    subhead: "Daily movers, grail alerts, and buying paths wrapped around the cards collectors already obsess over.",
    primaryCta: "Find Chases",
    secondaryCta: "Track Alerts",
    colors: {
      bg: "#120A1D",
      surface: "#20142F",
      surface2: "#2C1B43",
      text: "#FFF8FF",
      muted: "#C7B3D7",
      border: "#47305F",
      primary: "#FF4FCB",
      primaryText: "#220018",
      accent: "#49DDF0",
      accent2: "#B7F65D",
      good: "#5CF2B1",
      bad: "#FF6B6B",
    },
  },
  {
    id: "ledger",
    name: "Collector Ledger",
    thesis: "A calmer, trustworthy dashboard for portfolio value and set completion.",
    logoText: "CZ",
    logoSub: "Ledger",
    headline: "Know what your collection is doing.",
    subhead: "A cleaner home for inventory, price history, set goals, deal scoring, and portfolio reports.",
    primaryCta: "View Portfolio",
    secondaryCta: "Browse Deals",
    colors: {
      bg: "#F7F9FB",
      surface: "#FFFFFF",
      surface2: "#EDF3F8",
      text: "#17202C",
      muted: "#68778A",
      border: "#D7E0EA",
      primary: "#0E7C66",
      primaryText: "#FFFFFF",
      accent: "#E84F62",
      accent2: "#2F6FDB",
      good: "#0B9B6B",
      bad: "#D64255",
    },
  },
  {
    id: "arena",
    name: "Market Arena",
    thesis: "A faster, sportier brand for trading-floor behavior and competitive collecting.",
    logoText: "CZ",
    logoSub: "Arena",
    headline: "Turn collecting into an edge.",
    subhead: "Price velocity, deal radar, watchlist drops, and buy actions in one focused market screen.",
    primaryCta: "Open Radar",
    secondaryCta: "See Movers",
    colors: {
      bg: "#0B0D10",
      surface: "#15181E",
      surface2: "#20242D",
      text: "#F7F8FA",
      muted: "#A6ADB8",
      border: "#303743",
      primary: "#E7FF45",
      primaryText: "#111400",
      accent: "#FF4E38",
      accent2: "#55A7FF",
      good: "#65F08D",
      bad: "#FF614E",
    },
  },
];

const sampleCards = [
  {
    id: "sv8pt5-161",
    name: "Umbreon ex",
    set: "Prismatic Evolutions",
    price: "$1,528",
    day: "+6.8%",
    week: "+18.4%",
    views: "12.4k",
    image: "https://images.scrydex.com/pokemon/sv8pt5-161/small",
  },
  {
    id: "me2pt5-284",
    name: "Mega Gengar ex",
    set: "Ascended Heroes",
    price: "$468",
    day: "+2.1%",
    week: "+9.7%",
    views: "8.1k",
    image: "https://images.scrydex.com/pokemon/me2pt5-284/small",
  },
  {
    id: "me2-125",
    name: "Mega Charizard X ex",
    set: "Phantasmal Flames",
    price: "$391",
    day: "-1.4%",
    week: "+5.2%",
    views: "7.3k",
    image: "https://images.scrydex.com/pokemon/me2-125/small",
  },
  {
    id: "sv3pt5-199",
    name: "Charizard ex",
    set: "151",
    price: "$183",
    day: "+3.5%",
    week: "-2.0%",
    views: "5.9k",
    image: "https://images.scrydex.com/pokemon/sv3pt5-199/small",
  },
];

const actionItems = [
  { icon: WalletCards, title: "Add to Inventory", text: "Track owned copies and value." },
  { icon: Heart, title: "Wishlist", text: "Watch grails and missing cards." },
  { icon: Bell, title: "Price Alert", text: "Notify under target or on spikes." },
  { icon: ShoppingBag, title: "Find Best Buy", text: "Route to partner shops." },
];

function pctColor(value: string, concept: BrandConcept) {
  return value.startsWith("-") ? concept.colors.bad : concept.colors.good;
}

function BrandLogo({ concept }: { concept: BrandConcept }) {
  const c = concept.colors;
  return (
    <div className="flex items-center gap-3">
      <div
        className="relative grid h-11 w-11 place-items-center overflow-hidden rounded-[10px] border"
        style={{
          background: c.surface2,
          borderColor: c.border,
          boxShadow: `0 0 0 1px ${c.primary}22, 0 12px 32px ${c.primary}22`,
        }}
      >
        <div
          className="absolute inset-x-2 top-2 h-1 rounded-full"
          style={{ background: c.primary }}
        />
        <span className="relative text-sm font-black tracking-[0.16em]" style={{ color: c.text }}>
          {concept.logoText}
        </span>
        <div
          className="absolute bottom-1.5 h-1.5 w-5 rounded-full"
          style={{ background: c.accent }}
        />
      </div>
      <div className="leading-none">
        <p className="text-lg font-black uppercase tracking-[0.14em]" style={{ color: c.text }}>
          Collectiblez
        </p>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: c.primary }}>
          {concept.logoSub}
        </p>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  concept,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  concept: BrandConcept;
}) {
  const c = concept.colors;
  return (
    <div
      className="rounded-lg border p-3"
      style={{ background: c.surface, borderColor: c.border }}
    >
      <div className="flex items-center gap-2" style={{ color: c.muted }}>
        <Icon className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-xl font-black tabular-nums" style={{ color: c.text }}>
        {value}
      </p>
    </div>
  );
}

export default function BrandLab() {
  const [activeId, setActiveId] = useState(concepts[0].id);
  const concept = useMemo(
    () => concepts.find((item) => item.id === activeId) ?? concepts[0],
    [activeId],
  );
  const c = concept.colors;

  const pageStyle = {
    background: c.bg,
    color: c.text,
  } satisfies CSSProperties;

  return (
    <div className="min-h-screen pb-10" style={pageStyle}>
      <header className="sticky top-0 z-40 border-b backdrop-blur-xl" style={{ background: `${c.bg}E6`, borderColor: c.border }}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" aria-label="Back to live homepage">
            <BrandLogo concept={concept} />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {["Market", "Vault", "Deals", "Alerts"].map((item, index) => (
              <button
                key={item}
                className="rounded-md px-3 py-2 text-sm font-semibold transition"
                style={{
                  color: index === 0 ? c.text : c.muted,
                  background: index === 0 ? c.surface2 : "transparent",
                }}
              >
                {item}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <button
              className="hidden h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold sm:flex"
              style={{ borderColor: c.border, background: c.surface, color: c.text }}
            >
              <Search className="h-4 w-4" />
              Search
            </button>
            <button
              className="h-9 rounded-md px-3 text-sm font-black"
              style={{ background: c.primary, color: c.primaryText }}
            >
              Sign In
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-6 lg:grid-cols-[1.04fr_0.96fr] lg:items-stretch">
          <div
            className="min-h-[520px] rounded-lg border p-5 sm:p-7"
            style={{ background: c.surface, borderColor: c.border }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide"
                style={{ borderColor: c.border, color: c.primary, background: c.surface2 }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {concept.name}
              </div>
              <Link to="/" className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: c.muted }}>
                Live homepage <ChevronRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-12 max-w-2xl">
              <h1 className="text-4xl font-black leading-[1.02] tracking-normal sm:text-6xl" style={{ color: c.text }}>
                {concept.headline}
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 sm:text-lg" style={{ color: c.muted }}>
                {concept.subhead}
              </p>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                className="inline-flex h-11 items-center gap-2 rounded-md px-5 text-sm font-black"
                style={{ background: c.primary, color: c.primaryText }}
              >
                <LineChart className="h-4 w-4" />
                {concept.primaryCta}
              </button>
              <button
                className="inline-flex h-11 items-center gap-2 rounded-md border px-5 text-sm font-black"
                style={{ borderColor: c.border, background: c.surface2, color: c.text }}
              >
                <WalletCards className="h-4 w-4" />
                {concept.secondaryCta}
              </button>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              <MetricCard icon={TrendingUp} label="Tracked Value" value="$2.8M" concept={concept} />
              <MetricCard icon={Eye} label="Daily Views" value="82.4K" concept={concept} />
              <MetricCard icon={ShieldCheck} label="Live Cards" value="23.5K" concept={concept} />
            </div>

            <div className="mt-7">
              <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: c.muted }}>
                Theme switcher
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {concepts.map((item) => {
                  const selected = item.id === activeId;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveId(item.id)}
                      className="rounded-lg border p-3 text-left transition"
                      style={{
                        background: selected ? item.colors.surface2 : c.surface2,
                        borderColor: selected ? item.colors.primary : c.border,
                        color: selected ? item.colors.text : c.text,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-black">{item.name}</span>
                        <span className="flex gap-1">
                          {[item.colors.primary, item.colors.accent, item.colors.accent2].map((color) => (
                            <span key={color} className="h-3 w-3 rounded-full" style={{ background: color }} />
                          ))}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5" style={{ color: selected ? item.colors.muted : c.muted }}>
                        {item.thesis}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid gap-6">
            <div
              className="rounded-lg border p-4"
              style={{ background: c.surface, borderColor: c.border }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: c.primary }}>
                    Market preview
                  </p>
                  <h2 className="mt-1 text-2xl font-black">Top cards today</h2>
                </div>
                <div className="flex rounded-md border p-1" style={{ borderColor: c.border, background: c.surface2 }}>
                  {["Top", "Sealed", "Movers"].map((tab, index) => (
                    <button
                      key={tab}
                      className="rounded px-3 py-1.5 text-xs font-black"
                      style={{ background: index === 0 ? c.primary : "transparent", color: index === 0 ? c.primaryText : c.muted }}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {sampleCards.map((card, index) => (
                  <div
                    key={card.id}
                    className="grid grid-cols-[24px_44px_1fr_auto] items-center gap-3 rounded-lg border p-2"
                    style={{ background: c.surface2, borderColor: c.border }}
                  >
                    <span className="text-sm font-black tabular-nums" style={{ color: c.muted }}>
                      {index + 1}
                    </span>
                    <img
                      src={card.image}
                      alt={card.name}
                      className="h-14 w-10 rounded object-contain"
                      loading="lazy"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black">{card.name}</p>
                      <p className="truncate text-xs" style={{ color: c.muted }}>
                        {card.set}
                      </p>
                      <div className="mt-1 flex gap-3 text-[11px] font-bold">
                        <span style={{ color: pctColor(card.day, concept) }}>24h {card.day}</span>
                        <span style={{ color: pctColor(card.week, concept) }}>7d {card.week}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black tabular-nums">{card.price}</p>
                      <p className="mt-1 text-[11px] font-bold" style={{ color: c.muted }}>
                        {card.views} views
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="rounded-lg border p-4"
              style={{ background: c.surface, borderColor: c.border }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: c.primary }}>
                    Plus panel
                  </p>
                  <h2 className="mt-1 text-2xl font-black">Umbreon ex actions</h2>
                  <p className="mt-1 text-sm" style={{ color: c.muted }}>
                    A sharper action sheet for inventory, alerts, and affiliate buys.
                  </p>
                </div>
                <button
                  className="grid h-10 w-10 place-items-center rounded-full border"
                  style={{ borderColor: c.primary, color: c.primary, background: c.surface2 }}
                  aria-label="Open action panel"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {actionItems.map(({ icon: Icon, title, text }) => (
                  <button
                    key={title}
                    className="rounded-lg border p-3 text-left transition hover:translate-y-[-1px]"
                    style={{ background: c.surface2, borderColor: c.border }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="grid h-8 w-8 place-items-center rounded-md"
                        style={{ background: `${c.primary}22`, color: c.primary }}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="text-sm font-black">{title}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5" style={{ color: c.muted }}>
                      {text}
                    </p>
                  </button>
                ))}
              </div>

              <div
                className="mt-4 flex items-center justify-between gap-3 rounded-lg border p-3"
                style={{ borderColor: c.border, background: c.surface2 }}
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-md" style={{ background: c.accent, color: c.primaryText }}>
                    <Crown className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-black">Deal Radar Pro</p>
                    <p className="text-xs" style={{ color: c.muted }}>
                      Unlimited alerts, drop digest, and portfolio reports.
                    </p>
                  </div>
                </div>
                <Star className="h-5 w-5 shrink-0" style={{ color: c.accent2 }} />
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          {[
            ["Brand voice", "Fast, collector-native, market-aware."],
            ["Logo direction", "A compact vault-card mark that scales to app icons."],
            ["Color rule", "One strong action color, one signal color, restrained surfaces."],
            ["Homepage angle", "Lead with utility: prices, alerts, deals, inventory."],
          ].map(([title, text]) => (
            <div
              key={title}
              className="rounded-lg border p-4"
              style={{ background: c.surface, borderColor: c.border }}
            >
              <p className="text-sm font-black">{title}</p>
              <p className="mt-2 text-sm leading-6" style={{ color: c.muted }}>
                {text}
              </p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
