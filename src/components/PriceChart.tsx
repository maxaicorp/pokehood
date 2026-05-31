import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
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
}

type Range = "7d" | "30d" | "90d";

const RANGE_DAYS: Record<Range, number> = { "7d": 7, "30d": 30, "90d": 90 };

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

export default function PriceChart({
  cardId,
  currentPrice,
  cardmarketAvgs,
}: PriceChartProps) {
  const [range, setRange] = useState<Range>("30d");

  const { data: snapshotHistory, isLoading } = useQuery({
    queryKey: ["price-history", cardId],
    queryFn: () => getCardPriceHistory(cardId, 90),
    staleTime: 10 * 60_000,
  });

  // Decide what data to show
  let chartData: PriceHistoryPoint[] = [];

  if (snapshotHistory && snapshotHistory.length >= 2) {
    // We have real snapshot history — use it
    chartData = snapshotHistory;
    // Append today's live price if the latest snapshot isn't today
    if (currentPrice != null) {
      const todayStr = new Date().toISOString().split("T")[0];
      const latest = chartData[chartData.length - 1];
      if (latest.date !== todayStr) {
        chartData = [...chartData, { date: todayStr, price: currentPrice }];
      }
    }
  } else if (cardmarketAvgs && currentPrice) {
    // No snapshots yet — build synthetic from Cardmarket averages
    chartData = buildSyntheticHistory(currentPrice, cardmarketAvgs);
  } else if (currentPrice != null) {
    // Only have a single price point
    const todayStr = new Date().toISOString().split("T")[0];
    chartData = [{ date: todayStr, price: currentPrice }];
  }

  // Filter by selected range
  if (chartData.length > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    chartData = chartData.filter((p) => p.date >= cutoffStr);
  }

  const hasData = chartData.length >= 2;
  const isSynthetic = !snapshotHistory || snapshotHistory.length < 2;

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
  const gradId = `priceGrad-${up ? "up" : "down"}`;

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <h3 className="font-display font-semibold text-foreground">
            Price History
          </h3>
          {hasData && (
            <span
              className="text-xs font-semibold tabular-nums"
              style={{ color: lineColor }}
            >
              {rangePct >= 0 ? "+" : ""}{rangePct.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {(["7d", "30d", "90d"] as Range[])
            .filter((r) => !isSynthetic || r !== "90d")
            .map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                  range === r
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {r}
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
         <div className="relative">
          {/* Holographic sheen — an iridescent highlight sweeps across the
              chart like a holo card. Purely decorative, sits above the SVG. */}
          <div className="holo-sheen pointer-events-none absolute inset-0 z-10 rounded-lg" aria-hidden />
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart
              data={chartData}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.5} />
                  <stop offset="55%" stopColor={lineColor} stopOpacity={0.14} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
                {/* Luminous glow on the trend line */}
                <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
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
              <Area
                type="monotone"
                dataKey="price"
                stroke={lineColor}
                strokeWidth={2.5}
                fill={`url(#${gradId})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))", fill: lineColor }}
                style={{ filter: "url(#lineGlow)" }}
                // Re-running the draw animation on every range toggle re-rasterizes
                // the gaussian-blur glow each frame → multi-hundred-ms freeze. The
                // chart only changes on a deliberate toggle, so animation adds jank
                // without value. Disable it.
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
         </div>
          {isSynthetic && (
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              Based on Cardmarket rolling averages · Daily snapshots will fill in over time
            </p>
          )}
        </>
      )}
    </div>
  );
}
