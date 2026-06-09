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

// Per-set snapshot ledger row (scrydex_set_snapshot_state). The real
// "what's actually hitting" health signal — one row per expansion.
interface SetHealthRow {
  set_id: string;
  set_name: string | null;
  status: string;
  last_success_on: string | null;
  last_success_at: string | null;
  card_total: number | null;
  last_cards_priced: number | null;
  attempts_today: number;
  attempts_on: string | null;
  last_error: string | null;
}

// Scrydex webhook delivery (observer mode → webhook_events_log).
interface WebhookEvent {
  id: number;
  received_at: string;
  source: string | null;
  event_name: string | null;
  expansion_count: number | null;
  sig_valid: boolean | null;
  sig_reason: string | null;
}

const CHECK_LABELS: Record<string, string> = {
  pipeline_completeness: "Pipeline complete (the contract)",
  onchain_health: "Onchain healthy (the contract)",
  end_to_end_read: "End-to-end read (what users see)",
  live_cache_freshness: "Live site cache freshness",
  deltas_computed: "24h / 7d / 30d % change deltas",
  sealed_deltas_computed: "Sealed 1d deltas computed",
  new_sets: "New sets discovered",
  card_coverage: "Cards displayable on the site",
  price_snapshot_freshness: "Price snapshot freshness",
  sealed_freshness: "Sealed snapshot freshness",
  sealed_catalog_freshness: "Sealed catalog coverage",
  daily_snapshot_run: "Daily snapshot cron",
  full_snapshot_run: "Weekly full-coverage cron",
  scrydex_proxy: "Scrydex API reachability",
  card_stats_rpc: "Card stats RPC",
  sample_images: "Scrydex CDN images",
};

