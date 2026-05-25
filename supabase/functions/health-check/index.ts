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
  // Count distinct CARDS the site can currently display, not history rows.
  // This is the latest_card_prices table (one row per card) — what the
  // Market RPC actually reads. Counting price_snapshots history (~240k
  // rows for 22k cards × ~11 days) was misleading: the displayed number
  // grew over time even though the user-visible card count was constant.
  const { count, error } = await supabase
    .from("latest_card_prices")
    .select("card_id", { count: "exact", head: true })
    .not("card_id", "like", "sealed-%");

  if (error) return { ok: false, message: "DB query failed", detail: error.message };
  const n = count ?? 0;
  if (n < 1000) return { ok: false, message: `Only ${n} cards in the live cache (expected >= 1,000)` };
  return { ok: true, message: `${n.toLocaleString()} cards displayable on the site` };
}

// "Are there new sets we've collected snapshot data for but haven't ingested
// into the static market-sets.json the frontend uses?" Calls the
// scrydex-new-sets-check function and reports any high-priority gaps.
// The me4 (Chaos Rising) case: we had 100 priced cards in the DB but no
// /sets/chaos-rising landing page because the static metadata was missing.
// This check would have surfaced that gap on day 1 instead of waiting for
// a user to notice.
async function checkNewSets(): Promise<CheckResult> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
      ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl) return { ok: true, message: "skipped (no SUPABASE_URL env)" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(`${supabaseUrl}/functions/v1/scrydex-new-sets-check`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, message: `scrydex-new-sets-check returned ${res.status}` };
    const body = await res.json() as {
      healthy?: boolean;
      missingCount?: number;
      missing?: Array<{ id: string; name: string; priority?: string; reason?: string }>;
    };
    const missing = body.missing ?? [];
    const highPri = missing.filter((m) => m.priority === "high");
    if (highPri.length === 0) {
      return {
        ok: true,
        message: `All known sets are in the frontend catalog (${body.missingCount ?? 0} other gaps).`,
        detail: body,
      };
    }
    const names = highPri.slice(0, 3).map((m) => m.name).join(", ");
    return {
      ok: false,
      message: `${highPri.length} new set(s) not in market-sets.json: ${names}${highPri.length > 3 ? `, +${highPri.length - 3} more` : ""}. Add them so /sets/{slug} pages exist.`,
      detail: { high_priority: highPri, all: body },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `scrydex-new-sets-check failed: ${msg}` };
  }
}

// "Are the 24h/7d/30d price deltas actually populated?" The site's % change
// columns depend on latest_card_prices.{price_1d, price_7d, price_30d}.
// If those are null on most cards, every row shows "—" instead of a
// percentage — which historically looked like a frontend bug but was
// really a snapshot-history gap.
async function checkDeltasComputed(
  supabase: any,
): Promise<CheckResult> {
  const { count: total, error: e1 } = await supabase
    .from("latest_card_prices")
    .select("card_id", { count: "exact", head: true })
    .not("card_id", "like", "sealed-%");
  if (e1) return { ok: false, message: "DB query failed", detail: e1.message };

  const { count: withDeltas, error: e2 } = await supabase
    .from("latest_card_prices")
    .select("card_id", { count: "exact", head: true })
    .not("card_id", "like", "sealed-%")
    .not("price_1d", "is", null);
  if (e2) return { ok: false, message: "DB query failed", detail: e2.message };

  const t = total ?? 0;
  const w = withDeltas ?? 0;
  const pct = t > 0 ? (w / t) * 100 : 0;
  const detail = { total: t, with_deltas: w, pct };
  if (t === 0) return { ok: false, message: "latest_card_prices is empty" };
  if (pct < 50) return {
    ok: false,
    message: `Only ${pct.toFixed(0)}% of cards have 24h deltas (${w.toLocaleString()}/${t.toLocaleString()}). Site will show "—" for most % change columns.`,
    detail,
  };
  return {
    ok: true,
    message: `${pct.toFixed(0)}% of cards have 24h/7d/30d % change deltas computed (${w.toLocaleString()}/${t.toLocaleString()}).`,
    detail,
  };
}

