import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { getCardPriceHistory, PriceHistoryPoint } from "@/lib/price-snapshots";
import { formatPrice } from "@/lib/pokemon-api";
import { Skeleton } from "@/components/ui/skeleton";

interface PriceChartProps {
  cardId: string;
  /** Current live market price — appended as today's point if no snapshot yet */
  currentPrice?: number | null;
  /** Cardmarket rolling averages for "synthetic" history before snapshots accumulate */
  cardmarketAvgs?: {
    avg1: number | null;
    avg7: number | null;
    avg30: number | null;
    trend: number | null;
  };
  /** Scrydex trend anchors (prior prices: 1/7/14/30/90/180d ago + current) from
   *  the live card fetch. Drawn as the deep 6-month shape, merged UNDER real
   *  snapshots (a recorded snapshot always wins on a shared date). */
  trendAnchors?: {
    market: number;
    price1d: number | null;
    price7d: number | null;
    price14d: number | null;
    price30d: number | null;
    price90d: number | null;
    price180d: number | null;
  } | null;
}

type Range = "24h" | "1m" | "3m" | "6m" | "1y";

const RANGE_DAYS: Record<Range, number> = { "24h": 1, "1m": 30, "3m": 90, "6m": 180, "1y": 365 };

function formatDateShort(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Build synthetic history points from Cardmarket rolling averages.
 * This gives us something to show before real snapshots accumulate.
 */
function buildSyntheticHistory(
  currentPrice: number,
  avgs: NonNullable<PriceChartProps["cardmarketAvgs"]>
): PriceHistoryPoint[] {
  const today = new Date();
  const points: PriceHistoryPoint[] = [];

  // Cardmarket averages are in EUR; TCGPlayer currentPrice is in USD.
  // Scale using trend as the bridge: ratio = USD price / EUR trend price.
  // This preserves the shape of price movement while keeping Y-axis in USD.
  const scaleFactor =
    avgs.trend != null && avgs.trend > 0 ? currentPrice / avgs.trend : 1;

  if (avgs.avg30 != null) {
    const d = new Date(today);
    d.setDate(d.getDate() - 30);
    points.push({ date: d.toISOString().split("T")[0], price: avgs.avg30 * scaleFactor });
  }
  if (avgs.avg7 != null) {
    const d = new Date(today);
    d.setDate(d.getDate() - 7);
    points.push({ date: d.toISOString().split("T")[0], price: avgs.avg7 * scaleFactor });
  }
  if (avgs.avg1 != null) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    points.push({ date: d.toISOString().split("T")[0], price: avgs.avg1 * scaleFactor });
  }
  // Today = currentPrice (already USD, no scaling)
  points.push({ date: today.toISOString().split("T")[0], price: currentPrice });

  return points;
}

/**
 * Build the deep 6-month shape from Scrydex trend anchors — prior prices at
 * 1/7/14/30/90/180 days ago plus the current market. These are approximations
 * (market - price_change per window) but give every card a real 6-month curve
 * the instant the page loads, with no stored history required.
 */
function buildTrendAnchors(a: NonNullable<PriceChartProps["trendAnchors"]>): PriceHistoryPoint[] {
  const today = new Date();
  const pts: PriceHistoryPoint[] = [];
  const at = (daysAgo: number, price: number | null) => {
    if (price == null || price <= 0) return;
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    pts.push({ date: d.toISOString().split("T")[0], price });
  };
  at(180, a.price180d);
  at(90, a.price90d);
  at(30, a.price30d);
  at(14, a.price14d);
  at(7, a.price7d);
  at(1, a.price1d);
  at(0, a.market);
  return pts;
}

/** Latest-point marker with an outward "sonar" ping. SVG SMIL so it animates
 *  inside the recharts SVG with no CSS/layout cost. Renders nothing for the
 *  earlier points (a plain line everywhere else). */
function SonarDot({
  cx, cy, isLast, color,
}: { cx?: number; cy?: number; isLast: boolean; color: string }) {
  if (cx == null || cy == null || !isLast) return null;
  return (
    <g style={{ pointerEvents: "none" }}>
      <circle cx={cx} cy={cy} r={3.5} fill={color} />
      <circle cx={cx} cy={cy} fill="none" stroke={color} strokeWidth={1.5}>
        <animate attributeName="r" values="3.5;13" dur="1.8s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.6;0" dur="1.8s" repeatCount="indefinite" />
      </circle>
    </g>
  );
}