const CHECK_HELP: Record<string, string> = {
  pipeline_completeness:
    "THE contract — the one signal that means the same thing here, in the health-check function, and in the heal cron (get_pipeline_completeness SQL fn). COMPLETE means the live read cache was rebuilt from the latest complete priced snapshot window, nearly all live rows come from that same window, 24h deltas are populated, and the cache is fresh. This catches stale carry-forward prices even when pg_cron reported 'succeeded'.",
  onchain_health:
    "Onchain subsystem contract (get_onchain_health SQL fn), shared with the heal-onchain cron. Goes red two ways: (1) a stalled ingest — activity or listings older than 6h; the heal cron re-triggers the ingest. (2) a SANITY-GUARD trip — a sale priced like a parse bug (>$100k) or a price_info shape the renderer doesn't recognize; these are logic bugs the heal cron FLAGS for a human rather than re-running (re-ingest can't fix wrong math). The shape guard is what would have caught the CC $90k display bug on day one.",
  end_to_end_read:
    "The single truest signal. Exercises the exact read paths the frontend uses (get_latest_price_page for cards, latest_card_prices for sealed) and confirms real priced rows come back. Unlike the stage checks, this goes red whenever a filter or empty cache would blank the actual page — it would have caught both recent sealed bugs immediately.",
  sealed_deltas_computed:
    "Percent of sealed products in latest_card_prices that have a populated price_1d. Mirrors the card delta check, which excludes sealed — that blind spot is why the Sealed tab showed '—' for every change. 0% means the sealed read path is broken again.",
  live_cache_freshness:
    "The single most important signal: when was the precomputed table the site reads (latest_card_prices) last refreshed? Goes red if older than 36 hours, regardless of whether the snapshot cron itself ran successfully.",
  deltas_computed:
    "Percentage of cards in latest_card_prices that have populated price_1d / price_7d / price_30d values. If low, most rows on Market will show '—' for their 24h/7d % change columns — usually means the snapshot history is too thin (e.g. less than a day old).",
  new_sets:
    "Detects sets that have snapshot data (or are listed in Scrydex /expansions) but aren't in market-sets.json — meaning /sets/{slug} won't render them. When this fires, ingest the missing set into the static catalog so the frontend can show it.",
  sealed_catalog_freshness:
    "Diffs sealed products that have prices in the DB against the sealed_products catalog table the Sealed tab renders. Goes red when products are priced but missing from the catalog — the exact failure that hid Chaos Rising (me4) for 7 weeks. Fix: run snapshot-sealed with { force: true } to repopulate the catalog.",
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

function StatCard({ label, value, ok }: { label: string; value: string | number; ok: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${ok ? "border-border/50" : "border-amber-500/40 bg-amber-500/5"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${ok ? "" : "text-amber-400"}`}>{value}</p>
    </div>
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
  const [crawling, setCrawling] = useState(false);
  const [recrawling, setRecrawling] = useState<Set<string>>(new Set());
  const { data, isFetching, refetch, error } = useQuery<HealthReport>({
    queryKey: ["admin-health"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("health-check");
      if (error) throw error;
      return data as HealthReport;
    },
    staleTime: 60_000,
  });

  // Per-set snapshot ledger — read straight from the tracker (admin RLS), so it
  // works even when the global health-check function is down. THIS is the check
  // that tells you which expansions are actually landing vs failing today.
  const { data: setHealth, error: setHealthError, refetch: refetchSetHealth } = useQuery<SetHealthRow[]>({
    queryKey: ["admin-set-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scrydex_set_snapshot_state")
        .select("set_id,set_name,status,last_success_on,last_success_at,card_total,last_cards_priced,attempts_today,attempts_on,last_error")
        .eq("enabled", true);
      if (error) throw error;
      return (data ?? []) as SetHealthRow[];
    },
    staleTime: 60_000,
    refetchInterval: crawling ? 20_000 : false, // live progress while a re-crawl runs
    retry: false,
  });

  // Scrydex webhook deliveries (observer). Reads webhook_events_log (admin RLS).
  const { data: webhookEvents, error: webhookError } = useQuery<WebhookEvent[]>({
    queryKey: ["admin-webhook-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhook_events_log")
        .select("id,received_at,source,event_name,expansion_count,sig_valid,sig_reason")
        .order("received_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as WebhookEvent[];
    },
    staleTime: 30_000,
    retry: false,
  });

  // Force a full per-set re-crawl — the button version of the manual reset:
  // (1) mark every set due again, (2) kick the crawl immediately (don't wait for
  // the 5-min cron), (3) poll the per-set panel live until the catalog is fresh,
  // (4) refresh the read cache + broadcast a force-reload to open tabs.
  // Uses the drift-free per-set pipeline — NOT the old global crawl.
  const forceRecrawl = async () => {
    setCrawling(true);
    try {
      const { data: n, error: rErr } = await supabase.rpc("request_full_resnapshot");
      if (rErr) throw rErr;
      toast.info(`Re-crawling ${n ?? "all"} sets in the background (~20 min). The panel below updates live.`);
      // Kick off immediately: 5 calls × 40 sets (the cron would also pick it up).
      await Promise.all(
        Array.from({ length: 5 }, () =>
          supabase.functions.invoke("snapshot-prices", { body: { mode: "crawl-batch", limit: 40 } }),
        ),
      );
      // Poll the tracker until every set is fresh (or a 25-min safety cap).
      const startedAt = Date.now();
      const today = new Date().toISOString().slice(0, 10);
      const poll = setInterval(async () => {
        const { data: rows } = await refetchSetHealth();
        const list = (rows ?? []) as SetHealthRow[];
        const fresh = list.filter((s) => s.last_success_on === today).length;
        const total = list.length;
        if ((total > 0 && fresh >= total) || Date.now() - startedAt > 25 * 60_000) {
          clearInterval(poll);
          setCrawling(false);
          await supabase.rpc("refresh_latest_card_prices");
          try { localStorage.setItem("collectiblez:force-refresh", String(Date.now())); } catch { /* quota */ }
          refetch();
          toast.success(`Re-crawl complete — ${fresh}/${total} sets fresh, cache refreshed.`);
        }
      }, 20_000);
    } catch (e) {
      setCrawling(false);
      toast.error(`Re-crawl failed: ${String(e)}`);
    }
  };

  // Recrawl ONE set — atomic crawl-sets (write + tracker stamp + cache refresh),
  // then refetch so that row flips to fresh. Cheap (~1-2 credits) vs a full cycle.
  const recrawlSet = async (setId: string) => {
    setRecrawling((p) => new Set(p).add(setId));
    const done = () => setRecrawling((p) => { const n = new Set(p); n.delete(setId); return n; });
    try {
      const { error } = await supabase.functions.invoke("snapshot-prices", {
        body: { mode: "crawl-sets", setIds: [setId] },
      });
      if (error) throw error;
      toast.info(`Recrawling ${setId}…`);
      // One set crawls + refreshes in the background in a few seconds.
      setTimeout(async () => { await refetchSetHealth(); done(); toast.success(`${setId} recrawled.`); }, 8000);
    } catch (e) {
      done();
      toast.error(`Recrawl ${setId} failed: ${String(e)}`);
    }
  };

  // Derived per-set health (UTC date matches the cron's recorded_at).
  const todayUTC = new Date().toISOString().slice(0, 10);
  const sets = setHealth ?? [];
  const setFresh = sets.filter((s) => s.last_success_on === todayUTC).length;
  const setErrored = sets.filter((s) => s.status === "error").length;
  const setFailing = sets.filter(
    (s) => s.attempts_on === todayUTC && s.attempts_today >= 3 && s.last_success_on !== todayUTC,
  ).length;
  const cardsPricedToday = sets
    .filter((s) => s.last_success_on === todayUTC)
    .reduce((n, s) => n + (s.last_cards_priced ?? 0), 0);
  const setRank = (s: SetHealthRow) =>
    s.status === "error" ? 0 : s.last_success_on !== todayUTC ? 1 : 2; // problems first
  const sortedSets = [...sets].sort(
    (a, b) => setRank(a) - setRank(b) || (a.last_success_at ?? "").localeCompare(b.last_success_at ?? ""),
  );

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="w-6 h-6" /> System health
        </h1>
        <div className="flex gap-2">
          <Button
            onClick={forceRecrawl}
            disabled={crawling}
            variant="default"
            size="sm"
          >
            <Zap className={`w-4 h-4 mr-2 ${crawling ? "animate-pulse" : ""}`} />
            {crawling ? "Re-crawling…" : "Re-crawl all sets now"}
          </Button>
          <Button onClick={() => refetch()} disabled={isFetching} variant="ghost" size="sm">
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Checking…" : "Re-check"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-6 max-w-prose">
        <strong>Re-crawl all sets now</strong> marks every set due and runs the drift-free per-set
        crawl immediately (instead of waiting for the 00:00 UTC cycle). It re-fetches the whole
        catalog from canonical Scrydex (~300 credits, ~20 min), then refreshes the read cache and
        force-reloads open tabs. Watch the <em>Per-set snapshot health</em> panel below — it updates
        live as sets land (fresh today climbs to {sets.length || "~181"}).
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
              Per-set snapshot health
            </h2>
            {setHealthError ? (
              <div className="rounded-lg border border-border/50 p-4 text-sm text-muted-foreground">
                Per-set tracker not deployed yet. Run migrations <code>20260607090000</code> +{" "}
                <code>20260607093000</code>, deploy <code>snapshot-prices</code>, then run{" "}
                <code>docs/PER_SET_PIPELINE_DEPLOY.sql</code>.
              </div>
            ) : sets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Registry empty — run the <code>seed-sets</code> step in the deploy SQL.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  <StatCard label="Sets fresh today" value={`${setFresh}/${sets.length}`} ok={setFresh === sets.length} />
                  <StatCard label="In error" value={setErrored} ok={setErrored === 0} />
                  <StatCard label="Failing repeatedly" value={setFailing} ok={setFailing === 0} />
                  <StatCard label="Cards priced today" value={cardsPricedToday.toLocaleString()} ok={true} />
                </div>
                <div className="rounded-lg border border-border/50 overflow-hidden">
                  <div className="max-h-[28rem] overflow-auto">
                    <table className="w-full">
                      <thead className="bg-muted/30 sticky top-0">
                        <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="text-left font-medium py-2 px-3">Set</th>
                          <th className="text-left font-medium py-2 px-3">State</th>
                          <th className="text-right font-medium py-2 px-3">Priced / total</th>
                          <th className="text-right font-medium py-2 px-3">Last success</th>
                          <th className="text-left font-medium py-2 px-3">Note</th>
                          <th className="text-right font-medium py-2 px-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedSets.map((r) => {
                          const isFresh = r.last_success_on === todayUTC;
                          const badge =
                            r.status === "error"
                              ? <span className="text-xs px-2 py-0.5 rounded bg-red-500/15 text-red-400">error</span>
                              : isFresh
                              ? <span className="text-xs px-2 py-0.5 rounded bg-green-500/15 text-green-400">fresh</span>
                              : <span className="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-400">stale</span>;
                          return (
                            <tr key={r.set_id} className="border-b border-border/30 last:border-b-0">
                              <td className="py-2 px-3 text-sm">
                                <span className="font-medium">{r.set_name || r.set_id}</span>
                                <span className="text-muted-foreground ml-1.5 font-mono text-xs">{r.set_id}</span>
                              </td>
                              <td className="py-2 px-3">{badge}</td>
                              <td className="py-2 px-3 text-sm text-right tabular-nums">
                                {r.last_cards_priced ?? "—"}
                                <span className="text-muted-foreground"> / {r.card_total ?? "?"}</span>
                              </td>
                              <td className="py-2 px-3 text-sm text-right tabular-nums text-muted-foreground">
                                {r.last_success_at
                                  ? formatDistanceToNow(new Date(r.last_success_at), { addSuffix: true })
                                  : "never"}
                              </td>
                              <td className="py-2 px-3 text-xs text-red-400/90 max-w-[16rem] truncate">
                                {r.last_error ||
                                  (r.attempts_on === todayUTC && r.attempts_today >= 3 && !isFresh
                                    ? `${r.attempts_today} attempts, no success`
                                    : "")}
                              </td>
                              <td className="py-2 px-3 text-right">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2"
                                  disabled={recrawling.has(r.set_id)}
                                  onClick={() => recrawlSet(r.set_id)}
                                  title={`Recrawl ${r.set_id} now`}
                                >
                                  <RefreshCw className={`w-3.5 h-3.5 ${recrawling.has(r.set_id) ? "animate-spin" : ""}`} />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Scrydex webhooks (observer)
            </h2>
            {webhookError ? (
              <div className="rounded-lg border border-border/50 p-4 text-sm text-muted-foreground">
                Webhook log not available. Run migration <code>20260606170000_webhook_events_log.sql</code>,
                deploy <code>scrydex-webhook</code>, and add the endpoint in the Scrydex dashboard.
              </div>
            ) : !webhookEvents || webhookEvents.length === 0 ? (
              <div className="rounded-lg border border-border/50 p-4 text-sm text-muted-foreground">
                No webhook deliveries yet. Scrydex fires when an expansion's prices update — once it
                does, events show here. This is the firing-pattern data we need to build the
                real-time (webhook-triggered) pipeline.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                  <StatCard
                    label="Last received"
                    value={formatDistanceToNow(new Date(webhookEvents[0].received_at), { addSuffix: true })}
                    ok={true}
                  />
                  <StatCard label="Events (recent)" value={webhookEvents.length} ok={true} />
                  <StatCard
                    label="Signature valid"
                    value={`${webhookEvents.filter((w) => w.sig_valid).length}/${webhookEvents.length}`}
                    ok={webhookEvents.every((w) => w.sig_valid)}
                  />
                </div>
                <div className="rounded-lg border border-border/50 overflow-hidden">
                  <div className="max-h-[24rem] overflow-auto">
                    <table className="w-full">
                      <thead className="bg-muted/30 sticky top-0">
                        <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="text-left font-medium py-2 px-3">Received</th>
                          <th className="text-left font-medium py-2 px-3">Event</th>
                          <th className="text-right font-medium py-2 px-3">Expansions</th>
                          <th className="text-left font-medium py-2 px-3">Signature</th>
                        </tr>
                      </thead>
                      <tbody>
                        {webhookEvents.map((w) => (
                          <tr key={w.id} className="border-b border-border/30 last:border-0">
                            <td className="py-2 px-3 text-sm tabular-nums text-muted-foreground">
                              {formatDistanceToNow(new Date(w.received_at), { addSuffix: true })}
                            </td>
                            <td className="py-2 px-3 text-sm font-mono">{w.event_name ?? "—"}</td>
                            <td className="py-2 px-3 text-sm text-right tabular-nums">{w.expansion_count ?? "—"}</td>
                            <td className="py-2 px-3">
                              {w.sig_valid ? (
                                <span className="text-xs px-2 py-0.5 rounded bg-green-500/15 text-green-400">valid</span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 rounded bg-red-500/15 text-red-400">{w.sig_reason || "invalid"}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
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
