import type { Token } from "@core/types";
import { fetchPriceSnapshots } from "./tokenStore";

export type ChartPoint = {
  timestamp: number;
  price: number;
};

export type ChartRange = "LIVE" | "1D" | "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";

const rangeMs: Record<ChartRange, number> = {
  LIVE: 60 * 60 * 1000,
  "1D": 24 * 60 * 60 * 1000,
  "1W": 7 * 24 * 60 * 60 * 1000,
  "1M": 30 * 24 * 60 * 60 * 1000,
  "3M": 90 * 24 * 60 * 60 * 1000,
  YTD: getYtdMs(),
  "1Y": 365 * 24 * 60 * 60 * 1000,
  ALL: 5 * 365 * 24 * 60 * 60 * 1000
};

export async function fetchTokenHistory(token: Token, range: ChartRange): Promise<ChartPoint[]> {
  const sinceIso = new Date(Date.now() - rangeMs[range]).toISOString();
  const snapshots = await fetchPriceSnapshots(token.mint, sinceIso);
  const points = snapshots.map((snapshot) => ({
    price: snapshot.priceUsd,
    timestamp: new Date(snapshot.recordedAt).getTime()
  }));

  return appendLivePoint(downsample(points, 79), token);
}

function appendLivePoint(points: ChartPoint[], token: Token): ChartPoint[] {
  const liveTimestamp = Date.now();
  const lastPoint = points.at(-1);
  const nextPoint = {
    price: token.priceUsd,
    timestamp: liveTimestamp
  };

  if (!lastPoint) return [nextPoint];
  if (Math.abs(lastPoint.price - token.priceUsd) < 0.000000001 && liveTimestamp - lastPoint.timestamp < 30_000) {
    return points;
  }

  return [...points, nextPoint];
}

function downsample(points: ChartPoint[], maxPoints: number): ChartPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, index) => index % step === 0).slice(-maxPoints);
}

function getYtdMs() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.max(60_000, now.getTime() - start.getTime());
}
