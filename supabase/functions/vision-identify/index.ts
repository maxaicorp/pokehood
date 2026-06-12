// vision-identify — Scrydex Vision proxy: identify a card (raw or graded slab)
// from a photo. Costs 5 Scrydex credits per call, so access is gated:
//   - ADMIN_ONLY=true (current): only admins may scan (testing phase).
//   - When opened to users: each user gets SCAN_LIMIT free scans (default 1),
//     counted via the vision_scans table. Admins are always unlimited.
//
// Accepts either:
//   - multipart/form-data with an `image` file (mobile camera flow), or
//   - JSON { image_url } for a publicly reachable image.
// Returns the raw Scrydex Vision response (analysis + matches[]).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Flip to false to open scanning to all signed-in users (limit still applies).
const ADMIN_ONLY = true;
const SCAN_LIMIT = Number(Deno.env.get("VISION_SCAN_LIMIT") ?? "1");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // ── Auth ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Authentication required" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: u, error: userError } = await supabase.auth.getUser(token);
  if (userError || !u?.user) return json({ error: "Invalid or expired token" }, 401);
  const userId = u.user.id;

  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });

  if (ADMIN_ONLY && !isAdmin) {
    return json({ error: "scan_not_available", message: "Card scanning is not available yet." }, 403);
  }

  // ── Free-scan limit (admins unlimited) ──
  if (!isAdmin) {
    const { count, error: countError } = await supabase
      .from("vision_scans")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if (countError) return json({ error: "limit check failed" }, 500);
    if ((count ?? 0) >= SCAN_LIMIT) {
      return json(
        { error: "scan_limit", message: `You've used your ${SCAN_LIMIT} free scan${SCAN_LIMIT === 1 ? "" : "s"}.`, limit: SCAN_LIMIT },
        429,
      );
    }
  }

  const apiKey = Deno.env.get("SCRYDEX_API_KEY") ?? "";
  const teamId = Deno.env.get("SCRYDEX_TEAM_ID") ?? "";
  if (!apiKey || !teamId) return json({ error: "Missing Scrydex credentials" }, 500);

  // ── Build the Scrydex request from whichever input we got ──
  const contentType = req.headers.get("content-type") ?? "";
  let scrydexInit: RequestInit;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const image = form.get("image");
      if (!(image instanceof File)) return json({ error: "image file required" }, 400);
      if (image.size > 20 * 1024 * 1024) return json({ error: "image too large (20MB max)" }, 400);

      const fwd = new FormData();
      fwd.append("image", image, image.name || "scan.jpg");
      fwd.append("games", "pokemon");
      scrydexInit = {
        method: "POST",
        headers: { "X-Api-Key": apiKey, "X-Team-ID": teamId },
        body: fwd,
      };
    } else {
      const body = await req.json().catch(() => null);
      const imageUrl = body?.image_url;
      if (typeof imageUrl !== "string" || !imageUrl.startsWith("http")) {
        return json({ error: "image_url or multipart image required" }, 400);
      }
      scrydexInit = {
        method: "POST",
        headers: {
          "X-Api-Key": apiKey,
          "X-Team-ID": teamId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image_url: imageUrl, games: ["pokemon"] }),
      };
    }
  } catch (e) {
    return json({ error: `bad request: ${(e as Error).message}` }, 400);
  }

  // ── Call Scrydex Vision ──
  const res = await fetch("https://api.scrydex.com/vision/v1/cards/identify", scrydexInit);
  const text = await res.text();
  if (!res.ok) {
    console.error("[vision-identify] scrydex error", res.status, text.slice(0, 500));
    return json({ error: "vision_failed", status: res.status }, 502);
  }

  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    return json({ error: "vision_bad_response" }, 502);
  }

  // ── Log the scan (counts toward the limit + audits credit spend) ──
  const top = payload?.data?.matches?.[0];
  const { error: logError } = await supabase.from("vision_scans").insert({
    user_id: userId,
    analysis: payload?.data?.analysis ?? null,
    matched_card_id: top?.card?.id ?? null,
    match_score: typeof top?.score === "number" ? top.score : null,
  });
  if (logError) console.error("[vision-identify] log insert failed:", logError.message);

  return json(payload);
});
