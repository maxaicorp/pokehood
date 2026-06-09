import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, Treemap } from "recharts";
import { getSets, formatPrice, type PokemonSet } from "@/lib/pokemon-api";
import { getSetIndexOverview, formatPct, type SetIndexRow } from "@/lib/price-snapshots";
import { setPath } from "@/lib/slug";
import AppHeader from "@/components/AppHeader";
import SEO from "@/components/SEO";
import SetLogo from "@/components/SetLogo";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Activity, Flame, Grid2X2, TrendingDown, TrendingUp } from "lucide-react";

type HeatWindow = "24h" | "7d" | "30d";

const WINDOWS: Array<{ key: HeatWindow; label: string }> = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
];

const GRID = "grid-cols-[48px_1fr_104px_76px_76px] sm:grid-cols-[64px_1fr_132px_108px_82px_82px_82px]";

function pctFor(row: SetIndexRow, window: HeatWindow): number | null {
  if (window === "24h") return row.pct1d;
  if (window === "7d") return row.pct7d;
  return row.pct30d;
}

function heatStyle(pct: number | null): React.CSSProperties {
  if (pct == null || !Number.isFinite(pct)) return {};
  const strength = Math.min(Math.abs(pct), 12) / 12;
  const alpha = 0.06 + strength * 0.18;
  const borderAlpha = 0.35 + strength * 0.4;
  const rgb = pct >= 0 ? "22, 163, 74" : "220, 38, 38";
  return {
    background: `linear-gradient(90deg, rgba(${rgb}, ${alpha}) 0%, rgba(${rgb}, 0.03) 45%, transparent 100%)`,
    boxShadow: `inset 3px 0 rgba(${rgb}, ${borderAlpha})`,
  };
}

function MiniSpark({ data, up }: { data: { date: string; value: number }[]; up: boolean }) {
  if (!data || data.length < 2) {
    return <div className="h-8 flex items-center text-[10px] text-muted-foreground/60">building...</div>;
  }
  const color = up ? "hsl(142 71% 45%)" : "hsl(0 72% 51%)";
  return (
    <div className="h-8 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, bottom: 4, left: 0, right: 0 }}>
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.6} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Pct({ pct }: { pct: number | null }) {
  const f = formatPct(pct);
  return <span className={`tabular-nums ${f.className}`}>{f.text}</span>;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s;
}

function displaySetName(row: SetIndexRow, set?: PokemonSet): string {
  return set?.name || row.setName || row.setId;
}

function setLogoUrl(setId: string, set?: PokemonSet): string {
  return set?.images?.logo || `https://images.scrydex.com/pokemon/${setId}-logo/logo`;
}

// Solid fill colored by % move — green up / red down, darker = bigger move,
// near-flat = neutral gray. The TradingView-style heatmap look.
function heatFill(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct) || Math.abs(pct) < 0.4) return "hsl(220 9% 38%)";
  const s = Math.min(Math.abs(pct), 8) / 8;
  return `hsl(${pct >= 0 ? 142 : 0} 58% ${52 - s * 26}%)`;
}

// recharts Treemap tile: filled rect + set logo/name + % (when the tile is big enough).
function HeatTile(props: {
  x?: number; y?: number; width?: number; height?: number; name?: string; pct?: number; logo?: string;
}) {
  const { x = 0, y = 0, width = 0, height = 0, name = "", pct, logo = "" } = props;
  if (!(width > 0 && height > 0)) return null;
  const fill = heatFill(typeof pct === "number" ? pct : null);
  const mid = width > 46 && height > 28;
  const big = width > 86 && height > 60;
  const logoSize = Math.max(20, Math.min(58, width * 0.44, height * 0.34));
  const labelY = big && logo ? y + height - 24 : y + height / 2 + 4;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="hsl(var(--background))" strokeWidth={2} rx={2} />
      {big && logo && (
        <>
          <rect
            x={x + width / 2 - logoSize / 2 - 8}
            y={y + Math.max(8, height * 0.14) - 6}
            width={logoSize + 16}
            height={logoSize + 12}
            rx={8}
            fill="rgba(0,0,0,0.24)"
            style={{ pointerEvents: "none" }}
          />
          <image
            href={logo}
            x={x + width / 2 - logoSize / 2}
            y={y + Math.max(8, height * 0.14)}
            width={logoSize}
            height={logoSize}
            preserveAspectRatio="xMidYMid meet"
            style={{ pointerEvents: "none" }}
          />
        </>
      )}
      {mid && (
        <text x={x + width / 2} y={labelY} textAnchor="middle" fill="#fff"
          fontSize={big ? Math.min(13, width / 7) : 10} fontWeight={600} style={{ pointerEvents: "none" }}>
          {truncate(String(name), Math.max(4, Math.floor(width / 8)))}
        </text>
      )}
      {big && (
        <text x={x + width / 2} y={y + height - 9} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={700} style={{ pointerEvents: "none" }}>
          {typeof pct === "number" ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
        </text>
      )}
    </g>
  );
}

