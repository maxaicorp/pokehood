import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AdminLayout from "./AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, RefreshCw, Activity, AlertTriangle, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface CheckResult {
  ok: boolean;
  message: string;
  detail?: unknown;
}

interface SnapshotDayStat {
  date: string;
  card_rows: number;
  sealed_rows: number;
  is_daily: boolean;
  is_full: boolean;
}

interface HealthReport {
  healthy: boolean;
  checkedAt: string;
  checks: Record<string, CheckResult>;
  snapshot_history: SnapshotDayStat[];
}

const CHECK_LABELS: Record<string, string> = {
  live_cache_freshness: "Live site cache freshness",
  deltas_computed: "24h / 7d / 30d % change deltas",
  card_coverage: "Cards displayable on the site",
  price_snapshot_freshness: "Price snapshot freshness",
  sealed_freshness: "Sealed snapshot freshness",
  daily_snapshot_run: "Daily snapshot cron",
  full_snapshot_run: "Weekly full-coverage cron",
  scrydex_proxy: "Scrydex API reachability",
  card_stats_rpc: "Card stats RPC",
  sample_images: "Scrydex CDN images",
};

const CHECK_HELP: Record<string, string> = {
  live_cache_freshness:
    "The single most important signal: when was the precomputed table the site reads (latest_card_prices) last refreshed? Goes red if older than 36 hours, regardless of whether the snapshot cron itself ran successfully.",
  deltas_computed:
    "Percentage of cards in latest_card_prices that have populated price_1d / price_7d / price_30d values. If low, most rows on Market will show '—' for their 24h/7d % change columns — usually means the snapshot history is too thin (e.g. less than a day old).",
  daily_snapshot_run:
    "Daily cron writes ~7-12k card rows. Should run every day. If stale, check Supabase → Database → Cron Jobs.",
  full_snapshot_run:
    "Weekly { mode:'full' } cron writes ~17k+ priced physical card rows in one run — refreshes middle-numbered cards that daily mode skips. If missing, the weekly schedule isn't set up.",
  card_coverage:
    "Distinct cards in the live read-side cache (latest_card_prices). This is the universe of cards the site can display prices for right now.",
  scrydex_proxy:
    "Live check against Scrydex /account/v1/usage. Warns at <500 credits remaining. Starter tier resets monthly.",
};

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
  ) : (
    <XCircle className="w-5 h-5 text-red-500 shrink-0" />
  );
}

function CheckRow({ name, result }: { name: string; result: CheckResult }) {
  const label = CHECK_LABELS[name] ?? name;
  const help = CHECK_HELP[name];
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/40 last:border-b-0">
      <StatusIcon ok={result.ok} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{label}</p>
        <p className={`text-sm ${result.ok ? "text-muted-foreground" : "text-red-400"}`}>
          {result.message}
        </p>
        {help && <p className="text-xs text-muted-foreground/70 mt-1">{help}</p>}
      </div>
    </div>
  );
}

function HistoryRow({ day }: { day: SnapshotDayStat }) {
  const status = day.is_full ? "full" : day.is_daily ? "daily" : "partial";
  const badge =
    status === "full"
      ? <span className="text-xs px-2 py-0.5 rounded bg-blue-500/15 text-blue-400">full</span>
      : status === "daily"
      ? <span className="text-xs px-2 py-0.5 rounded bg-green-500/15 text-green-400">daily</span>
      : <span className="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-400">partial</span>;
  return (
    <tr className="border-b border-border/30 last:border-b-0">
      <td className="py-2 pr-3 text-sm tabular-nums">{day.date}</td>
      <td className="py-2 pr-3">{badge}</td>
      <td className="py-2 pr-3 text-sm tabular-nums text-right">{day.card_rows.toLocaleString()}</td>
      <td className="py-2 text-sm tabular-nums text-right">{day.sealed_rows.toLocaleString()}</td>
    </tr>
  );
}

