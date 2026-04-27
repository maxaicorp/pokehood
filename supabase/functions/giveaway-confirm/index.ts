/**
 * giveaway-confirm edge function
 *
 * Public endpoint hit from the email confirmation link
 * (/giveaway/confirm?token=...). Looks up the entry by token, flips status
 * to 'confirmed' if it's currently 'pending', and returns a small JSON
 * payload describing what happened so the landing page can render the
 * right state.
 *
 * Tokens never expire — once an entry is confirmed, it stays confirmed.
 * Re-clicking the link is a no-op (returns already_confirmed=true).
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Accept token from POST body or GET ?token=
  let token: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      token = String(body?.token ?? "").trim();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
  } else if (req.method === "GET") {
    const url = new URL(req.url);
    token = url.searchParams.get("token")?.trim() ?? null;
  } else {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!token) return json({ error: "Missing token" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { data: entry, error } = await supabase
    .from("giveaway_entries")
    .select("id, status, giveaway_id, full_name")
    .eq("confirmation_token", token)
    .maybeSingle();

  if (error) {
    console.error("[giveaway-confirm] lookup failed:", error);
    return json({ error: "Lookup failed" }, 500);
  }
  if (!entry) return json({ error: "Invalid or expired link" }, 404);

  if (entry.status === "confirmed") {
    return json({ ok: true, already_confirmed: true, full_name: entry.full_name });
  }
  if (entry.status === "rejected") {
    return json({ error: "This entry was rejected" }, 410);
  }

  const { error: upErr } = await supabase
    .from("giveaway_entries")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", entry.id);

  if (upErr) {
    console.error("[giveaway-confirm] update failed:", upErr);
    return json({ error: "Could not confirm" }, 500);
  }

  return json({ ok: true, already_confirmed: false, full_name: entry.full_name });
});
