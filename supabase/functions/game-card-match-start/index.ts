/**
 * game-card-match-start
 *
 * Creates a new Card Match session for the authenticated user.
 * - Requires confirmed email
 * - Expires any prior 'active' session for this user+game
 * - Picks 10 random cards from game_card_pool, duplicates + shuffles to 20 slots
 * - Returns session_id + slot count (NEVER returns card info — flips reveal)
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAIRS = 10;
const SLOTS = PAIRS * 2;

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
    if (!user.email_confirmed_at) {
      return new Response(
        JSON.stringify({ error: "Please verify your email to play." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const game = "card-match";

    // Expire any prior active sessions for this user+game (must succeed —
    // otherwise the unique partial index will reject the new insert).
    const { error: expireErr } = await supabase
      .from("game_sessions")
      .update({ status: "expired" })
      .eq("user_id", user.id)
      .eq("game", game)
      .eq("status", "active");
    if (expireErr) throw expireErr;

    // Pick 10 random cards from the pool
    const { data: pool, error: poolErr } = await supabase
      .from("game_card_pool")
      .select("card_id, name, image_small");
    if (poolErr) throw poolErr;
    if (!pool || pool.length < PAIRS) {
      throw new Error(`Card pool too small (${pool?.length ?? 0}); seed game_card_pool first`);
    }

    const picked = shuffle([...pool]).slice(0, PAIRS);

    // Duplicate + shuffle into 20 slots
    const slots = shuffle(
      picked.flatMap((c) => [
        { card_id: c.card_id, name: c.name, image_small: c.image_small },
        { card_id: c.card_id, name: c.name, image_small: c.image_small },
      ]),
    );

    const { data: session, error: insertErr } = await supabase
      .from("game_sessions")
      .insert({
        user_id: user.id,
        game,
        slots,
        status: "active",
      })
      .select("id, started_at")
      .single();
    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({
        session_id: session.id,
        started_at: session.started_at,
        slots: SLOTS,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = describeError(err);
    console.error("game-card-match-start error:", msg, err);
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
