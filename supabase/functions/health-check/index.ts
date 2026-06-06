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

// "Is the sealed CATALOG keeping up with sealed PRICES?" The 2026-04→05 outage:
// snapshot-sealed kept writing prices daily, but the product catalog (which the
// Sealed tab renders) came from a manual static-JSON script that silently died,
// so new sets (Chaos Rising / me4) were priced in the DB but invisible. This
// diffs the set of recently-priced sealed product IDs against the sealed_products
// catalog table and flags any priced product missing from the catalog — which is
// exactly the gap that went unnoticed for 7 weeks.
async function checkSealedCatalogFreshness(
  supabase: any,
): Promise<CheckResult> {
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const cutoff = twoDaysAgo.toISOString().split("T")[0];

  // 1. Recently-priced sealed product ids (strip the "sealed-" prefix) + set name.
  const pricedSets = new Map<string, string>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("price_snapshots")
      .select("card_id, set_name")
      .like("card_id", "sealed-%")
      .gte("recorded_at", cutoff)
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, message: "price_snapshots query failed", detail: error.message };
    const rows = (data ?? []) as { card_id: string; set_name: string }[];
    for (const r of rows) pricedSets.set(r.card_id.replace(/^sealed-/, ""), r.set_name);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  if (pricedSets.size === 0) {
    return { ok: true, message: "No recent sealed prices to compare against." };
  }

  // 2. Catalog ids.
  const catalogIds = new Set<string>();
  from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("sealed_products")
      .select("id")
      .range(from, from + PAGE - 1);
    if (error) {
      return {
        ok: false,
        message: "sealed_products catalog table missing or unreadable — run migration 20260528120000 + snapshot-sealed.",
        detail: error.message,
      };
    }
    const rows = (data ?? []) as { id: string }[];
    for (const r of rows) catalogIds.add(r.id);
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  // 3. Diff: priced-but-not-in-catalog, grouped by set.
  const missingBySet = new Map<string, number>();
  for (const [id, setName] of pricedSets) {
    if (!catalogIds.has(id)) {
      missingBySet.set(setName, (missingBySet.get(setName) ?? 0) + 1);
    }
  }
  const missingTotal = [...missingBySet.values()].reduce((a, b) => a + b, 0);
  if (missingTotal === 0) {
    return {
      ok: true,
      message: `Catalog covers all ${pricedSets.size} priced sealed products (${catalogIds.size} in catalog).`,
      detail: { priced: pricedSets.size, catalog: catalogIds.size },
    };
  }
  const names = [...missingBySet.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s, n]) => `${s} (${n})`)
    .join(", ");
  return {
    ok: false,
    message: `${missingTotal} priced sealed product(s) missing from the catalog across ${missingBySet.size} set(s): ${names}${missingBySet.size > 3 ? `, +${missingBySet.size - 3} more` : ""}. Run snapshot-sealed { force: true } to repopulate.`,
    detail: { missing_total: missingTotal, by_set: Object.fromEntries(missingBySet) },
  };
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

// "Do SEALED products have their 1d deltas?" Mirror of checkDeltasComputed but
// for sealed-% rows. checkDeltasComputed explicitly EXCLUDES sealed, so sealed
// deltas were a blind spot — the exact bug where the Sealed tab showed "—" for
// every 1d/7d change while every other check stayed green. Goes red if a large
// fraction of sealed rows lack price_1d (0% = the read path is broken again).
async function checkSealedDeltasComputed(
  supabase: any,
): Promise<CheckResult> {
  const { count: total, error: e1 } = await supabase
    .from("latest_card_prices")
    .select("card_id", { count: "exact", head: true })
    .like("card_id", "sealed-%");
  if (e1) return { ok: false, message: "DB query failed", detail: e1.message };

  const { count: withDeltas, error: e2 } = await supabase
    .from("latest_card_prices")
    .select("card_id", { count: "exact", head: true })
    .like("card_id", "sealed-%")
    .not("price_1d", "is", null);
  if (e2) return { ok: false, message: "DB query failed", detail: e2.message };

  const t = total ?? 0;
  const w = withDeltas ?? 0;
  const pct = t > 0 ? (w / t) * 100 : 0;
  const detail = { total: t, with_deltas: w, pct };
  if (t === 0) return { ok: false, message: "No sealed rows in latest_card_prices — sealed prices aren't reaching the read cache." };
  if (pct < 50) return {
    ok: false,
    message: `Only ${pct.toFixed(0)}% of sealed products have 1d deltas (${w}/${t}). Sealed tab will show "—" for most % change columns.`,
    detail,
  };
  return {
    ok: true,
    message: `${pct.toFixed(0)}% of sealed products have 1d deltas (${w}/${t}).`,
    detail,
  };
}

