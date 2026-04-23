/**
 * game-card-match-start
 *
 * Always returns HTTP 200 with { ok: true, ... } or { ok: false, error: "..." }.
 * Lovable's runtime tends to swallow non-2xx response bodies and substitute a
 * generic "Unknown error" placeholder, which makes 500s impossible to debug.
 * The 200-with-envelope pattern guarantees our diagnostic message reaches the
 * client.
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

function ok(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, ...payload }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(error: string, extra: Record<string, unknown> = {}): Response {
  // Always 200 so the response body reaches the client.
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
    if (!user.email_confirmed_at) {
      return fail("Please verify your email to play.");
    }

    const game = "card-match";

    // DELETE prior active sessions instead of UPDATE — eliminates any
    // read-your-writes race against the unique partial index when we insert.
    const { error: delErr } = await supabase
      .from("game_sessions")
      .delete()
      .eq("user_id", user.id)
      .eq("game", game)
      .eq("status", "active");
    if (delErr) return fail(`Delete prior actives: ${describeError(delErr)}`);

    const { data: pool, error: poolErr } = await supabase
      .from("game_card_pool")
      .select("card_id, name, image_small");
    if (poolErr) return fail(`Read pool: ${describeError(poolErr)}`);
    const localPool = (pool ?? []).filter(
      (entry) => typeof entry.image_small === "string" && entry.image_small.startsWith("/data/card-pool/"),
    );
    if (localPool.length < PAIRS) {
      return fail(`Local card pool too small (${localPool.length}); seed game_card_pool first`);
    }

    // image_small in game_card_pool is already a local path served by the
    // frontend (/data/card-pool/{card_id}.png). Pass it through verbatim — no
    // storage indirection, no CDN fetch.
    const picked = shuffle([...localPool]).slice(0, PAIRS);

    const slots = shuffle(
      picked.flatMap((c) => [
        { card_id: c.card_id, name: c.name, image_small: c.image_small },
        { card_id: c.card_id, name: c.name, image_small: c.image_small },
      ]),
    );

    // Independently-shuffled list of just the unique image URLs. Sent to the
    // client so it can preload images before play starts. Safe because the
    // ordering conveys no information about slot positions.
    const imageUrls = shuffle(picked.map((c) => c.image_small));

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

    if (insertErr) {
      // Race: a concurrent start call won. Reuse its active session so the
      // client gets a usable session instead of a hard error.
      const code = (insertErr as { code?: string })?.code;
      if (code === "23505") {
        const { data: existing, error: reuseErr } = await supabase
          .from("game_sessions")
          .select("id, started_at, slots")
          .eq("user_id", user.id)
          .eq("game", game)
          .eq("status", "active")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (reuseErr || !existing) {
          return fail(`Insert session: ${describeError(insertErr)}`);
        }
        return ok({
          session_id: existing.id,
          started_at: existing.started_at,
          slots: SLOTS,
          slot_cards: existing.slots,
          image_urls: imageUrls,
          reused: true,
        });
      }
      return fail(`Insert session: ${describeError(insertErr)}`);
    }

    return ok({
      session_id: session.id,
      started_at: session.started_at,
      slots: SLOTS,
      slot_cards: slots,
      image_urls: imageUrls,
    });
  } catch (err) {
    const msg = describeError(err);
    console.error("game-card-match-start unhandled:", msg, err);
    return fail(msg);
  }
});
