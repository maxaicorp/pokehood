// AdminFunctions — per-edge-function health monitoring.
//
// Why this page exists: Supabase edge functions deploy independently. We've
// hit cases where one function had the latest code and another was still
// running a 3-day-old version, and there was no way to tell from
// /admin/health (which only checks DB state). This page pings every edge
// function directly and shows status + response time + raw response
// preview per function. Lets us trace any "the site is broken" report
// back to a specific deploy state in seconds.
//
// Each function has a smart probe: the cheapest reachable endpoint that
// returns observable success vs. failure without requiring auth or
// expensive work (no triggering snapshot-prices for real, etc.).

import { useState, useCallback, useEffect } from "react";
import AdminLayout from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Activity as ActivityIcon, Code } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// One probe spec per edge function. `query` and `body` shape it as a
// cheap "is this deployed and reachable" check — never triggers expensive
// real work. `expectShape` is a sample check on the response so we can
// distinguish "function exists and runs" from "function exists but returns
// garbage".
interface ProbeSpec {
  name: string;
  description: string;
  // GET if `body` is undefined, POST with body otherwise.
  query?: string;
  body?: Record<string, unknown>;
  // Optional callback that asserts a shape on the parsed response. Return
  // null if shape looks right, otherwise return an error message.
  expectShape?: (json: unknown) => string | null;
  // Some functions return non-200 by design when called with no auth/body.
  // Mark those so we don't flag them as errors.
  okStatuses?: number[];
}

const FUNCTIONS: ProbeSpec[] = [
  {
    name: "health-check",
    description: "Aggregate DB + RPC + image health probe.",
    expectShape: (j) => (j && typeof j === "object" && "checks" in (j as object)) ? null : "missing `checks` field",
  },
  {
    name: "sol-price",
    description: "SOL/USD spot price via Jupiter, Pyth fallback.",
    expectShape: (j) => {
      const o = j as { price?: number } | null;
      if (!o || typeof o.price !== "number" || o.price <= 0) return "missing or invalid `price`";
      return null;
    },
  },
  {
    name: "onchain-activity",
    description: "Magic Eden activity feed for Collector Crypt + Helius name enrichment.",
    query: "?collection=collector_crypt&limit=3",
    expectShape: (j) => {
      if (!Array.isArray(j)) return "expected array";
      if (j.length === 0) return "empty response";
      const first = j[0] as { tokenMint?: string; name?: string };
      if (!first.tokenMint) return "no tokenMint in first row";
      // Names are best-effort, don't fail if absent — but flag it
      return first.name ? null : "WARNING: no `name` (Helius enrichment may be skipped)";
    },
  },
  {
    name: "onchain-listings",
    description: "Magic Eden listings for Collector Crypt, moonbirds filtered.",
    query: "?collection=collector_crypt&limit=20",
    expectShape: (j) => {
      const o = j as { items?: unknown[] } | null;
      if (!o || !Array.isArray(o.items)) return "missing `items` array";
      if (o.items.length === 0) return "WARNING: 0 items returned (filter may be too aggressive or ME has no listings)";
      return null;
    },
  },
  {
    name: "scrydex-proxy",
    description: "Proxy for Scrydex card-data API.",
    query: "?path=/health",
    okStatuses: [200, 400, 404, 502],
  },
  {
    name: "snapshot-prices",
    description: "Daily price snapshot pipeline. POST {force:true,probeOnly:true} to test.",
    body: { probeOnly: true },
    okStatuses: [200, 202, 400, 405, 500],
  },
  {
    name: "snapshot-sealed",
    description: "Daily sealed-product snapshot pipeline.",
    body: { probeOnly: true },
    okStatuses: [200, 202, 400, 405, 500],
  },
  {
    name: "check-subscription",
    description: "Stripe subscription status check (requires auth).",
    body: {},
    okStatuses: [200, 401, 403],
  },
  {
    name: "create-checkout",
    description: "Stripe checkout session creation (requires auth).",
    body: {},
    okStatuses: [200, 400, 401, 403, 405],
  },
  {
    name: "customer-portal",
    description: "Stripe customer portal link (requires auth).",
    body: {},
    okStatuses: [200, 400, 401, 403, 405],
  },
  {
    name: "game-card-match-start",
    description: "Card-match game session start (requires auth).",
    body: {},
    okStatuses: [200, 400, 401, 403, 405],
  },
  {
    name: "game-card-match-flip",
    description: "Card-match game card flip (requires auth).",
    body: { sessionId: "probe", cardIndex: 0 },
    okStatuses: [200, 400, 401, 403, 404, 405],
  },
  {
    name: "giveaway-submit",
    description: "Giveaway entry submission.",
    body: { probeOnly: true },
    okStatuses: [200, 400, 401, 403, 405],
  },
  {
    name: "giveaway-confirm",
    description: "Giveaway entry email confirmation.",
    query: "?token=probe",
    okStatuses: [200, 400, 401, 404, 410],
  },
  {
    name: "scrydex-new-sets-check",
    description: "Detects new TCG sets on Scrydex not yet in our card index (e.g. 'Chaos Rising' released after last build).",
    expectShape: (j) => {
      const o = j as { missing?: unknown[]; missingCount?: number } | null;
      if (!o || !Array.isArray(o.missing)) return "missing `missing[]` field";
      if (o.missingCount && o.missingCount > 0) {
        const names = (o.missing as Array<{ name?: string }>).slice(0, 3).map((m) => m.name).join(", ");
        return `WARNING: ${o.missingCount} new set(s) not in card index: ${names}`;
      }
      return null;
    },
  },
];