export default function Indexes() {
  const [windowKey, setWindowKey] = useState<HeatWindow>("7d");
  const navigate = useNavigate();

  const { data: setsResult } = useQuery({
    queryKey: ["sets-meta"],
    queryFn: getSets,
    staleTime: 5 * 60_000,
  });
  const { data: rows, isLoading } = useQuery({
    queryKey: ["set-index-overview"],
    queryFn: getSetIndexOverview,
    staleTime: 60_000,
  });

  const setMeta = useMemo(() => {
    const map = new Map<string, PokemonSet>();
    for (const set of setsResult?.data ?? []) map.set(set.id, set);
    return map;
  }, [setsResult]);

  const rankedRows = useMemo(() => {
    return [...(rows ?? [])].sort((a, b) => {
      const ap = pctFor(a, windowKey);
      const bp = pctFor(b, windowKey);
      return Math.abs(bp ?? -999) - Math.abs(ap ?? -999) || b.totalValue - a.totalValue;
    });
  }, [rows, windowKey]);

  // Treemap tiles: top sets by value, sized by index value, colored by the
  // selected window's % move.
  const treemapData = useMemo(
    () =>
      [...(rows ?? [])]
        .sort((a, b) => b.totalValue - a.totalValue)
        .slice(0, 40)
        .map((r) => {
          const set = setMeta.get(r.setId);
          return {
            name: displaySetName(r, set),
            size: Math.max(r.totalValue, 1),
            pct: pctFor(r, windowKey),
            logo: setLogoUrl(r.setId, set),
            setId: r.setId,
          };
        }),
    [rows, setMeta, windowKey],
  );

  const summary = useMemo(() => {
    const current = rows ?? [];
    const priced = current.filter((row) => pctFor(row, windowKey) != null);
    const totalValue = current.reduce((sum, row) => sum + row.totalValue, 0);
    const avgMove = priced.length
      ? priced.reduce((sum, row) => sum + (pctFor(row, windowKey) ?? 0), 0) / priced.length
      : null;
    return {
      setCount: current.length,
      totalValue,
      avgMove,
      hot: priced.filter((row) => (pctFor(row, windowKey) ?? 0) > 0).length,
      cold: priced.filter((row) => (pctFor(row, windowKey) ?? 0) < 0).length,
    };
  }, [rows, windowKey]);

  const groups = useMemo(() => {
    const bySeries = new Map<string, Array<{ row: SetIndexRow; set?: PokemonSet }>>();
    for (const row of rankedRows) {
      const set = setMeta.get(row.setId);
      const series = set?.series || "Other";
      if (!bySeries.has(series)) bySeries.set(series, []);
      bySeries.get(series)!.push({ row, set });
    }

    return [...bySeries.entries()]
      .map(([series, items]) => ({
        series,
        items,
        total: items.reduce((sum, item) => sum + item.row.totalValue, 0),
        heat: Math.max(...items.map((item) => Math.abs(pctFor(item.row, windowKey) ?? 0))),
      }))
      .sort((a, b) => b.heat - a.heat || b.total - a.total);
  }, [rankedRows, setMeta, windowKey]);

  const topRow = rankedRows[0] ?? null;
  const topMove = topRow ? pctFor(topRow, windowKey) : null;
  const topSet = topRow ? displaySetName(topRow, setMeta.get(topRow.setId)) : "No data";
  const avg = formatPct(summary.avgMove);
  const top = formatPct(topMove);

  return (
    <AppHeader activePage="heatmap">
      <SEO
        title="Pokemon Card Market Heatmap"
        description="Track Pokemon TCG set movement by 24h, 7d, and 30d aggregate market value."
        canonical="https://collectiblez.app/heatmap"
      />
      <div className="container max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Grid2X2 className="w-5 h-5 text-primary" />
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Market Heatmap</h1>
            </div>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Set-level movement from the cached price pipeline. Values are one-of-each aggregate prices.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-border bg-background p-1 w-fit">
            {WINDOWS.map((window) => (
              <Button
                key={window.key}
                size="sm"
                variant={windowKey === window.key ? "default" : "ghost"}
                className="h-8 px-4 rounded-md"
                onClick={() => setWindowKey(window.key)}
              >
                {window.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              <Activity className="w-3.5 h-3.5" />
              Sets tracked
            </div>
            <p className="text-2xl font-bold tabular-nums">{summary.setCount.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              <Flame className="w-3.5 h-3.5" />
              Hottest set
            </div>
            <p className="text-sm font-semibold truncate">{topSet}</p>
            <p className={`text-xl font-bold tabular-nums ${top.className}`}>{top.text}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              <TrendingUp className="w-3.5 h-3.5" />
              Hot / cold
            </div>
            <p className="text-2xl font-bold tabular-nums">
              <span className="text-green-600">{summary.hot}</span>
              <span className="text-muted-foreground text-base mx-1">/</span>
              <span className="text-red-600">{summary.cold}</span>
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              <TrendingDown className="w-3.5 h-3.5" />
              Total index
            </div>
            <p className="text-lg font-bold tabular-nums">{formatPrice(summary.totalValue)}</p>
            <p className={`text-xs font-semibold tabular-nums ${avg.className}`}>{avg.text} avg {windowKey}</p>
          </div>
        </div>

        {!isLoading && treemapData.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-2 sm:p-3 mb-6">
            <p className="text-xs text-muted-foreground px-1 pb-2">
              Top {treemapData.length} sets by value — tile size = index value, color = {windowKey} move, logo = set. Click a tile to open the set.
            </p>
            <div className="h-[380px] sm:h-[440px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Treemap
                  data={treemapData}
                  dataKey="size"
                  stroke="hsl(var(--background))"
                  isAnimationActive={false}
                  content={<HeatTile /> as any}
                  onClick={(node: any) => {
                    const set = node?.setId ? setMeta.get(node.setId) : undefined;
                    if (set) navigate(setPath(set));
                  }}
                />
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : groups.length === 0 ? (
          <p className="text-muted-foreground">No index data yet. Run the set-index refresh job.</p>
        ) : (
          <div className="space-y-7">
            {groups.map((group) => (
              <section key={group.series}>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.series}
                  </h2>
                  <span className="text-xs text-muted-foreground tabular-nums">{formatPrice(group.total)}</span>
                </div>
                <div className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className={`hidden sm:grid ${GRID} gap-3 px-4 py-2 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground items-center`}>
                    <span />
                    <span>Set</span>
                    <span>90 days</span>
                    <span className="text-right">Index</span>
                    <span className="text-right">24h</span>
                    <span className="text-right">7d</span>
                    <span className="text-right">30d</span>
                  </div>
                  {group.items.map(({ row, set }) => {
                    const selectedPct = pctFor(row, windowKey);
                    const name = displaySetName(row, set);
                    const inner = (
                      <div className={`grid ${GRID} gap-3 px-4 py-2.5 items-center`} style={heatStyle(selectedPct)}>
                        <SetLogo setId={row.setId} fallbackUrl={set?.images?.logo} className="h-8 w-auto max-w-[56px] object-contain" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{name}</p>
                          <p className="text-xs text-muted-foreground">{row.cardCount} cards</p>
                        </div>
                        <MiniSpark data={row.sparkline} up={(selectedPct ?? 0) >= 0} />
                        <p className="text-sm font-bold text-foreground text-right tabular-nums">{formatPrice(row.totalValue)}</p>
                        <p className="text-sm font-semibold text-right"><Pct pct={row.pct1d} /></p>
                        <p className="text-sm font-semibold text-right"><Pct pct={row.pct7d} /></p>
                        <p className="hidden sm:block text-sm font-semibold text-right"><Pct pct={row.pct30d} /></p>
                      </div>
                    );
                    return set ? (
                      <Link key={row.setId} to={setPath(set)} className="block border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                        {inner}
                      </Link>
                    ) : (
                      <div key={row.setId} className="border-b border-border/50 last:border-0">{inner}</div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppHeader>
  );
}
