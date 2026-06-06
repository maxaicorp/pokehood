// scrydex-webhook — OBSERVER MODE.
//
// Phase 1 of the webhook pipeline (see docs/SCRYDEX_WEBHOOK_PLAN.md): catch every
// Scrydex webhook delivery and LOG it to webhook_events_log. It verifies the
// HMAC signature (so we learn whether our secret is right) but DELIBERATELY does
// NOT touch price_snapshots / latest_card_prices. The goal is to measure cadence,
// payload size, and which events fire BEFORE rebuilding the pipeline. Always
// returns 200 fast so Scrydex doesn't retry/back off during observation.
//
// Env: SCRYDEX_WEBHOOK_SECRET (the whsec_… signing secret from the Scrydex
//      dashboard), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-scrydex-signature",
};

// Constant-time hex string compare.
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(secret: string, header: string | null, rawBody: string):
  Promise<{ valid: boolean; reason: string }> {
  if (!secret) return { valid: false, reason: "no secret configured" };
  if (!header) return { valid: false, reason: "missing X-Scrydex-Signature" };
  // Format: t=<unix>,v1=<hex>
  const parts: Record<string, string> = {};
  for (const kv of header.split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const t = parts["t"], v1 = parts["v1"];
  if (!t || !v1) return { valid: false, reason: "bad header format" };

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  if (!safeEqualHex(hex, v1)) return { valid: false, reason: "signature mismatch" };
  const skew = Math.abs(Date.now() / 1000 - Number(t));
  if (!(skew <= 300)) return { valid: false, reason: `stale timestamp (${Math.round(skew)}s)` };
  return { valid: true, reason: "ok" };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("ok", { status: 200, headers: corsHeaders });

  // RAW body first — required for signature verification (never re-stringify).
  const raw = await req.text();
  const secret = Deno.env.get("SCRYDEX_WEBHOOK_SECRET") ?? "";
  const sig = await verifySignature(secret, req.headers.get("x-scrydex-signature"), raw);

  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
  const eventName: string | null = parsed?.name ?? null;
  const expansionIds: unknown = parsed?.data?.expansion_ids ?? null;
  const expansionCount = Array.isArray(expansionIds) ? expansionIds.length : null;

  // Log it (service role bypasses RLS). Best-effort — never block the 200.
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    await supabase.from("webhook_events_log").insert({
      source: "scrydex",
      event_name: eventName,
      expansion_count: expansionCount,
      expansion_ids: Array.isArray(expansionIds) ? expansionIds : null,
      sig_valid: sig.valid,
      sig_reason: sig.reason,
      raw: parsed ?? { unparsed: raw.slice(0, 2000) },
    });
  } catch (e) {
    console.error("webhook log insert failed:", (e as Error).message);
  }

  console.log("[scrydex-webhook] received:", JSON.stringify({
    event: eventName, expansions: expansionCount, sig_valid: sig.valid, reason: sig.reason,
  }));

  // OBSERVER: always 200 so Scrydex doesn't retry/back off while we collect data.
  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
