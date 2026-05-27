// /admin/cc-discovery — Collector Crypt valuation discovery tool.
//
// Empty by default. Click "Run discovery" → server-side matcher runs over
// every active CC listing, joins against Scrydex price catalogs, writes
// results to the cc_discovery_results cache. 10-minute cooldown enforced
// server-side; this UI just shows a countdown when not allowed.
//
// Two tabs: Matched (sorted by delta% asc, undervalued at top) + Unmatched
// (for iterating on the matcher when CC names don't fit the heuristics).

import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "./AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Search, TrendingDown, AlertTriangle, ExternalLink, CheckCircle2, XCircle,
} from "lucide-react";
import { toast } from "sonner";

interface DiscoveryState {
  last_run_at: string | null;
  status: "idle" | "running" | "error";
  total_active: number;
  matched_count: number;
  unmatched_count: number;
  undervalued_count: number;
  last_error: string | null;
  can_run_at: string | null;
}

interface DiscoveryRow {
  pda_address: string;
  token_mint: string;
  listing_name: string | null;
  listing_image: string | null;
  listing_price_usd: number | null;
  marketplace_url: string | null;
  matched_card_id: string | null;
  matched_card_name: string | null;
  matched_set_name: string | null;
  matched_company: string | null;
  matched_grade: number | null;
  market_price_usd: number | null;
  delta_pct: number | null;
  match_method: string;
  match_confidence: number | null;
  status: "matched" | "unmatched";
}

type Tab = "matched" | "unmatched";

function formatUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: n >= 1000 ? 0 : 2 });
}
function formatPct(n: number | null | undefined): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function useCountdown(target: string | null): string | null {
  // Live countdown to the next allowed Run. Returns null when target is in
  // the past (Run is allowed). 1-second tick is plenty for a 10-min window.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (!target) return null;
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return null;
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function AdminCcDiscovery() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("matched");

  const stateQ = useQuery({
    queryKey: ["cc-discovery-state"],
    queryFn: async (): Promise<DiscoveryState | null> => {
      const { data, error } = await supabase.rpc("get_cc_discovery_state");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row ?? null;
    },
    refetchInterval: 5_000, // poll while a run is in flight so badges update
  });

  const rowsQ = useQuery({
    queryKey: ["cc-discovery-rows", tab],
    queryFn: async (): Promise<DiscoveryRow[]> => {
      const { data, error } = await supabase.rpc("get_cc_discovery", {
        p_status: tab, p_limit: 200, p_offset: 0,
      });
      if (error) throw error;
      return (data ?? []) as DiscoveryRow[];
    },
  });

  const runMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("cc-discovery-run", { body: {} });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Discovery complete · matched ${data?.matched ?? "?"} of ${data?.total_active ?? "?"} · ${data?.undervalued ?? 0} undervalued`);
      qc.invalidateQueries({ queryKey: ["cc-discovery-state"] });
      qc.invalidateQueries({ queryKey: ["cc-discovery-rows"] });
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Discovery run failed");
      qc.invalidateQueries({ queryKey: ["cc-discovery-state"] });
    },
  });

  const state = stateQ.data;
  const countdown = useCountdown(state?.can_run_at ?? null);
  const canRun = !runMut.isPending && state?.status !== "running" && !countdown;

  const rows = rowsQ.data ?? [];
  // For the matched tab, surface a separate count of just the undervalued
  // rows (delta < 0) — that's the actionable subset.
  const undervaluedRows = useMemo(
    () => rows.filter((r) => (r.delta_pct ?? 0) < 0),
    [rows],
  );

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Search className="w-6 h-6" /> Collector Crypt Discovery
        </h1>
        <div className="flex items-center gap-3">
          {state?.last_run_at && (
            <span className="text-xs text-muted-foreground tabular-nums">
              Last run {ago(state.last_run_at)}
            </span>
          )}
          <Button
            onClick={() => runMut.mutate()}
            disabled={!canRun}
            size="sm"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${runMut.isPending || state?.status === "running" ? "animate-spin" : ""}`} />
            {runMut.isPending || state?.status === "running"
              ? "Running…"
              : countdown
              ? `Run again in ${countdown}`
              : state?.last_run_at
              ? "Run discovery"
              : "Run discovery"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-6 max-w-prose">
        Checks every active Collector Crypt listing and compares its price
        to Scrydex's market data. Undervalued listings (negative delta) show
        first. Cooldown is 10 minutes between runs.
        {!state?.last_run_at && " The table is empty until the first run."}
      </p>

      {/* Summary cards */}
      {state && state.total_active > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <SummaryCard label="Active listings" value={state.total_active.toLocaleString()} />
          <SummaryCard label="Matched" value={state.matched_count.toLocaleString()} icon={CheckCircle2} accent="text-emerald-500" />
          <SummaryCard label="Unmatched" value={state.unmatched_count.toLocaleString()} icon={XCircle} accent="text-amber-500" />
          <SummaryCard label="Undervalued" value={state.undervalued_count.toLocaleString()} icon={TrendingDown} accent="text-sky-500" />
        </div>
      )}

      {state?.last_error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 mb-4 text-sm">
          <AlertTriangle className="w-4 h-4 inline mr-2 text-destructive" />
          Last run errored: <span className="font-mono">{state.last_error}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-border/50">
        {([
          { v: "matched",   label: `Matched (${state?.matched_count ?? 0})` },
          { v: "unmatched", label: `Unmatched (${state?.unmatched_count ?? 0})` },
        ] as const).map(({ v, label }) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === v ? "text-foreground border-primary" : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "matched" && state?.matched_count != null && state.matched_count > 0 && undervaluedRows.length === 0 && (
        <div className="text-xs text-muted-foreground mb-3">
          No undervalued listings in this run. The table below shows all matched listings sorted by delta.
        </div>
      )}

      {/* Results table */}
      <div className="rounded-lg border border-border/50 overflow-hidden">
        {rowsQ.isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {state?.last_run_at
              ? `No ${tab} listings in this run.`
              : "Click \"Run discovery\" to populate."}
          </div>
        ) : tab === "matched" ? (
          <MatchedTable rows={rows} />
        ) : (
          <UnmatchedTable rows={rows} />
        )}
      </div>
    </AdminLayout>
  );
}

