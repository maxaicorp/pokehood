import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

async function isAuthorized(req: Request, supabase: any): Promise<boolean> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  if (cronSecret && providedSecret === cronSecret) return true;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;

  const token = authHeader.replace("Bearer ", "");
  const { data: userData } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (!user) return false;

  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  return !!isAdmin;
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

  if (!(await isAuthorized(req, supabase))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 401,
    });
  }

  let body: { signalDate?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const args = body.signalDate ? { p_signal_date: body.signalDate } : {};
  const { data, error } = await supabase.rpc("generate_marketing_content_signals", args);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  return new Response(JSON.stringify({ generated: Number(data ?? 0) }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});
