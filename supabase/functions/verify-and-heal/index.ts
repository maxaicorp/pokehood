/**
 * verify-and-heal edge function — the self-correcting safety net.
 *
 * Runs daily at 08:00 UTC (after the 06:00–06:40 snapshot chunks + the 07:00
 * refresh). It reads the ONE pipeline contract (get_pipeline_completeness) and,
 * if the pipeline is incomplete, tries to fix it — cheapest action first —
 * within hard guardrails so it can never run away.
 *
 * Repair ladder (cheapest → most expensive):
 *   1. Always re-run the cache refresh first. It's FREE and fixes the most
 *      common failure (cache refreshed before snapshots settled = stale_cache).
 *   2. If coverage is still low (today's snapshot is genuinely incomplete),
 *      re-run ONLY the chunks that didn't finish today (read from
 *      snapshot_chunk_log) — the exact same {mode:"chunk"} the crons run, never
 *      a separate "full" sweep (that's the very pattern that times out). Bounded
 *      by the daily repair cap AND the credit reserve.
 *   3. If only the 24h-delta coverage is low while today's coverage is fine,
 *      that's a PAST-day data gap. Re-running today can't fix it and backfill
 *      costs real credits, so we FLAG it for a human — never auto-spend.
 *
 * The five guardrails (see inline):
 *   (1) idempotent writes — snapshot upserts on (card_id,recorded_at), so a
 *       repair only fills gaps, never duplicates.
 *   (2) retry cap + credit reserve — bounded credit spend per day.
 *   (3) a run lock — never overlaps another heal run.
 *   (4) refresh gated on the contract — repair is the reward for completeness.
 *   (5) never auto-backfill history — flag, don't spend.
 *
 * Every run writes a pipeline_heal_log row so "is the self-heal working?" is a
 * query, not a guess.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const FUNCTION_VERSION = "2026-06-01-heal-v2-chunk";

// ── Guardrail constants (tune in one place) ──────────────────────────────────
const MAX_REPAIRS_PER_DAY = 2;     // (2) at most 2 credit-spending repairs/day
const MIN_CREDITS_RESERVE = 1000;  // (2) never spend if Scrydex balance is below this
const RUN_LOCK_WINDOW_MIN = 15;    // (3) treat a <15-min-old 'running' row as a held lock

// The canonical chunk plan — MUST mirror the six snapshot-chunk-* crons
// (startPage / pageLimit). The heal re-runs these SAME chunks, only the ones
// that didn't finish today. If you change a cron's range, change it here too.
const CHUNK_PLAN: Array<{ startPage: number; pageLimit: number }> = [
  { startPage: 1,   pageLimit: 50 },
  { startPage: 51,  pageLimit: 50 },
  { startPage: 101, pageLimit: 50 },
  { startPage: 151, pageLimit: 50 },
  { startPage: 201, pageLimit: 50 },
  { startPage: 251, pageLimit: 50 },
];

// Same-run verification: after re-dispatching short chunks, poll the contract a
// few times so a fixable gap closes within THIS run instead of waiting a day.
const HEAL_POLL_TRIES = 6;
const HEAL_POLL_INTERVAL_MS = 15_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Contract {
  pass: boolean;
  coverage_pct: number;
  delta_pct: number;
  failures: string[];
  cache_is_today: boolean;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function getContract(supabase: any): Promise<Contract | null> {
  const { data, error } = await supabase.rpc("get_pipeline_completeness");
  if (error || !data) return null;
  return data as Contract;
}

async function getCredits(apiKey: string, teamId: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://api.scrydex.com/account/v1/usage", {
      headers: { "X-Api-Key": apiKey, "X-Team-ID": teamId },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const d = await res.json();
    const c = d?.data?.credits_remaining;
    return typeof c === "number" ? c : null;
  } catch { return null; }
}

async function runRefresh(supabase: any): Promise<void> {
  // Both caches. Free, idempotent, safe to run anytime.
  try { await supabase.rpc("refresh_latest_card_prices"); } catch (e) { console.error("[heal] raw refresh threw", e); }
  try { await supabase.rpc("refresh_latest_graded_prices"); } catch (e) { console.error("[heal] graded refresh threw", e); }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // ── Auth: CRON_SECRET header (scheduler) or admin JWT ──
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
  if (!authorized) return json({ error: "Unauthorized — admin or cron secret required" }, 401);

  const apiKey = Deno.env.get("SCRYDEX_API_KEY") ?? "";
  const teamId = Deno.env.get("SCRYDEX_TEAM_ID") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

  // All heal logic runs in the background so the caller's (pg_net) timeout can
  // never kill it mid-repair — the same lesson that broke the snapshot chunks.
  const work = (async () => {
    let lockRowId: string | null = null;
    try {
      // ── Guardrail (3): run lock. A durable, pooled-connection-safe lock via
      // the log table (session advisory locks don't survive pgBouncer). If a
      // 'running' row was written in the last RUN_LOCK_WINDOW_MIN, another heal
      // is in flight — stand down.
      const { data: running } = await supabase
        .from("pipeline_heal_log")
        .select("id")
        .eq("result", "running")
        .gte("ran_at", new Date(Date.now() - RUN_LOCK_WINDOW_MIN * 60_000).toISOString())
        .limit(1);
      if (running && running.length > 0) {
        await supabase.from("pipeline_heal_log").insert({ result: "skipped_locked", notes: "another heal run is in flight" });
        console.log(`[heal] skipped — lock held. ${FUNCTION_VERSION}`);
        return;
      }
      // Claim the lock by writing a 'running' marker we update at the end.
      const { data: claim } = await supabase
        .from("pipeline_heal_log")
        .insert({ result: "running", notes: FUNCTION_VERSION })
        .select("id")
        .single();
      lockRowId = claim?.id ?? null;

      // ── Read the contract ──
      const before = await getContract(supabase);
      if (!before) {
        await finish(supabase, lockRowId, { result: "error", notes: "get_pipeline_completeness returned nothing" });
        return;
      }

      // Already complete → nothing to do.
      if (before.pass) {
        await finish(supabase, lockRowId, {
          result: "pass_noop",
          trigger_failures: [],
          coverage_pct_before: before.coverage_pct, coverage_pct_after: before.coverage_pct,
          delta_pct_before: before.delta_pct, delta_pct_after: before.delta_pct,
          notes: "contract already passing",
        });
        console.log(`[heal] pass — noop. ${FUNCTION_VERSION}`);
        return;
      }

      const actions: string[] = [];

      // ── Step 1: ALWAYS refresh first (free). Fixes stale_cache and any case
      // where the cache simply lagged the snapshots (the most common failure).
      await runRefresh(supabase);
      actions.push("refresh");
      const afterRefresh = await getContract(supabase);

      if (afterRefresh?.pass) {
        await finish(supabase, lockRowId, {
          result: "healed", actions, trigger_failures: before.failures,
          coverage_pct_before: before.coverage_pct, coverage_pct_after: afterRefresh.coverage_pct,
          delta_pct_before: before.delta_pct, delta_pct_after: afterRefresh.delta_pct,
          notes: "healed by cache refresh (was stale)",
        });
        console.log(`[heal] healed by refresh. ${FUNCTION_VERSION}`);
        return;
      }

      const state = afterRefresh ?? before;

      // ── Guardrail (5): a delta-only gap (coverage fine, deltas low) is a
      // PAST-day data hole. Re-running today can't fix it, and backfilling costs
      // real credits — so FLAG it, never auto-spend. It self-heals once a few
      // consecutive days of full coverage accumulate.
      const coverageLow = state.failures.includes("low_coverage");
      const deltaOnly = !coverageLow && state.failures.includes("low_delta_coverage");
      if (deltaOnly) {
        await finish(supabase, lockRowId, {
          result: "flagged_history_gap", actions, trigger_failures: state.failures,
          coverage_pct_before: before.coverage_pct, coverage_pct_after: state.coverage_pct,
          delta_pct_before: before.delta_pct, delta_pct_after: state.delta_pct,
          notes: `delta coverage ${state.delta_pct}% but today's coverage is fine — missing PRIOR-day snapshots. Self-heals as coverage accumulates; backfill only on human decision.`,
        });
        console.log(`[heal] flagged history gap (no auto-spend). ${FUNCTION_VERSION}`);
        return;
      }

      // ── Step 2: current complete-source coverage is missing/stale/low →
      // re-run ONLY the chunks that didn't finish today — the exact same
      // {mode:"chunk"} the crons run. Bounded by the cap + the credit reserve.
      const sourceNeedsResnapshot = coverageLow
        || state.failures.includes("source_stale")
        || state.failures.includes("no_complete_snapshot")
        || state.failures.includes("low_live_catalog");
      if (sourceNeedsResnapshot) {
        // Guardrail (2): retry cap.
        const { data: attempts } = await supabase.rpc("heal_repair_attempts_today");
        if ((attempts ?? 0) >= MAX_REPAIRS_PER_DAY) {
          await finish(supabase, lockRowId, {
            result: "skipped_budget", actions, trigger_failures: state.failures,
            coverage_pct_before: before.coverage_pct, coverage_pct_after: state.coverage_pct,
            delta_pct_before: before.delta_pct, delta_pct_after: state.delta_pct,
            notes: `repair cap reached (${attempts}/${MAX_REPAIRS_PER_DAY} today) — not re-running chunks again`,
          });
          console.warn(`[heal] repair cap reached. ${FUNCTION_VERSION}`);
          return;
        }

        // Which chunks finished cleanly today? Anything in CHUNK_PLAN without a
        // complete=true row for today is "short" — this catches both a hard
        // page failure (logged complete=false) and a chunk killed before it
        // could log anything (no row at all).
        const todayDate = new Date().toISOString().slice(0, 10);
        const { data: doneRows } = await supabase
          .from("snapshot_chunk_log")
          .select("start_page")
          .eq("recorded_date", todayDate)
          .eq("complete", true);
        const donePages = new Set((doneRows ?? []).map((r: any) => r.start_page));
        const shortChunks = CHUNK_PLAN.filter((c) => !donePages.has(c.startPage));

        if (shortChunks.length === 0) {
          // Every planned chunk reports complete, yet source coverage is still
          // failing — the plan likely no longer reaches far enough (catalog
          // grew) or the source feed produced too few NM prices. Don't guess and
          // spend; flag for a human to extend CHUNK_PLAN + the crons.
          await finish(supabase, lockRowId, {
            result: "still_failing", actions, trigger_failures: state.failures,
            coverage_pct_before: before.coverage_pct, coverage_pct_after: state.coverage_pct,
            delta_pct_before: before.delta_pct, delta_pct_after: state.delta_pct,
            notes: `coverage ${state.coverage_pct}% but all ${CHUNK_PLAN.length} chunks report complete — CHUNK_PLAN/crons may need more pages (catalog grew). Needs human.`,
          });
          console.warn(`[heal] all chunks complete but coverage low — plan too short. ${FUNCTION_VERSION}`);
          return;
        }

        // Guardrail (2): credit reserve. Estimate ≈ sum of short chunks' pages
        // (~1 credit/page). Keep both an absolute floor and the run estimate.
        const estCost = shortChunks.reduce((s, c) => s + c.pageLimit, 0);
        const credits = await getCredits(apiKey, teamId);
        if (credits != null && credits < Math.max(MIN_CREDITS_RESERVE, estCost)) {
          await finish(supabase, lockRowId, {
            result: "skipped_budget", actions, trigger_failures: state.failures,
            credits_before: credits,
            coverage_pct_before: before.coverage_pct, coverage_pct_after: state.coverage_pct,
            delta_pct_before: before.delta_pct, delta_pct_after: state.delta_pct,
            notes: `credits ${credits} < reserve ${MIN_CREDITS_RESERVE} (est ${estCost} for ${shortChunks.length} chunk(s)) — refusing to spend`,
          });
          console.warn(`[heal] below credit reserve. ${FUNCTION_VERSION}`);
          return;
        }

        // Guardrail (1): idempotent repair. Re-dispatch ONLY the short chunks.
        // Upsert on (card_id,recorded_at) means re-running just fills gaps —
        // never duplicates, so it can't contaminate the data.
        actions.push("resnapshot_chunks");
        let triggered = 0;
        for (const c of shortChunks) {
          try {
            const res = await fetch(`${supabaseUrl}/functions/v1/snapshot-prices`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret ?? "" },
              body: JSON.stringify({ mode: "chunk", startPage: c.startPage, pageLimit: c.pageLimit }),
            });
            if (res.ok || res.status === 202) triggered++;
          } catch (e) {
            console.error(`[heal] failed to trigger chunk@${c.startPage}`, e);
          }
          await sleep(500); // gentle spacing between dispatches
        }

        // Same-run verification: re-run chunks write to price_snapshots in their
        // own background, so coverage climbs as they go. Poll the contract;
        // once coverage recovers, refresh the cache + re-check so the result is
        // truthful THIS run (the cap stops it ever looping).
        let latest = state;
        for (let i = 0; i < HEAL_POLL_TRIES; i++) {
          await sleep(HEAL_POLL_INTERVAL_MS);
          const c = await getContract(supabase);
          if (c) latest = c;
          if (!latest.failures.includes("low_coverage")) break;
        }
        await runRefresh(supabase);
        const finalC = (await getContract(supabase)) ?? latest;
        const creditsAfter = await getCredits(apiKey, teamId);

        await finish(supabase, lockRowId, {
          result: finalC.pass ? "healed" : "partial",
          actions, trigger_failures: state.failures,
          credits_before: credits ?? undefined, credits_after: creditsAfter ?? undefined,
          credits_used: credits != null && creditsAfter != null ? credits - creditsAfter : undefined,
          coverage_pct_before: before.coverage_pct, coverage_pct_after: finalC.coverage_pct,
          delta_pct_before: before.delta_pct, delta_pct_after: finalC.delta_pct,
          notes: `re-ran ${triggered}/${shortChunks.length} short chunk(s) [${shortChunks.map((c) => c.startPage).join(",")}]; coverage ${before.coverage_pct}%→${finalC.coverage_pct}%.`,
        });
        console.log(`[heal] re-ran ${triggered} chunks; pass=${finalC.pass}. ${FUNCTION_VERSION}`);
        return;
      }

      // Some other failure we don't auto-repair (e.g. stale_cache that survived
      // a refresh — a deeper problem). Record it for a human.
      await finish(supabase, lockRowId, {
        result: "still_failing", actions, trigger_failures: state.failures,
        coverage_pct_before: before.coverage_pct, coverage_pct_after: state.coverage_pct,
        delta_pct_before: before.delta_pct, delta_pct_after: state.delta_pct,
        notes: `unhandled failure after refresh: ${state.failures.join(",")}`,
      });
      console.warn(`[heal] still failing after refresh: ${state.failures.join(",")}. ${FUNCTION_VERSION}`);
    } catch (e) {
      console.error("[heal] background error", e);
      if (lockRowId) {
        await finish(supabase, lockRowId, { result: "error", notes: String(e) }).catch(() => {});
      }
    }
  })();

  // @ts-ignore — EdgeRuntime is available in the Supabase Edge runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  } else {
    work.catch((e) => console.error("[heal] background error", e));
  }

  return json({ success: true, note: "verify-and-heal running in background — see pipeline_heal_log for the result.", version: FUNCTION_VERSION }, 202);
});

// Update the 'running' lock row in place with the final outcome (so it both
// records the result AND releases the lock — a 'running' row only counts as a
// lock for RUN_LOCK_WINDOW_MIN, and updating it off 'running' frees it now).
async function finish(
  supabase: any,
  lockRowId: string | null,
  fields: Record<string, unknown>,
): Promise<void> {
  if (!lockRowId) {
    // No lock row (shouldn't happen) — still record the outcome.
    await supabase.from("pipeline_heal_log").insert({ ...fields, ran_at: new Date().toISOString() });
    return;
  }
  await supabase.from("pipeline_heal_log").update(fields).eq("id", lockRowId);
}