export default function AdminHealth() {
  const [refreshMode, setRefreshMode] = useState<"daily" | "full" | null>(null);
  const { data, isFetching, refetch, error } = useQuery<HealthReport>({
    queryKey: ["admin-health"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("health-check");
      if (error) throw error;
      return data as HealthReport;
    },
    staleTime: 60_000,
  });

  // Master refresh — re-runs the snapshot cron on demand and tells every open
  // tab to invalidate its in-memory data. This is the "if the site ever shows
  // stale prices again, click here" button.
  const masterRefresh = async (mode: "daily" | "full") => {
    setRefreshMode(mode);
    const friendly = mode === "full" ? "Full snapshot (~17k+ priced cards, ~6 min)" : "Daily snapshot (~12k cards, ~2 min)";
    toast.info(`${friendly} started in background.`);
    try {
      // force:true overrides snapshot-prices's per-day idempotency guard.
      // Without it, clicking Daily after today's snapshot already ran returns
      // success: true, skipped: true — the user sees a green toast and zero
      // actual effect, which makes the button feel broken. With force the
      // cron actually re-runs and the cache table really does refresh.
      const body = mode === "full"
        ? { mode: "full", force: true }
        : { force: true };
      const { error } = await supabase.functions.invoke("snapshot-prices", { body });
      if (error) throw error;
      // Broadcast to every open tab to reload its prices on next visibility.
      // Storage events fire in OTHER tabs/windows of the same origin.
      try {
        localStorage.setItem("collectiblez:force-refresh", String(Date.now()));
      } catch { /* quota — ignore */ }
      toast.success(`${friendly} accepted. Re-checking health in ~30s.`);
      setTimeout(() => refetch(), 30_000);
    } catch (e) {
      toast.error(`Failed to start ${mode} snapshot: ${String(e)}`);
    } finally {
      setRefreshMode(null);
    }
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="w-6 h-6" /> System health
        </h1>
        <div className="flex gap-2">
          <Button
            onClick={() => masterRefresh("daily")}
            disabled={refreshMode !== null}
            variant="outline"
            size="sm"
          >
            <Zap className={`w-4 h-4 mr-2 ${refreshMode === "daily" ? "animate-pulse" : ""}`} />
            Master refresh (daily)
          </Button>
          <Button
            onClick={() => masterRefresh("full")}
            disabled={refreshMode !== null}
            variant="default"
            size="sm"
          >
            <Zap className={`w-4 h-4 mr-2 ${refreshMode === "full" ? "animate-pulse" : ""}`} />
            Master refresh (full)
          </Button>
          <Button onClick={() => refetch()} disabled={isFetching} variant="ghost" size="sm">
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Checking…" : "Re-check"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-6 max-w-prose">
        <strong>Master refresh</strong> kicks off a snapshot cron run immediately and broadcasts a
        force-reload signal to every open Collectiblez tab so users see fresh prices on next focus.
        Use <em>daily</em> for a quick newest+oldest pass (~120 Scrydex credits), or <em>full</em> to
        refresh every card in the catalog (~235 credits). The health checks below auto-refresh ~30s
        after a master refresh.
      </p>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sm">Health check failed to run</p>
            <p className="text-sm text-muted-foreground">{String(error)}</p>
          </div>
        </div>
      ) : !data ? (
        <p className="text-muted-foreground">Running checks…</p>
      ) : (
        <div className="space-y-6">
          <div className={`rounded-lg border p-4 flex items-center gap-3 ${
            data.healthy
              ? "border-green-500/30 bg-green-500/5"
              : "border-amber-500/30 bg-amber-500/5"
          }`}>
            <StatusIcon ok={data.healthy} />
            <div className="flex-1">
              <p className="font-medium text-sm">
                {data.healthy ? "All systems operational" : "One or more checks failing"}
              </p>
              <p className="text-xs text-muted-foreground">
                Last checked {formatDistanceToNow(new Date(data.checkedAt), { addSuffix: true })}
              </p>
            </div>
          </div>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Checks
            </h2>
            <div className="rounded-lg border border-border/50 px-4">
              {Object.entries(data.checks).map(([name, result]) => (
                <CheckRow key={name} name={name} result={result} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Snapshot history (last 14 days)
            </h2>
            <div className="rounded-lg border border-border/50 overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/30">
                  <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="text-left font-medium py-2 px-3">Date</th>
                    <th className="text-left font-medium py-2 px-3">Run type</th>
                    <th className="text-right font-medium py-2 px-3">Card rows</th>
                    <th className="text-right font-medium py-2 px-3">Sealed rows</th>
                  </tr>
                </thead>
                <tbody>
                  {data.snapshot_history.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                        No snapshots in the last 14 days.
                      </td>
                    </tr>
                  ) : (
                    data.snapshot_history.map((day) => <HistoryRow key={day.date} day={day} />)
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              <span className="text-green-400">daily</span> = ≥ 6,000 card rows ·
              <span className="text-blue-400"> full</span> = ≥ 17,000 card rows (weekly cron) ·
              <span className="text-amber-400"> partial</span> = run failed midway
            </p>
          </section>
        </div>
      )}
    </AdminLayout>
  );
}
