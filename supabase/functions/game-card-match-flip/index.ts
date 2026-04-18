/**
 * game-card-match-flip
 *
 * Records one click on a slot. Server owns:
 *   - which card lives in which slot
 *   - the pending flip (1st of a pair)
 *   - timing, score, completion
 *
 * Body: { session_id: string, slot_index: number }
 *
 * Returns:
 *   { slot, card, match?: boolean, otherSlot?, otherCard?, completed?: { score, duration_ms, wrong_flips } }
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

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError) throw new Error(`Auth error: ${userError.message}`);
    const user = userData.user;
    if (!user) throw new Error("Not authenticated");

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.session_id ?? "");
    const slotIndex = Number(body.slot_index);
    if (!sessionId || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SLOT_COUNT) {
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load session
    const { data: session, error: loadErr } = await supabase
      .from("game_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (session.status !== "active") {
      return new Response(JSON.stringify({ error: "Session not active" }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const startedAt = new Date(session.started_at);
    const elapsedMs = now.getTime() - startedAt.getTime();
    if (elapsedMs > SESSION_MAX_DURATION_MS) {
      await supabase.from("game_sessions").update({ status: "expired" }).eq("id", sessionId);
      return new Response(JSON.stringify({ error: "Session expired" }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate slot is clickable
    const matched: number[] = session.matched_slots ?? [];
    if (matched.includes(slotIndex)) {
      return new Response(JSON.stringify({ error: "Slot already matched" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (session.pending_flip === slotIndex) {
      return new Response(JSON.stringify({ error: "Slot already showing" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit
    if (session.last_flip_at) {
      const since = now.getTime() - new Date(session.last_flip_at).getTime();
      if (since < MIN_FLIP_INTERVAL_MS) {
        return new Response(JSON.stringify({ error: "Too fast" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const slots: Slot[] = session.slots;
    const card = slots[slotIndex];

    // Branch: first or second flip of the pair?
    if (session.pending_flip === null || session.pending_flip === undefined) {
      // First flip — set pending
      const { error: upErr } = await supabase
        .from("game_sessions")
        .update({
          pending_flip: slotIndex,
          flips_count: session.flips_count + 1,
          last_flip_at: now.toISOString(),
        })
        .eq("id", sessionId);
      if (upErr) throw upErr;

      return new Response(
        JSON.stringify({ slot: slotIndex, card }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Second flip — check match
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
      if (upErr) throw upErr;

      return new Response(
        JSON.stringify({
          slot: slotIndex,
          card,
          match: true,
          otherSlot: pendingSlot,
          otherCard: pendingCard,
          completed,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // No match — increment wrong_flips, clear pending
    const { error: upErr } = await supabase
      .from("game_sessions")
      .update({
        pending_flip: null,
        flips_count: session.flips_count + 1,
        wrong_flips: session.wrong_flips + 1,
        last_flip_at: now.toISOString(),
      })
      .eq("id", sessionId);
    if (upErr) throw upErr;

    return new Response(
      JSON.stringify({
        slot: slotIndex,
        card,
        match: false,
        otherSlot: pendingSlot,
        otherCard: pendingCard,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = describeError(err);
    console.error("game-card-match-flip error:", msg, err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: string; code?: string; details?: string; hint?: string };
    const parts = [
      e.code ? `[${e.code}]` : null,
      e.message ?? null,
      e.details ?? null,
      e.hint ? `(hint: ${e.hint})` : null,
    ].filter(Boolean);
    if (parts.length) return parts.join(" ");
    try { return JSON.stringify(err); } catch { /* fall through */ }
  }
  return "Unknown error";
}