// "Does the REAL read path actually return priced data?" Every other check
// inspects a stage in isolation (snapshot ran? deltas computed?). This one
// exercises the exact accessors the frontend uses end-to-end and asserts a
// user-visible value comes back. It would have caught BOTH recent bugs — the
// sealed-excluding RPC and the empty sealed price map — on day one, because
// those passed all the stage-level checks while the page rendered nothing.
async function checkEndToEndReadProbe(
  supabase: any,
): Promise<CheckResult> {
  // Card path: the homepage list reads get_latest_price_page. Ask for the top
  // few by price and assert they come back with a real price.
  const { data: cardRows, error: cardErr } = await supabase.rpc("get_latest_price_page", {
    p_limit: 5,
    p_offset: 0,
    p_set_ids: null,
    p_sort_dir: "desc",
    p_include_sealed: false,
  });
  if (cardErr) return { ok: false, message: "get_latest_price_page RPC failed — Market card list is broken", detail: cardErr.message };
  const cards = (cardRows ?? []) as Array<{ card_id: string; price: number | null }>;
  const cardOk = cards.length > 0 && cards.every((r) => r.price != null && Number(r.price) > 0);
  if (!cardOk) {
    return {
      ok: false,
      message: `Card read path returned ${cards.length} rows but not all are priced — Market would render blank/—.`,
      detail: cards,
    };
  }

  // Sealed path: the Sealed tab reads sealed-% rows from latest_card_prices.
  const { data: sealedRows, error: sealedErr } = await supabase
    .from("latest_card_prices")
    .select("card_id, price, price_1d")
    .like("card_id", "sealed-%")
    .order("price", { ascending: false })
    .limit(5);
  if (sealedErr) return { ok: false, message: "Sealed read path query failed", detail: sealedErr.message };
  const sealed = (sealedRows ?? []) as Array<{ card_id: string; price: number | null }>;
  const sealedOk = sealed.length > 0 && sealed.every((r) => r.price != null && Number(r.price) > 0);
  if (!sealedOk) {
    return {
      ok: false,
      message: `Sealed read path returned ${sealed.length} rows but not all are priced — Sealed tab would render blank/—.`,
      detail: sealed,
    };
  }

  return {
    ok: true,
    message: `Both read paths return priced data (top card $${Number(cards[0].price).toFixed(2)}, top sealed $${Number(sealed[0].price).toFixed(2)}).`,
    detail: { sample_card: cards[0], sample_sealed: sealed[0] },
  };
}