interface ProbeResult {
  name: string;
  description: string;
  status: number | "network-error" | "timeout";
  durationMs: number;
  shapeError: string | null;
  preview: string;
  ok: boolean;
}

async function probeOne(spec: ProbeSpec): Promise<ProbeResult> {
  const url = `${SUPABASE_URL}/functions/v1/${spec.name}${spec.query ?? ""}`;
  const t0 = performance.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(url, {
      method: spec.body !== undefined ? "POST" : "GET",
      headers: {
        apikey: ANON_KEY,
        ...(spec.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const durationMs = Math.round(performance.now() - t0);
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    const shapeError = spec.expectShape && res.ok ? spec.expectShape(json) : null;
    const allowedStatuses = new Set(spec.okStatuses ?? [200, 202]);
    const statusOk = allowedStatuses.has(res.status);
    return {
      name: spec.name,
      description: spec.description,
      status: res.status,
      durationMs,
      shapeError,
      preview: text.slice(0, 200),
      ok: statusOk && (!shapeError || shapeError.startsWith("WARNING")),
    };
  } catch (e: unknown) {
    const durationMs = Math.round(performance.now() - t0);
    const isTimeout = (e as { name?: string })?.name === "AbortError";
    return {
      name: spec.name,
      description: spec.description,
      status: isTimeout ? "timeout" : "network-error",
      durationMs,
      shapeError: String(e),
      preview: "",
      ok: false,
    };
  }
}

export default function AdminFunctions() {
  const [results, setResults] = useState<Map<string, ProbeResult>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);

  const runOne = useCallback(async (spec: ProbeSpec) => {
    setLoading((prev) => new Set(prev).add(spec.name));
    const result = await probeOne(spec);
    setResults((prev) => {
      const next = new Map(prev);
      next.set(spec.name, result);
      return next;
    });
    setLoading((prev) => {
      const next = new Set(prev);
      next.delete(spec.name);
      return next;
    });
  }, []);

  const runAll = useCallback(async () => {
    setRunning(true);
    await Promise.all(FUNCTIONS.map((s) => runOne(s)));
    setRunning(false);
  }, [runOne]);

  // Auto-probe everything on mount.
  useEffect(() => {
    runAll();
    // intentionally not re-running on dep change — manual via Refresh button
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const failedCount = [...results.values()].filter((r) => !r.ok).length;
  const totalCount = results.size;

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Code className="w-6 h-6" /> Edge functions
        </h1>
        <div className="flex gap-2">
          <Button onClick={runAll} disabled={running} variant="default" size="sm">
            <RefreshCw className={`w-4 h-4 mr-2 ${running ? "animate-spin" : ""}`} />
            Re-probe all ({FUNCTIONS.length})
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-6 max-w-prose">
        Probes every Supabase edge function with the cheapest reachable request and shows
        deployed status, response time, response shape, and a 200-char preview. Use this
        when something on the site looks broken to trace whether it's a function being
        down or returning bad data.
      </p>

      {totalCount > 0 && (
        <div className={`rounded-lg border p-4 mb-6 flex items-center gap-3 ${
          failedCount === 0 ? "border-green-500/30 bg-green-500/5" : "border-amber-500/30 bg-amber-500/5"
        }`}>
          {failedCount === 0 ? (
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          )}
          <p className="text-sm">
            {failedCount === 0
              ? `All ${totalCount} functions probed OK`
              : `${failedCount} of ${totalCount} functions failed or returned unexpected shape`}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {FUNCTIONS.map((spec) => {
          const result = results.get(spec.name);
          const isLoading = loading.has(spec.name);
          return (
            <FunctionRow
              key={spec.name}
              spec={spec}
              result={result}
              isLoading={isLoading}
              onProbe={() => runOne(spec)}
            />
          );
        })}
      </div>
    </AdminLayout>
  );
}

function FunctionRow({
  spec,
  result,
  isLoading,
  onProbe,
}: {
  spec: ProbeSpec;
  result?: ProbeResult;
  isLoading: boolean;
  onProbe: () => void;
}) {
  const borderClass = !result
    ? "border-border/40"
    : result.ok
    ? "border-green-500/30"
    : "border-red-500/30";

  return (
    <div className={`rounded-lg border ${borderClass} p-4`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {isLoading ? (
              <ActivityIcon className="w-4 h-4 text-muted-foreground animate-pulse" />
            ) : !result ? (
              <ActivityIcon className="w-4 h-4 text-muted-foreground" />
            ) : result.ok ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : (
              <XCircle className="w-4 h-4 text-red-500" />
            )}
            <span className="font-mono font-semibold text-sm">{spec.name}</span>
            {result && (
              <>
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                  typeof result.status === "number" && result.status < 400
                    ? "bg-green-500/10 text-green-400"
                    : "bg-red-500/10 text-red-400"
                }`}>
                  {result.status}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{result.durationMs}ms</span>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{spec.description}</p>
          {result?.shapeError && (
            <p className={`text-xs mt-1.5 ${result.shapeError.startsWith("WARNING") ? "text-amber-400" : "text-red-400"}`}>
              {result.shapeError}
            </p>
          )}
        </div>
        <Button onClick={onProbe} disabled={isLoading} variant="ghost" size="sm">
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {isLoading && !result && <Skeleton className="h-3 w-3/4 mt-2" />}
      {result?.preview && (
        <pre className="text-[10px] font-mono text-muted-foreground bg-muted/30 rounded p-2 mt-2 overflow-x-auto whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
          {result.preview}
        </pre>
      )}
    </div>
  );
}