export default function PriceChart({
  cardId,
  currentPrice,
  cardmarketAvgs,
  trendAnchors,
}: PriceChartProps) {
  // Default to the 3-month view. We fetch a full year so 6M/1Y are instant;
  // they show whatever history exists (and grow as snapshots accumulate /
  // after a Scrydex backfill). Synthetic-only cards fall back to 3M below.
  const [range, setRange] = useState<Range>("3m");

  const { data: snapshotHistory, isLoading } = useQuery({
    queryKey: ["price-history", cardId, 365],
    queryFn: () => getCardPriceHistory(cardId, 365),
    staleTime: 10 * 60_000,
  });

  // Build the chart by merging, lowest → highest priority:
  //   1. deep shape — Scrydex trend anchors (≈6 months) OR cardmarket synthetic
  //   2. real daily snapshots — win on any shared date (true recorded data)
  //   3. today's live price — always wins for today
  const todayStr = new Date().toISOString().split("T")[0];
  const byDate = new Map<string, number>();
  if (trendAnchors) {
    for (const p of buildTrendAnchors(trendAnchors)) byDate.set(p.date, p.price);
  } else if (cardmarketAvgs && currentPrice) {
    for (const p of buildSyntheticHistory(currentPrice, cardmarketAvgs)) byDate.set(p.date, p.price);
  }
  if (snapshotHistory) for (const p of snapshotHistory) byDate.set(p.date, p.price);
  if (currentPrice != null) byDate.set(todayStr, currentPrice);

  let chartData: PriceHistoryPoint[] = [...byDate.entries()]
    .map(([date, price]) => ({ date, price }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Deep ranges (6m/1y) are meaningful when we have trend anchors (≈180d) or
  // enough real snapshots; otherwise cap at 3m.
  const deepOk = !!trendAnchors || (snapshotHistory?.length ?? 0) >= 2;
  const effRange: Range = !deepOk && (range === "6m" || range === "1y") ? "3m" : range;

  // Filter by selected range
  if (chartData.length > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[effRange]);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    chartData = chartData.filter((p) => p.date >= cutoffStr);
  }

  // Deep part is estimated from trends until real daily snapshots fill it in.
  const usingAnchors = !!trendAnchors && (snapshotHistory?.length ?? 0) < 5;

  const hasData = chartData.length >= 2;

  // Price domain with padding
  const prices = chartData.map((p) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pad = (maxP - minP) * 0.1 || 1;

  // Trend over the visible range drives the chart color — green when the card
  // gained over the window, red when it lost. Makes "cruising the charts" read
  // like a trading view instead of a flat line.
  const firstP = chartData[0]?.price ?? 0;
  const lastP = chartData[chartData.length - 1]?.price ?? 0;
  const rangePct = firstP > 0 ? ((lastP - firstP) / firstP) * 100 : 0;
  const up = lastP >= firstP;
  const lineColor = up ? "hsl(142 71% 45%)" : "hsl(0 72% 51%)"; // emerald-500 / red-500

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="font-display font-semibold text-foreground text-sm sm:text-base whitespace-nowrap">
            History
          </h3>
          {hasData && (
            <span
              className="text-xs font-semibold tabular-nums whitespace-nowrap"
              style={{ color: lineColor }}
            >
              {rangePct >= 0 ? "+" : ""}{rangePct.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {(["24h", "1m", "3m", "6m", "1y"] as Range[])
            .filter((r) => deepOk || (r !== "6m" && r !== "1y"))
            .map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2 py-1 text-xs rounded-md font-medium transition-colors ${
                  effRange === r
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.toUpperCase()}
              </button>
            ))}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : !hasData ? (
        <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
          Price history will appear here once daily snapshots accumulate.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 10, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateShort}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                domain={[minP - pad, maxP + pad]}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                width={45}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                labelFormatter={formatDateShort}
                formatter={(value: number) => [formatPrice(value), "Price"]}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke={lineColor}
                strokeWidth={2}
                // Sonar ping on the most recent point; plain (no dot) elsewhere.
                dot={(props: { cx?: number; cy?: number; index?: number }) => (
                  <SonarDot
                    key={`dot-${props.index}`}
                    cx={props.cx}
                    cy={props.cy}
                    isLast={props.index === chartData.length - 1}
                    color={lineColor}
                  />
                )}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))", fill: lineColor }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
          {usingAnchors && (
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              Older points estimated from Scrydex trends · daily snapshots fill in the detail over time
            </p>
          )}
        </>
      )}
    </div>
  );
}