// "Is the precomputed cache the site reads fresh?" Looks at the most recent
// updated_at in latest_card_prices. The cache is refreshed at the end of
// every successful snapshot run via refresh_latest_card_prices(). If this is
// stale, the snapshot may have run but the read-side table was never
// updated — which means the site is serving yesterday's prices regardless
// of whether the cron itself succeeded.
//
// Column name pedantry: the table schema uses `updated_at` (see migration
// 20260519010000_latest_card_prices_table.sql:28). This check previously
// queried `refreshed_at` which doesn't exist — every probe failed with
// "column does not exist" until 2026-05-25.
async function checkLiveCacheFreshness(
  supabase: any,
): Promise<CheckResult> {
  const { data, error } = await supabase
    .from("latest_card_prices")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) return { ok: false, message: "DB query failed", detail: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  const ts = row?.updated_at as string | undefined;
  if (!ts) return { ok: false, message: "latest_card_prices is empty" };
  const ageMs = Date.now() - new Date(ts).getTime();
  const ageHours = ageMs / 3_600_000;
  if (ageHours > 36) {
    return {
      ok: false,
      message: `Cache refreshed ${ageHours.toFixed(1)}h ago (${ts}). Site is showing stale prices.`,
      detail: { updated_at: ts, age_hours: ageHours },
    };
  }
  return {
    ok: true,
    message: `Cache refreshed ${ageHours < 1 ? `${Math.round(ageMs / 60_000)}m` : `${ageHours.toFixed(1)}h`} ago — site is showing current prices.`,
    detail: { updated_at: ts, age_hours: ageHours },
  };
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
// ~17k+ priced physical card rows. The shape of recorded_at counts over the last 14 days
// tells us whether both cadences are firing.

const DAILY_RUN_THRESHOLD = 6_000;   // partial daily counts as a daily; below this is a broken run
const FULL_RUN_THRESHOLD  = 17_000;  // full mode writes every currently priced physical card

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

// ─── Onchain ingest freshness ────────────────────────────────────────────────
//
// The new /onchain page reads exclusively from onchain_activities +
// onchain_listings. If either ingest cron stops firing, the corresponding tab
// goes stale (no new activity rows / listings frozen). These checks read the
// most-recent ingested_at / last_seen_at and alert when they age past the
// expected cadence.

async function checkOnchainActivityFreshness(
  supabase: any,
): Promise<CheckResult> {
  const { data, error } = await supabase
    .from("onchain_activities")
    .select("ingested_at")
    .order("ingested_at", { ascending: false })
    .limit(1);
  if (error) return { ok: false, message: "DB query failed", detail: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  const ts = row?.ingested_at as string | undefined;
  if (!ts) return { ok: false, message: "onchain_activities is empty — ingest-onchain-activity has never run" };
  const ageMs = Date.now() - new Date(ts).getTime();
  const ageMin = ageMs / 60_000;
  // Cron is meant to fire every 60s. >10min is the alert threshold (worker
  // missed several runs); below that it's normal jitter.
  if (ageMin > 10) {
    return {
      ok: false,
      message: `Last activity ingest was ${ageMin.toFixed(1)}m ago (${ts}). /onchain/activity is stale.`,
      detail: { ingested_at: ts, age_minutes: ageMin },
    };
  }
  return {
    ok: true,
    message: `Activity ingest ran ${ageMin.toFixed(1)}m ago — feed is current.`,
    detail: { ingested_at: ts, age_minutes: ageMin },
  };
}

async function checkOnchainListingsFreshness(
  supabase: any,
): Promise<CheckResult> {
  const { data, error } = await supabase
    .from("onchain_listings")
    .select("last_seen_at")
    .is("delisted_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(1);
  if (error) return { ok: false, message: "DB query failed", detail: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  const ts = row?.last_seen_at as string | undefined;
  if (!ts) return { ok: false, message: "onchain_listings has no active rows — ingest-onchain-listings may have never run" };
  const ageMs = Date.now() - new Date(ts).getTime();
  const ageMin = ageMs / 60_000;
  // Listings cron is every 2min. >15min = alert.
  if (ageMin > 15) {
    return {
      ok: false,
      message: `Last listings ingest was ${ageMin.toFixed(1)}m ago (${ts}). /onchain/marketplace is stale.`,
      detail: { last_seen_at: ts, age_minutes: ageMin },
    };
  }
  return {
    ok: true,
    message: `Listings ingest ran ${ageMin.toFixed(1)}m ago — marketplace is current.`,
    detail: { last_seen_at: ts, age_minutes: ageMin },
  };
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

  // ── Auth: require either CRON_SECRET header (scheduler) or admin JWT ──
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  let authorized = !!(cronSecret && providedSecret && providedSecret === cronSecret);
  if (!authorized) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: u } = await supabase.auth.getUser(token);
      if (u?.user) {
        const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
        authorized = !!isAdmin;
      }
    }
  }
  if (!authorized) {
    return new Response(
      JSON.stringify({ error: "Unauthorized — admin or cron secret required" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
    );
  }

  const apiKey = Deno.env.get("SCRYDEX_API_KEY") ?? "";
  const teamId = Deno.env.get("SCRYDEX_TEAM_ID") ?? "";
  const checkedAt = new Date().toISOString();

  const [freshness, coverage, liveCache, deltasComputed, newSets, sealedFreshness, scrydex, statsRpc, images, snapshotHistory, onchainActivity, onchainListings] = await Promise.all([
    checkPriceSnapshotFreshness(supabase),
    checkCardCoverage(supabase),
    checkLiveCacheFreshness(supabase),
    checkDeltasComputed(supabase),
    checkNewSets(),
    checkSealedFreshness(supabase),
    checkScrydexProxy(apiKey, teamId),
    checkCardStatsRpc(supabase),
    checkSampleImages(),
    loadSnapshotHistory(supabase, 14),
    checkOnchainActivityFreshness(supabase),
    checkOnchainListingsFreshness(supabase),
  ]);

  const dailyRun = checkDailyRun(snapshotHistory.last_daily);
  const fullRun  = checkFullRun(snapshotHistory.last_full);

  // Order matters here — this is the order they render on the admin page.
  // live_cache_freshness first ("is the site showing fresh data?"),
  // deltas_computed second ("will % change columns render?"),
  // new_sets third ("is the frontend missing any sets we have data for?"),
  // then the upstream pipeline detail.
  const checks = {
    live_cache_freshness: liveCache,
    deltas_computed: deltasComputed,
    new_sets: newSets,
    card_coverage: coverage,
    price_snapshot_freshness: freshness,
    sealed_freshness: sealedFreshness,
    daily_snapshot_run: dailyRun,
    full_snapshot_run: fullRun,
    onchain_activity_freshness: onchainActivity,
    onchain_listings_freshness: onchainListings,
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
