/**
 * giveaway-submit edge function
 *
 * Public endpoint. Validates the form payload, upserts a pending entry into
 * giveaway_entries with a fresh confirmation token, and sends the user a
 * confirmation email. The entry is NOT eligible for the draw until they
 * click the link in that email and giveaway-confirm flips status='confirmed'.
 *
 * Returns 200 on success, 4xx for validation, 5xx for unexpected failures.
 *
 * The Resend integration is gated on RESEND_API_KEY being set in Supabase
 * secrets. If the key is missing, the row is still inserted (so we capture
 * the email/info) but no email is sent — caller gets a 200 with
 * `email_sent: false` so the UI can show a different message.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
  "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR",
  "PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
]);

interface SubmitBody {
  giveaway_id?: string;
  full_name?: string;
  email?: string;
  street_address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function generateToken(): string {
  // 32 hex chars = 128 bits of entropy. Plenty for one-time confirmation links.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function sendConfirmationEmail(opts: {
  to: string;
  fullName: string;
  giveawayTitle: string;
  confirmUrl: string;
  apiKey: string;
  fromAddress: string;
}): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: opts.fromAddress,
        to: opts.to,
        subject: `Confirm your entry — ${opts.giveawayTitle}`,
        html: `
          <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
            <h1 style="font-size:22px;margin:0 0 16px">Confirm your giveaway entry</h1>
            <p style="font-size:15px;line-height:1.55;margin:0 0 20px">Hi ${opts.fullName.split(" ")[0]}, thanks for entering <strong>${opts.giveawayTitle}</strong>. Click the button below to confirm your entry. We can&rsquo;t enter you in the draw until you do.</p>
            <p style="margin:0 0 28px"><a href="${opts.confirmUrl}" style="background:#0f172a;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Confirm my entry</a></p>
            <p style="font-size:13px;color:#64748b;margin:0">If you didn&rsquo;t enter this giveaway, you can ignore this email — no entry will be recorded.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0" />
            <p style="font-size:12px;color:#94a3b8;margin:0">If the button doesn&rsquo;t work, paste this URL into your browser:<br/><span style="word-break:break-all">${opts.confirmUrl}</span></p>
          </div>
        `,
      }),
    });
    if (!res.ok) {
      console.error("[giveaway-submit] Resend error:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("[giveaway-submit] Resend threw:", e);
    return false;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return bad("Method not allowed", 405);
  }

  let body: SubmitBody;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON");
  }

  // Validate
  const giveawayId = String(body.giveaway_id ?? "").trim();
  const fullName = String(body.full_name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const street = String(body.street_address ?? "").trim();
  const city = String(body.city ?? "").trim();
  const state = String(body.state ?? "").trim().toUpperCase();
  const zip = String(body.zip ?? "").trim();

  if (!giveawayId) return bad("giveaway_id required");
  if (fullName.length < 2 || fullName.length > 120) return bad("Please provide your full name");
  if (!isValidEmail(email)) return bad("Please provide a valid email address");
  if (street.length < 4) return bad("Street address required");
  if (city.length < 1) return bad("City required");
  if (!US_STATES.has(state)) return bad("Please pick a valid US state — we only ship within the United States");
  if (!/^\d{5}(-\d{4})?$/.test(zip)) return bad("Please provide a valid US ZIP code");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Confirm the giveaway is real and accepting entries
  const { data: giveaway, error: gErr } = await supabase
    .from("giveaways")
    .select("id, title, status, ends_at")
    .eq("id", giveawayId)
    .maybeSingle();

  if (gErr || !giveaway) return bad("Giveaway not found", 404);
  if (giveaway.status !== "active") return bad("This giveaway isn't accepting entries");
  if (new Date(giveaway.ends_at).getTime() < Date.now()) return bad("This giveaway has ended");

  const ipAddr = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  // Rate limit: max 5 entries per IP per hour across all giveaways. Skips when
  // the IP can't be determined (Supabase Edge always sets x-forwarded-for in
  // production, so this branch is only hit in local dev).
  if (ipAddr) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: rlErr } = await supabase
      .from("giveaway_entries")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ipAddr)
      .gte("created_at", oneHourAgo);
    if (!rlErr && (count ?? 0) >= 5) {
      return bad("Too many entries from your network. Try again in an hour.", 429);
    }
  } else {
    console.warn("[giveaway-submit] no IP — skipping rate limit");
  }

  // Optional: capture the signed-in user_id if a JWT was provided
  let userId: string | null = null;
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const { data: userRes } = await supabase.auth.getUser(auth.slice(7));
    userId = userRes?.user?.id ?? null;
  }

  const token = generateToken();

  // Upsert: re-submitting the same email before confirming generates a fresh
  // token (and a fresh email), but a row that's already 'confirmed' is locked.
  const { data: existing } = await supabase
    .from("giveaway_entries")
    .select("id, status")
    .eq("giveaway_id", giveawayId)
    .eq("email", email)
    .maybeSingle();

  if (existing?.status === "confirmed") {
    return bad("This email is already entered. Check your inbox for the original confirmation.", 409);
  }

  const row = {
    giveaway_id: giveawayId,
    user_id: userId,
    full_name: fullName,
    email,
    street_address: street,
    city,
    state,
    zip,
    country: "US",
    status: "pending" as const,
    confirmation_token: token,
    confirmation_sent_at: new Date().toISOString(),
    ip_address: ipAddr,
    user_agent: userAgent,
  };

  if (existing) {
    const { error: upErr } = await supabase
      .from("giveaway_entries")
      .update(row)
      .eq("id", existing.id);
    if (upErr) {
      console.error("[giveaway-submit] update failed:", upErr);
      return bad("Could not save your entry, please try again", 500);
    }
  } else {
    const { error: insErr } = await supabase.from("giveaway_entries").insert(row);
    if (insErr) {
      console.error("[giveaway-submit] insert failed:", insErr);
      return bad("Could not save your entry, please try again", 500);
    }
  }

  // Build confirmation URL from SITE_URL env var. We deliberately do NOT use
  // the request `origin` header — an attacker could send `origin: https://attacker.com`
  // to make the confirmation link point at their phishing domain.
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://collectiblez.app";
  const confirmUrl = `${siteUrl.replace(/\/$/, "")}/giveaway/confirm?token=${token}`;

  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const fromAddress = Deno.env.get("GIVEAWAY_FROM_ADDRESS") ?? "Collectiblez <noreply@collectiblez.com>";
  let emailSent = false;
  if (apiKey) {
    emailSent = await sendConfirmationEmail({
      to: email,
      fullName,
      giveawayTitle: giveaway.title,
      confirmUrl,
      apiKey,
      fromAddress,
    });
  } else {
    console.warn("[giveaway-submit] RESEND_API_KEY not set — entry saved but no email sent");
  }

  return new Response(
    JSON.stringify({
      ok: true,
      email_sent: emailSent,
      // Echo enough back that the UI can show a meaningful message
      message: emailSent
        ? "We sent a confirmation link to your email. Click it to finish entering."
        : "We saved your info, but the confirmation email could not be sent. Please contact support.",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});
