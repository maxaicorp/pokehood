/**
 * heal-onchain — self-correcting safety net for the onchain subsystem.
 *
 * Mirrors verify-and-heal (prices), but for the onchain feeds. Reads the
 * get_onchain_health contract and, if something's wrong, acts by KIND:
 *   • recoverable (activity_stale / listings_stale / listings_empty) → an
 *     ingest cron has stalled; re-trigger the relevant ingest(s). Bounded by a
 *     daily cap. No Scrydex credits involved (these ingests use Helius/ME).
 *   • logic/data bug (insane_price / unknown_price_shape) → re-running an ingest
 *     can't fix wrong math or an unhandled price shape. FLAG it for a human;
 *     never auto-act. (This is the $90k-bug class — caught loudly, not silently.)
 *
 * Every run logs a pipeline_heal_log row tagged subsystem='onchain', so prices
 * and onchain share one audit trail and one admin board.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const FUNCTION_VERSION = "2026-06-01-heal-onchain-v1";
const SUBSYSTEM = "onchain";

const MAX_REPAIRS_PER_DAY = 3;   // ingests are cheap (no Scrydex spend); allow a few
const RUN_LOCK_WINDOW_MIN = 10;
const HEAL_POLL_TRIES = 6;
const HEAL_POLL_INTERVAL_MS = 15_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Recoverable-by-reingest failures → which ingest functions to re-trigger.
const INGEST_FOR_FAILURE: Record<string, string[]> = {
  activity_stale:  ["ingest-onchain-activity", "ingest-cc-native"],
  listings_stale:  ["ingest-onchain-listings", "ingest-cc-marketplace"],
  listings_empty:  ["ingest-onchain-listings", "ingest-cc-marketplace"],
};
const RECOVERABLE = new Set(Object.keys(INGEST_FOR_FAILURE));

interface Health {
  pass: boolean;
  failures: string[];
  activity_age_hours: number | null;
  listing_age_hours: number | null;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function getHealth(supabase: any): Promise<Health | null> {
  const { data, error } = await supabase.rpc("get_onchain_health");
  if (error || !data) return null;
  return data as Health;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Auth: CRON_SECRET header or admin JWT.
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

  const work = (async () => {
    let lockRowId: string | null = null;
    try {
      // Run lock (per-subsystem): a <RUN_LOCK_WINDOW_MIN-old 'running' onchain
      // row means another heal-onchain is in flight.
      const { data: running } = await supabase
        .from("pipeline_heal_log")
        .select("id")
        .eq("subsystem", SUBSYSTEM)
        .eq("result", "running")
        .gte("ran_at", new Date(Date.now() - RUN_LOCK_WINDOW_MIN * 60_000).toISOString())
        .limit(1);
      if (running && running.length > 0) {
        await supabase.from("pipeline_heal_log").insert({ subsystem: SUBSYSTEM, result: "skipped_locked", notes: "another heal-onchain run is in flight" });
        return;
      }
      const { data: claim } = await supabase
        .from("pipeline_heal_log")
        .insert({ subsystem: SUBSYSTEM, result: "running", notes: FUNCTION_VERSION })
        .select("id")
        .single();
      lockRowId = claim?.id ?? null;

      const before = await getHealth(supabase);
      if (!before) {
        await finish(supabase, lockRowId, { result: "error", notes: "get_onchain_health returned nothing" });
        return;
      }
      if (before.pass) {
        await finish(supabase, lockRowId, { result: "pass_noop", trigger_failures: [], notes: "onchain health passing" });
        return;
      }

      const failures = before.failures ?? [];
      const recoverable = failures.filter((f) => RECOVERABLE.has(f));
      const logicBugs = failures.filter((f) => !RECOVERABLE.has(f));

      // Only logic bugs (insane_price / unknown_price_shape) → flag, never act.
      if (recoverable.length === 0) {
        await finish(supabase, lockRowId, {
          result: "flagged_logic_bug", trigger_failures: failures,
          notes: `onchain logic/data bug — needs a human, not a re-ingest: ${logicBugs.join(", ")}`,
        });
        return;
      }

      // Retry cap (per-subsystem).
      const { data: attempts } = await supabase.rpc("heal_attempts_today", { p_subsystem: SUBSYSTEM, p_action: "reingest" });
      if ((attempts ?? 0) >= MAX_REPAIRS_PER_DAY) {
        await finish(supabase, lockRowId, {
          result: "skipped_budget", trigger_failures: failures,
          notes: `reingest cap reached (${attempts}/${MAX_REPAIRS_PER_DAY} today)`,
        });
        return;
      }

      // Re-trigger the ingest(s) responsible for the recoverable failures.
      const fns = new Set<string>();
      for (const f of recoverable) for (const fn of INGEST_FOR_FAILURE[f]) fns.add(fn);
      const actions = ["reingest"];
      let triggered = 0;
      for (const fn of fns) {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-cron-secret": cronSecret ?? "" },
            body: "{}",
          });
          if (res.ok || res.status === 202) triggered++;
        } catch (e) {
          console.error(`[heal-onchain] failed to trigger ${fn}`, e);
        }
        await sleep(500);
      }

      // Same-run verification: ingests write as they go; poll the contract a few
      // times, then record the outcome.
      let latest = before;
      for (let i = 0; i < HEAL_POLL_TRIES; i++) {
        await sleep(HEAL_POLL_INTERVAL_MS);
        const h = await getHealth(supabase);
        if (h) latest = h;
        // stop once the recoverable failures clear (logic bugs may persist)
        if (!latest.failures.some((f) => RECOVERABLE.has(f))) break;
      }

      const stillRecoverable = latest.failures.filter((f) => RECOVERABLE.has(f));
      const note =
        `re-triggered ${triggered}/${fns.size} ingest(s) [${[...fns].join(",")}] for [${recoverable.join(",")}]; ` +
        `${stillRecoverable.length === 0 ? "recovered" : `still: ${stillRecoverable.join(",")}`}` +
        (logicBugs.length ? `. Also FLAGGED logic bug(s): ${logicBugs.join(",")}` : "");
      await finish(supabase, lockRowId, {
        result: latest.pass ? "healed" : (stillRecoverable.length === 0 ? "partial" : "still_failing"),
        actions, trigger_failures: failures, notes: note,
      });
    } catch (e) {
      console.error("[heal-onchain] background error", e);
      if (lockRowId) await finish(supabase, lockRowId, { result: "error", notes: String(e) }).catch(() => {});
    }
  })();

  // @ts-ignore — EdgeRuntime is available in the Supabase Edge runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  } else {
    work.catch((e) => console.error("[heal-onchain] background error", e));
  }

  return json({ success: true, subsystem: SUBSYSTEM, note: "heal-onchain running in background — see pipeline_heal_log.", version: FUNCTION_VERSION }, 202);
});

// Update the 'running' lock row in place with the final outcome (records result
// + releases the lock). subsystem is already set on the row.
async function finish(supabase: any, lockRowId: string | null, fields: Record<string, unknown>): Promise<void> {
  if (!lockRowId) {
    await supabase.from("pipeline_heal_log").insert({ subsystem: SUBSYSTEM, ...fields, ran_at: new Date().toISOString() });
    return;
  }
  await supabase.from("pipeline_heal_log").update(fields).eq("id", lockRowId);
}
