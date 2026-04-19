/**
 * game-card-match-flip
 *
 * Always returns HTTP 200 with { ok: true, ... } or { ok: false, error: "..." }.
 * See start function for the rationale.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MIN_FLIP_INTERVAL_MS = 150;
const SESSION_MAX_DURATION_MS = 10 * 60 * 1000; // 10 min
const SLOT_COUNT = 20;
const TOTAL_PAIRS = 10;

interface Slot {
  card_id: string;
  name: string;
  image_small: string;
}

function ok(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, ...payload }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(error: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function describeError(err: unknown): string {
  try {
    if (err === null) return "thrown: null";
    if (err === undefined) return "thrown: undefined";
    const t = typeof err;
    if (t === "string" || t === "number" || t === "boolean") return `thrown ${t}: ${String(err)}`;
    if (err instanceof Error) {
      const name = err.name || "Error";
      const msg = err.message || "(no message)";
      return `${name}: ${msg}`;
    }
    if (t === "object") {
      const e = err as Record<string, unknown>;
      const parts: string[] = [];
      if (e.code) parts.push(`[${String(e.code)}]`);
      if (e.message) parts.push(String(e.message));
      if (e.details) parts.push(String(e.details));
      if (e.hint) parts.push(`(hint: ${String(e.hint)})`);
      if (e.status) parts.push(`status=${String(e.status)}`);
      if (parts.length) return parts.join(" ");
      const keys = Object.keys(e);
      if (keys.length) return `object with keys: ${keys.join(", ")}`;
      const ctor = (err as { constructor?: { name?: string } })?.constructor?.name;
      return ctor ? `empty ${ctor}` : "empty object";
    }
    return `thrown ${t}: ${String(err)}`;
  } catch {
    return "describeError failed";
  }
}

function computeScore(durationMs: number, wrongFlips: number): number {
  // Base 10,000. Time penalty: -100/sec. Miss penalty: -100 each.
  // Examples: 45s/0 misses = 9,550 · 90s/5 = 8,600 · 122s/15 = 7,280
  const raw = 10_000 - Math.floor(durationMs / 100) - wrongFlips * 100;
  return Math.max(0, raw);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError) return fail(`Auth: ${userError.message}`);
    const user = userData.user;
    if (!user) return fail("Not authenticated");

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.session_id ?? "");
    const slotIndex = Number(body.slot_index);
    if (!sessionId || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SLOT_COUNT) {
      return fail("Invalid input");
    }

    const { data: session, error: loadErr } = await supabase
      .from("game_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (loadErr) return fail(`Load session: ${describeError(loadErr)}`);
    if (!session) return fail("Session not found");
    if (session.status !== "active") return fail("Session not active");

    const now = new Date();
    const startedAt = new Date(session.started_at);
    const elapsedMs = now.getTime() - startedAt.getTime();
    if (elapsedMs > SESSION_MAX_DURATION_MS) {
      await supabase.from("game_sessions").update({ status: "expired" }).eq("id", sessionId);
      return fail("Session expired");
    }

    const matched: number[] = session.matched_slots ?? [];
    if (matched.includes(slotIndex)) return fail("Slot already matched");
    if (session.pending_flip === slotIndex) return fail("Slot already showing");

    if (session.last_flip_at) {
      const since = now.getTime() - new Date(session.last_flip_at).getTime();
      if (since < MIN_FLIP_INTERVAL_MS) return fail("Too fast");
    }

    const slots: Slot[] = session.slots;
    const card = slots[slotIndex];

    // Branch: first or second flip of the pair?
    if (session.pending_flip === null || session.pending_flip === undefined) {
      const { error: upErr } = await supabase
        .from("game_sessions")
        .update({
          pending_flip: slotIndex,
          flips_count: session.flips_count + 1,
          last_flip_at: now.toISOString(),
        })
        .eq("id", sessionId);
      if (upErr) return fail(`Update pending: ${describeError(upErr)}`);

      return ok({ slot: slotIndex, card });
    }

    const pendingSlot: number = session.pending_flip;
    const pendingCard = slots[pendingSlot];
    const isMatch = pendingCard.card_id === card.card_id;

    if (isMatch) {
      const newMatched = [...matched, pendingSlot, slotIndex];
      const isComplete = newMatched.length === TOTAL_PAIRS * 2;

      const update: Record<string, unknown> = {
        matched_slots: newMatched,
        pending_flip: null,
        flips_count: session.flips_count + 1,
        last_flip_at: now.toISOString(),
      };

      let completed: { score: number; duration_ms: number; wrong_flips: number } | undefined;
      if (isComplete) {
        const durationMs = now.getTime() - startedAt.getTime();
        const score = computeScore(durationMs, session.wrong_flips);
        update.status = "completed";
        update.completed_at = now.toISOString();
        update.score = score;
        update.period_key = now.toISOString().slice(0, 10);
        completed = {
          score,
          duration_ms: durationMs,
          wrong_flips: session.wrong_flips,
        };
      }

      const { error: upErr } = await supabase
        .from("game_sessions")
        .update(update)
        .eq("id", sessionId);
      if (upErr) return fail(`Update match: ${describeError(upErr)}`);

      return ok({
        slot: slotIndex,
        card,
        match: true,
        otherSlot: pendingSlot,
        otherCard: pendingCard,
        completed,
      });
    }

    // No match.
    const { error: upErr } = await supabase
      .from("game_sessions")
      .update({
        pending_flip: null,
        flips_count: session.flips_count + 1,
        wrong_flips: session.wrong_flips + 1,
        last_flip_at: now.toISOString(),
      })
      .eq("id", sessionId);
    if (upErr) return fail(`Update no-match: ${describeError(upErr)}`);

    return ok({
      slot: slotIndex,
      card,
      match: false,
      otherSlot: pendingSlot,
      otherCard: pendingCard,
    });
  } catch (err) {
    const msg = describeError(err);
    console.error("game-card-match-flip unhandled:", msg, err);
    return fail(msg);
  }
});