// THE headline check: is the price pipeline actually COMPLETE, by the single
// shared contract (get_pipeline_completeness SQL fn)? It verifies the live read
// cache is built from the latest complete priced snapshot window, has deltas,
// and contains no stale carry-forward rows from older/fallback pricing runs.
async function checkPipelineCompleteness(
  supabase: any,
): Promise<CheckResult> {
  const { data, error } = await supabase.rpc("get_pipeline_completeness");
  if (error) {
    return { ok: false, message: "get_pipeline_completeness RPC failed — run migration 20260601060000", detail: error.message };
  }
  const r = data as {
    pass: boolean; coverage_pct: number; delta_pct: number;
    today_coverage?: number; source_coverage?: number; catalog: number; cache_age_hours: number | null;
    source_snapshot_date?: string | null; source_age_days?: number | null; cache_is_today?: boolean; failures: string[];
    thresholds: { coverage_pct_min: number; delta_pct_min: number; cache_age_hours_max: number; source_age_days_max?: number; live_catalog_min?: number };
  };
  const t = r.thresholds;
  const sourceCoverage = r.source_coverage ?? r.today_coverage ?? 0;
  const sourceDate = r.source_snapshot_date ?? "unknown date";
  if (r.pass) {
    return {
      ok: true,
      message: `Pipeline COMPLETE — live cache matches latest complete snapshot (${sourceDate}: ${sourceCoverage.toLocaleString()}/${r.catalog.toLocaleString()} rows fresh), ${r.delta_pct}% have 24h deltas.`,
      detail: r,
    };
  }
  // Translate the machine failure codes into a human "what's broken + the bar it missed".
  const reasons: string[] = [];
  if (r.failures?.includes("low_coverage"))
    reasons.push(`only ${r.coverage_pct}% of live cache rows come from the latest complete snapshot window (need ${t.coverage_pct_min}%) — stale rows are being carried forward`);
  if (r.failures?.includes("low_live_catalog"))
    reasons.push(`only ${r.catalog.toLocaleString()} live priced cards (need ${t.live_catalog_min?.toLocaleString?.() ?? "the full-run floor"}) — read cache is too small`);
  if (r.failures?.includes("no_complete_snapshot"))
    reasons.push("no complete priced snapshot window exists yet");
  if (r.failures?.includes("source_stale"))
    reasons.push(`latest complete snapshot is ${r.source_age_days} days old (${sourceDate})`);
  if (r.failures?.includes("low_delta_coverage"))
    reasons.push(`only ${r.delta_pct}% of cards have a 24h delta (need ${t.delta_pct_min}%) — prior-day snapshots are missing`);
  if (r.failures?.includes("stale_cache"))
    reasons.push(`cache is ${r.cache_age_hours}h old or was refreshed before the latest complete snapshot — run refresh_latest_card_prices()`);
  return {
    ok: false,
    message: `Pipeline INCOMPLETE: ${reasons.join("; ")}.`,
    detail: r,
  };
}

