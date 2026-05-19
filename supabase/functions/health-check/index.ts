/**
 * health-check edge function
 *
 * Verifies that all critical site systems are working correctly.
 * Call manually or schedule daily.
 *
 * Checks:
 *   1. price_snapshots freshness — has data from today or yesterday
 *   2. Card coverage — at least 1,000 distinct card IDs in price_snapshots
 *   3. Sealed snapshot freshness — has sealed rows from last 48 hours
 *   4. Scrydex proxy — can reach API and shows remaining credits
 *   5. Card stats RPC — increment_card_stat function exists
 *   6. Sample image reachability — 3 Scrydex CDN images return 200
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sample Scrydex CDN image URLs to probe (no API credits used)
const SAMPLE_IMAGES = [
  "https://images.scrydex.com/pokemon/mcd24-13/small",
  "https://images.scrydex.com/pokemon/mcd24-14/small",
  "https://images.scrydex.com/pokemon/mcd24-15/small",
];

interface CheckResult {
  ok: boolean;
  message: string;
  detail?: unknown;
}

async function checkPriceSnapshotFreshness(
  supabase: any,
): Promise<CheckResult> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const cutoff = yesterday.toISOString().split("T")[0];

  const { count, error } = await supabase
    .from("price_snapshots")
    .select("*", { count: "exact", head: true })
    .gte("recorded_at", cutoff);

  if (error) return { ok: false, message: "DB query failed", detail: error.message };
  if (!count || count === 0) return { ok: false, message: `No snapshots since ${cutoff}` };
  return { ok: true, message: `${count.toLocaleString()} snapshots since ${cutoff}` };
}

async function checkCardCoverage(
  supabase: any,
): Promise<CheckResult> {
  const { count, error } = await supabase
    .from("price_snapshots")
    .select("card_id", { count: "exact", head: true })
    .not("card_id", "like", "sealed-%");

  if (error) return { ok: false, message: "DB query failed", detail: error.message };
  const n = count ?? 0;
  if (n < 1000) return { ok: false, message: `Only ${n} card snapshots (expected ≥ 1,000)` };
  return { ok: true, message: `${n.toLocaleString()} card snapshots in DB` };
}

async function checkSealedFreshness(
  supabase: any,
): Promise<CheckResult> {
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const cutoff = twoDaysAgo.toISOString().split("T")[0];

  const { count, error } = await supabase
    .from("price_snapshots")
    .select("*", { count: "exact", head: true })
    .like("card_id", "sealed-%")
    .gte("recorded_at", cutoff);

  if (error) return { ok: false, message: "DB query failed", detail: error.message };
  if (!count || count === 0) return { ok: false, message: `No sealed snapshots since ${cutoff}` };
  return { ok: true, message: `${count} sealed product snapshots since ${cutoff}` };
}

// ─── Snapshot-run history (last 14 days) ──────────────────────────────────────
//
// A successful daily run writes ~7-12k card rows. A successful full run writes
// ~20-22k card rows. The shape of recorded_at counts over the last 14 days
// tells us whether both cadences are firing.

const DAILY_RUN_THRESHOLD = 6_000;   // partial daily counts as a daily; below this is a broken run
const FULL_RUN_THRESHOLD  = 18_000;  // full mode writes ~22k; allow some headroom

interface SnapshotDayStat {
  date: string;
  card_rows: number;
  sealed_rows: number;
  is_daily: boolean;
  is_full: boolean;
}

async function loadSnapshotHistory(
  supabase: any,
  days = 14,
): Promise<{
  history: SnapshotDayStat[];
  last_daily: SnapshotDayStat | null;
  last_full: SnapshotDayStat | null;
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStr = cutoff.toISOString().split("T")[0];

  // Pull just recorded_at + a sealed/non-sealed flag for every snapshot in the
  // window. This is up to ~150k tiny rows for the default 14-day window — well
  // under PostgREST's response limit when select is narrow.
  const cardCounts = new Map<string, number>();
  const sealedCounts = new Map<string, number>();

  // Paginate so we don't truncate at PostgREST's default 1000-row cap.
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("price_snapshots")
      .select("recorded_at, card_id")
      .gte("recorded_at", cutoffStr)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("snapshot history query failed:", error.message);
      break;
    }
    const rows = (data ?? []) as { recorded_at: string; card_id: string }[];
    for (const r of rows) {
      const m = r.card_id.startsWith("sealed-") ? sealedCounts : cardCounts;
      m.set(r.recorded_at, (m.get(r.recorded_at) ?? 0) + 1);
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  const dates = new Set<string>([...cardCounts.keys(), ...sealedCounts.keys()]);
  const history: SnapshotDayStat[] = [...dates]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((date) => {
      const cards = cardCounts.get(date) ?? 0;
      const sealed = sealedCounts.get(date) ?? 0;
      return {
        date,
        card_rows: cards,
        sealed_rows: sealed,
        is_daily: cards >= DAILY_RUN_THRESHOLD,
        is_full: cards >= FULL_RUN_THRESHOLD,
      };
    });

  const last_daily = history.find((d) => d.is_daily) ?? null;
  const last_full  = history.find((d) => d.is_full)  ?? null;
  return { history, last_daily, last_full };
}

function checkDailyRun(last: SnapshotDayStat | null): CheckResult {
  if (!last) return { ok: false, message: "No successful daily snapshot in the last 14 days" };
  const ageDays = Math.floor(
    (Date.now() - new Date(last.date).getTime()) / 86_400_000,
  );
  if (ageDays > 2) {
    return {
      ok: false,
      message: `Last daily run was ${ageDays} days ago (${last.date}, ${last.card_rows.toLocaleString()} card rows)`,
      detail: last,
    };
  }
  return {
    ok: true,
    message: `Last daily run: ${last.date} — ${last.card_rows.toLocaleString()} card rows`,
    detail: last,
  };
}

function checkFullRun(last: SnapshotDayStat | null): CheckResult {
  if (!last) {
    return {
      ok: false,
      message: "No full-coverage run in the last 14 days. Schedule { mode:'full' } weekly to refresh middle-numbered cards.",
    };
  }
  const ageDays = Math.floor(
    (Date.now() - new Date(last.date).getTime()) / 86_400_000,
  );
  if (ageDays > 8) {
    return {
      ok: false,
      message: `Last full run was ${ageDays} days ago (${last.date}). Should run weekly.`,
      detail: last,
    };
  }
  return {
    ok: true,
    message: `Last full run: ${last.date} — ${last.card_rows.toLocaleString()} card rows`,
    detail: last,
  };
}

async function checkScrydexProxy(apiKey: string, teamId: string): Promise<CheckResult> {
  if (!apiKey || !teamId) return { ok: false, message: "Missing SCRYDEX_API_KEY or SCRYDEX_TEAM_ID" };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://api.scrydex.com/account/v1/usage", {
      headers: { "X-Api-Key": apiKey, "X-Team-ID": teamId },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, message: `Scrydex returned ${res.status}` };
    const data = await res.json();
    const credits = data?.data?.credits_remaining;
    if (credits != null && credits < 500) {
      return { ok: false, message: `Low credits: ${credits} remaining`, detail: data.data };
    }
    return { ok: true, message: `Scrydex reachable — ${credits ?? "?"} credits remaining`, detail: data.data };
  } catch (e) {
    return { ok: false, message: `Scrydex unreachable: ${e}` };
  }
}

async function checkCardStatsRpc(
  supabase: any,
): Promise<CheckResult> {
  try {
    // Call with a test card — fire and forget, we just need it to not throw
    const { error } = await supabase.rpc(
      "increment_card_stat",
      {
        p_tcg_api_id: "__health_check__",
        p_name: "Health Check",
        p_set_name: "System",
        p_image_small: "",
        p_stat: "view",
      },
    );
    if (error) return { ok: false, message: "increment_card_stat RPC failed", detail: String(error) };
    return { ok: true, message: "increment_card_stat RPC is working" };
  } catch (e) {
    return { ok: false, message: "increment_card_stat RPC threw", detail: String(e) };
  }
}

async function checkSampleImages(): Promise<CheckResult> {
  const results: string[] = [];
  for (const url of SAMPLE_IMAGES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch(url, { method: "HEAD", signal: controller.signal });
      clearTimeout(timeout);
      results.push(`${res.status}`);
    } catch {
      results.push("error");
    }
  }
  const allOk = results.every((r) => r === "200");
  return {
    ok: allOk,
    message: allOk ? "All sample images reachable" : `Some images failed: ${results.join(", ")}`,
    detail: results,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const apiKey = Deno.env.get("SCRYDEX_API_KEY") ?? "";
  const teamId = Deno.env.get("SCRYDEX_TEAM_ID") ?? "";
  const checkedAt = new Date().toISOString();

  const [freshness, coverage, sealedFreshness, scrydex, statsRpc, images, snapshotHistory] = await Promise.all([
    checkPriceSnapshotFreshness(supabase),
    checkCardCoverage(supabase),
    checkSealedFreshness(supabase),
    checkScrydexProxy(apiKey, teamId),
    checkCardStatsRpc(supabase),
    checkSampleImages(),
    loadSnapshotHistory(supabase, 14),
  ]);

  const dailyRun = checkDailyRun(snapshotHistory.last_daily);
  const fullRun  = checkFullRun(snapshotHistory.last_full);

  const checks = {
    price_snapshot_freshness: freshness,
    card_coverage: coverage,
    sealed_freshness: sealedFreshness,
    daily_snapshot_run: dailyRun,
    full_snapshot_run: fullRun,
    scrydex_proxy: scrydex,
    card_stats_rpc: statsRpc,
    sample_images: images,
  };

  const allOk = Object.values(checks).every((c) => c.ok);

  const report = {
    healthy: allOk,
    checkedAt,
    checks,
    snapshot_history: snapshotHistory.history,
  };
  console.log("Health check:", JSON.stringify(report, null, 2));

  return new Response(JSON.stringify(report), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: allOk ? 200 : 207,
  });
});
