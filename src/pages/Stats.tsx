import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import AppHeader from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { getMyGameStats, type GameRun } from "@/lib/games-stats-store";
import { Trophy, Clock, Target, TrendingUp, Gift, Gamepad2 } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

const GAME = "card-match";
const GAME_LABEL = "Card Match";

function fmtTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Stats() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      toast.info("Sign in to see your stats");
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["my-game-stats", GAME, user?.id],
    queryFn: () => getMyGameStats(GAME),
    enabled: !!user,
    staleTime: 30_000,
  });

  // Chart data: chronological order (oldest → newest), best so far
  const chartData = (() => {
    if (!data?.recent_runs?.length) return [];
    const chrono = [...data.recent_runs].reverse();
    return chrono.map((r, i) => ({
      idx: i + 1,
      score: r.score,
      date: fmtDate(r.completed_at),
    }));
  })();

  // Identify PR runs (best score so far in the chronological sequence)
  const prRuns = (() => {
    if (!data?.recent_runs?.length) return new Set<number>();
    const chrono = [...data.recent_runs].reverse();
    const set = new Set<number>();
    let best = -Infinity;
    chrono.forEach((r, i) => {
      if (r.score > best) {
        best = r.score;
        set.add(i);
      }
    });
    // Map back to descending-indexed positions used in the table
    const total = chrono.length;
    return new Set(Array.from(set).map((i) => total - 1 - i));
  })();

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <AppHeader activePage="games" />
      <div className="container py-6 px-4 sm:px-8 max-w-5xl">
        <div className="mb-6">
          <h1 className="font-display font-bold text-3xl text-foreground">My Stats</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your personal game performance and prize history.
          </p>
        </div>

        {/* Game section */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gamepad2 className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-foreground">{GAME_LABEL}</h2>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/games/card-match")}
            >
              Play
            </Button>
          </div>

          {error ? (
            <div className="p-6 text-center text-sm text-destructive">
              Couldn't load stats. Try again later.
            </div>
          ) : isLoading ? (
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 rounded-lg" />
                ))}
              </div>
              <Skeleton className="h-32 rounded-lg" />
              <Skeleton className="h-48 rounded-lg" />
            </div>
          ) : !data || data.total_games === 0 ? (
            <div className="py-12 text-center">
              <Trophy className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No games played yet.</p>
              <Button
                onClick={() => navigate("/games/card-match")}
                className="mt-4"
                size="sm"
              >
                Play your first round
              </Button>
            </div>
          ) : (
            <div className="p-5 space-y-6">
              {/* Headline tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile
                  icon={<Trophy className="w-4 h-4" />}
                  label="Best score"
                  value={data.best_score?.toLocaleString() ?? "—"}
                  accent
                />
                <StatTile
                  icon={<Target className="w-4 h-4" />}
                  label="Games played"
                  value={data.total_games.toLocaleString()}
                />
                <StatTile
                  icon={<Clock className="w-4 h-4" />}
                  label="Time played"
                  value={fmtTime(data.total_time_ms)}
                />
                <StatTile
                  icon={<TrendingUp className="w-4 h-4" />}
                  label="This week"
                  value={
                    data.weekly_rank
                      ? `#${data.weekly_rank}`
                      : "—"
                  }
                  hint={
                    data.weekly_best
                      ? `Best ${data.weekly_best.toLocaleString()}`
                      : "No score yet"
                  }
                />
              </div>

              {/* Score progression */}
              {chartData.length >= 2 && (
                <div className="rounded-lg border border-border bg-background/40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-foreground">Score progression</h3>
                    <span className="text-xs text-muted-foreground">
                      Last {chartData.length} runs
                    </span>
                  </div>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                        <XAxis
                          dataKey="idx"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                          width={40}
                        />
                        <RechartsTooltip
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                          labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
                          formatter={(value: number) => [value.toLocaleString(), "Score"]}
                        />
                        <Line
                          type="monotone"
                          dataKey="score"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "hsl(var(--primary))" }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Recent runs table */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3">Recent runs</h3>
                <RecentRunsTable runs={data.recent_runs} prRuns={prRuns} />
              </div>
            </div>
          )}
        </div>

        {/* Prize history placeholder */}
        <div className="mt-6 rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Gift className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-foreground">Prize history</h2>
          </div>
          <div className="py-10 text-center">
            <Gift className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No prizes won yet. Weekly winners are announced every Monday.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        accent
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-background/40"
      }`}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        {icon}
        <span>{label}</span>
      </div>
      <p
        className={`mt-1.5 text-xl font-bold tabular-nums ${
          accent ? "text-primary" : "text-foreground"
        }`}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

function RecentRunsTable({ runs, prRuns }: { runs: GameRun[]; prRuns: Set<number> }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/30 border-b border-border">
        <span>Date</span>
        <span className="text-right">Score</span>
        <span className="text-right">Time</span>
        <span className="text-right">Misses</span>
      </div>
      <ul className="divide-y divide-border/60">
        {runs.map((r, i) => (
          <li
            key={r.completed_at + i}
            className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2.5 text-sm items-center"
          >
            <span className="text-foreground flex items-center gap-2">
              {fmtDate(r.completed_at)}
              {prRuns.has(i) && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                  PR
                </span>
              )}
            </span>
            <span className="text-right font-semibold tabular-nums text-foreground">
              {r.score.toLocaleString()}
            </span>
            <span className="text-right tabular-nums text-muted-foreground">
              {fmtDuration(r.duration_ms)}
            </span>
            <span className="text-right tabular-nums text-muted-foreground">
              {r.wrong_flips}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
