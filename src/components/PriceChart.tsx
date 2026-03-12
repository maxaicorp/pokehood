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

  // 30 days ago
  if (avgs.avg30 != null) {
    const d = new Date(today);
    d.setDate(d.getDate() - 30);
    points.push({ date: d.toISOString().split("T")[0], price: avgs.avg30 });
  }
  // 7 days ago
  if (avgs.avg7 != null) {
    const d = new Date(today);
    d.setDate(d.getDate() - 7);
    points.push({ date: d.toISOString().split("T")[0], price: avgs.avg7 });
  }
  // 1 day ago
  if (avgs.avg1 != null) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    points.push({ date: d.toISOString().split("T")[0], price: avgs.avg1 });
  }
  // today (trend or live)
  points.push({
    date: today.toISOString().split("T")[0],
    price: avgs.trend ?? currentPrice,
  });

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

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-semibold text-foreground">
          Price History
        </h3>
        <div className="flex gap-1">
          {(["7d", "30d", "90d"] as Range[]).map((r) => (
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
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart
              data={chartData}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
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
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#priceGrad)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
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
