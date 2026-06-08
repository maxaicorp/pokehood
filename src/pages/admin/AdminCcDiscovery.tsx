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
      return (row as DiscoveryState | undefined) ?? null;
    },
    refetchInterval: 5_000, // poll while a run is in flight so badges update
  });

  const rowsQ = useQuery({
    // Include last_run_at so the rows auto-refetch when a background run
    // completes. Without it, the run returns 202 immediately, rowsQ refetches
    // BEFORE the background write lands, and never again — the table looked
    // permanently empty even after a successful run. stateQ polls every 5s, so
    // when last_run_at advances this key changes and the rows reload.
    queryKey: ["cc-discovery-rows", tab, stateQ.data?.last_run_at ?? null],
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
    onSuccess: () => {
      toast.success("Discovery started. Results will update as the background run finishes.");
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

  // Matched-tab filters: grading company + minimum undervalued %. Client-side
  // over the loaded rows so it's instant.
  const [companyFilter, setCompanyFilter] = useState("all");
  const [minUnder, setMinUnder] = useState(0);
  const displayRows = useMemo(() => {
    if (tab !== "matched") return rows;
    return rows.filter((r) => {
      if (companyFilter !== "all" && (r.matched_company ?? "").toUpperCase() !== companyFilter) return false;
      if (minUnder > 0 && !((r.delta_pct ?? 0) <= -minUnder)) return false;
      return true;
    });
  }, [rows, tab, companyFilter, minUnder]);

  // Live coverage counter — how much of CC's ~52k Pokémon marketplace we've
  // imported into onchain_listings. cc-* rows come from ingest-cc-marketplace
  // (the CC API); the rest are the small ME-sourced slice. Watch this climb
  // toward ~52k once ingest-cc-marketplace is deployed + running. Refetches
  // every 15s so a running import shows live progress.
  const { data: coverage } = useQuery({
    queryKey: ["cc-coverage"],
    queryFn: async () => {
      const total = await (supabase.from as any)("onchain_listings")
        .select("pda_address", { count: "exact", head: true })
        .in("collection", ["collector_crypt", "collector_crypt_cc"]).is("delisted_at", null);
      const ccNative = await (supabase.from as any)("onchain_listings")
        .select("pda_address", { count: "exact", head: true })
        .eq("collection", "collector_crypt_cc").is("delisted_at", null);
      return { total: (total.count as number) ?? 0, ccNative: (ccNative.count as number) ?? 0 };
    },
    refetchInterval: 15_000,
  });
  const CC_TARGET = 52000;
  const ccTotal = coverage?.total ?? 0;
  const ccNative = coverage?.ccNative ?? 0;

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

      {/* CC marketplace import coverage — climbs toward ~52k as ingest-cc-marketplace runs */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 mb-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <span className="text-sm font-medium">Collector Crypt marketplace coverage</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {ccTotal.toLocaleString()} / ~{CC_TARGET.toLocaleString()} listed
          </span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-sky-500 transition-all"
            style={{ width: `${Math.min(100, (ccTotal / CC_TARGET) * 100).toFixed(1)}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {ccNative.toLocaleString()} imported via the CC API (ingest-cc-marketplace) ·{" "}
          {(ccTotal - ccNative).toLocaleString()} from Magic Eden.
          {ccNative === 0 && " — CC import not running yet (deploy ingest-cc-marketplace)."}
        </p>
      </div>

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

      {/* Matched-tab filters */}
      {tab === "matched" && rows.length > 0 && (
        <div className="flex items-center gap-3 mb-3 flex-wrap text-sm">
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs"
          >
            <option value="all">All graders</option>
            <option value="PSA">PSA</option>
            <option value="CGC">CGC</option>
            <option value="BGS">BGS</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Undervalued ≥
            <input
              type="number"
              min={0}
              value={minUnder || ""}
              onChange={(e) => setMinUnder(Number(e.target.value) || 0)}
              placeholder="0"
              className="h-8 w-16 rounded-md border border-border/60 bg-background px-2 text-xs text-foreground"
            />
            %
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {displayRows.length} of {rows.length} shown
          </span>
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
          <MatchedTable rows={displayRows} />
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