// Onchain subsystem contract — mirror of pipeline_completeness, for the
// /onchain feeds. Goes red on a stalled ingest (stale activity/listings) OR a
// sanity-guard trip (a sale priced like a parse bug, or a price_info shape the
// renderer doesn't handle — the $90k-bug class). See get_onchain_health SQL fn.
async function checkOnchainHealth(supabase: any): Promise<CheckResult> {
  const { data, error } = await supabase.rpc("get_onchain_health");
  if (error) return { ok: false, message: "get_onchain_health RPC failed — run migration 20260601100000", detail: error.message };
  const r = data as {
    pass: boolean; failures: string[];
    activity_age_hours: number | null; listing_age_hours: number | null;
    listings_me: number; listings_cc: number;
    insane_price_count: number; unknown_shape_count: number;
  };
  if (r.pass) {
    return {
      ok: true,
      message: `Onchain healthy — activity ${r.activity_age_hours ?? "?"}h old, ${(r.listings_me + r.listings_cc).toLocaleString()} listings, prices sane.`,
      detail: r,
    };
  }
  const reasons: string[] = [];
  if (r.failures?.includes("activity_stale")) reasons.push(`activity ${r.activity_age_hours}h stale — activity ingest may be down`);
  if (r.failures?.includes("listings_stale")) reasons.push(`listings ${r.listing_age_hours}h stale — listing ingest may be down`);
  if (r.failures?.includes("listings_empty")) reasons.push(`no active listings`);
  if (r.failures?.includes("insane_price")) reasons.push(`${r.insane_price_count} sale(s) priced like a parse bug (>$100k) — LOGIC BUG, needs a human`);
  if (r.failures?.includes("unknown_price_shape")) reasons.push(`${r.unknown_shape_count} row(s) with an unrecognized price_info shape — renderer will mis-price them, needs a human`);
  return { ok: false, message: `Onchain UNHEALTHY: ${reasons.join("; ")}.`, detail: r };
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

// "Are graded prices being snapshotted?" The CardDetail tile row reads from
// latest_graded_prices. Empty or stale = tiles will all show "—". Cheap to
// answer: count distinct cards with at least one graded row, and check the
// newest snapshot date.
async function checkGradedPricesFreshness(
  supabase: any,
): Promise<CheckResult> {
  const { data, error } = await supabase
    .from("latest_graded_prices")
    .select("updated_at, card_id")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) return { ok: false, message: "DB query failed", detail: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  const ts = row?.updated_at as string | undefined;
  if (!ts) {
    return {
      ok: false,
      message: "latest_graded_prices is empty — snapshot-prices hasn't written graded data yet. Run snapshot once and check again.",
    };
  }
  const ageMs = Date.now() - new Date(ts).getTime();
  const ageHours = ageMs / 3_600_000;
  if (ageHours > 36) {
    return {
      ok: false,
      message: `Graded cache refreshed ${ageHours.toFixed(1)}h ago (${ts}). CardDetail graded tiles will be stale.`,
      detail: { updated_at: ts, age_hours: ageHours },
    };
  }
  return {
    ok: true,
    message: `Graded cache refreshed ${ageHours < 1 ? `${Math.round(ageMs / 60_000)}m` : `${ageHours.toFixed(1)}h`} ago — CardDetail tiles current.`,
    detail: { updated_at: ts, age_hours: ageHours },
  };
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

  const [completeness, onchainHealth, freshness, coverage, liveCache, deltasComputed, sealedDeltas, endToEnd, newSets, sealedFreshness, sealedCatalog, scrydex, statsRpc, images, snapshotHistory, onchainActivity, onchainListings, gradedFreshness] = await Promise.all([
    checkPipelineCompleteness(supabase),
    checkOnchainHealth(supabase),
    checkPriceSnapshotFreshness(supabase),
    checkCardCoverage(supabase),
    checkLiveCacheFreshness(supabase),
    checkDeltasComputed(supabase),
    checkSealedDeltasComputed(supabase),
    checkEndToEndReadProbe(supabase),
    checkNewSets(),
    checkSealedFreshness(supabase),
    checkSealedCatalogFreshness(supabase),
    checkScrydexProxy(apiKey, teamId),
    checkCardStatsRpc(supabase),
    checkSampleImages(),
    loadSnapshotHistory(supabase, 14),
    checkOnchainActivityFreshness(supabase),
    checkOnchainListingsFreshness(supabase),
    checkGradedPricesFreshness(supabase),
  ]);

  const dailyRun = checkDailyRun(snapshotHistory.last_daily);
  const fullRun  = checkFullRun(snapshotHistory.last_full);

  // Order matters here — this is the order they render on the admin page.
  // live_cache_freshness first ("is the site showing fresh data?"),
  // deltas_computed second ("will % change columns render?"),
  // new_sets third ("is the frontend missing any sets we have data for?"),
  // then the upstream pipeline detail.
  const checks = {
    pipeline_completeness: completeness,
    onchain_health: onchainHealth,
    end_to_end_read: endToEnd,
    live_cache_freshness: liveCache,
    deltas_computed: deltasComputed,
    sealed_deltas_computed: sealedDeltas,
    new_sets: newSets,
    card_coverage: coverage,
    price_snapshot_freshness: freshness,
    sealed_freshness: sealedFreshness,
    sealed_catalog_freshness: sealedCatalog,
    daily_snapshot_run: dailyRun,
    full_snapshot_run: fullRun,
    onchain_activity_freshness: onchainActivity,
    onchain_listings_freshness: onchainListings,
    graded_prices_freshness: gradedFreshness,
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
