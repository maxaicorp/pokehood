import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Only allow Pokemon card/expansion endpoints — block admin, billing, etc.
const ALLOWED_PREFIXES = ["/pokemon/v1/en/"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Auth check: require a valid Supabase JWT ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "Authentication required" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const token = authHeader.replace("Bearer ", "");
  const { error: userError } = await supabase.auth.getUser(token);
  if (userError) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
    );
  }

  const apiKey = Deno.env.get("SCRYDEX_API_KEY") ?? "";
  const teamId = Deno.env.get("SCRYDEX_TEAM_ID") ?? "";

  if (!apiKey || !teamId) {
    return new Response(
      JSON.stringify({ error: "Missing Scrydex credentials" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const endpoint: string = body.endpoint ?? "/pokemon/v1/en/sealed?pageSize=20&include=prices&orderBy=-expansion.release_date";

    // ── Endpoint whitelist: only allow known-safe prefixes ──
    if (!ALLOWED_PREFIXES.some((prefix) => endpoint.startsWith(prefix))) {
      return new Response(
        JSON.stringify({ error: "Endpoint not allowed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
      );
    }

    const url = `https://api.scrydex.com${endpoint}`;
    const res = await fetch(url, {
      headers: { "X-Api-Key": apiKey, "X-Team-ID": teamId },
    });

    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }

    return new Response(JSON.stringify({ status: res.status, data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