function SummaryCard({
  label, value, icon: Icon, accent,
}: { label: string; value: string; icon?: typeof CheckCircle2; accent?: string }) {
  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
        {Icon && <Icon className={`w-3.5 h-3.5 ${accent ?? ""}`} />}
        <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function MatchedTable({ rows }: { rows: DiscoveryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">Listing</th>
            <th className="text-left px-3 py-2">Match</th>
            <th className="text-right px-3 py-2">List $</th>
            <th className="text-right px-3 py-2">Market $</th>
            <th className="text-right px-3 py-2">Δ%</th>
            <th className="text-left px-3 py-2">Method</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const undervalued = (r.delta_pct ?? 0) < 0;
            return (
              <tr key={r.pda_address} className="border-t border-border/30 hover:bg-muted/20">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {r.listing_image ? (
                      <img src={r.listing_image} alt="" className="w-8 h-11 object-cover bg-muted shrink-0" loading="lazy" />
                    ) : (
                      <div className="w-8 h-11 bg-muted shrink-0" />
                    )}
                    <span className="truncate max-w-[260px]" title={r.listing_name ?? ""}>
                      {r.listing_name ?? <span className="font-mono text-xs text-muted-foreground">{r.token_mint.slice(0, 8)}…</span>}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="text-xs">
                    <div className="font-medium">{r.matched_card_name}</div>
                    <div className="text-muted-foreground">
                      {r.matched_set_name}
                      {r.matched_company && r.matched_grade != null && (
                        <> · {r.matched_company} {r.matched_grade}</>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatUsd(r.listing_price_usd)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatUsd(r.market_price_usd)}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-semibold ${undervalued ? "text-emerald-500" : (r.delta_pct ?? 0) > 0 ? "text-rose-500" : "text-muted-foreground"}`}>
                  {formatPct(r.delta_pct)}
                </td>
                <td className="px-3 py-2">
                  <MethodBadge method={r.match_method} confidence={r.match_confidence} />
                </td>
                <td className="px-3 py-2 text-right">
                  {r.marketplace_url && (
                    <a href={r.marketplace_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-xs text-primary hover:underline">
                      View <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UnmatchedTable({ rows }: { rows: DiscoveryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">Listing</th>
            <th className="text-right px-3 py-2">List $</th>
            <th className="text-left px-3 py-2">Mint</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pda_address} className="border-t border-border/30 hover:bg-muted/20">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  {r.listing_image ? (
                    <img src={r.listing_image} alt="" className="w-8 h-11 object-cover bg-muted shrink-0" loading="lazy" />
                  ) : (
                    <div className="w-8 h-11 bg-muted shrink-0" />
                  )}
                  <span className="truncate max-w-[360px]" title={r.listing_name ?? ""}>
                    {r.listing_name ?? <span className="font-mono text-xs text-muted-foreground">no name</span>}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatUsd(r.listing_price_usd)}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.token_mint.slice(0, 10)}…</td>
              <td className="px-3 py-2 text-right">
                {r.marketplace_url && (
                  <a href={r.marketplace_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-xs text-primary hover:underline">
                    View <ExternalLink className="w-3 h-3 ml-1" />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MethodBadge({ method, confidence }: { method: string; confidence: number | null }) {
  const tone =
    method === "graded_attrs" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
    : method === "raw_attrs"   ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
    : method === "name_parse"  ? "bg-sky-500/10 text-sky-500 border-sky-500/30"
    : "bg-muted text-muted-foreground border-border";
  const label =
    method === "graded_attrs" ? "graded"
    : method === "raw_attrs"   ? "raw"
    : method === "name_parse"  ? "name"
    : method;
  return (
    <Badge variant="outline" className={`text-[10px] font-mono ${tone}`}>
      {label}{confidence != null ? ` · ${Math.round(confidence * 100)}%` : ""}
    </Badge>
  );
}
