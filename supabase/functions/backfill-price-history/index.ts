// backfill-price-history — pulls REAL historical prices from Scrydex's
// per-card price_history endpoint and writes them into price_snapshots, so we
// can retroactively fix the gappy snapshot history (and the wrong 7d/30d
// deltas it caused) instead of waiting weeks for the chunked pipeline to refill.
//
// Scrydex price_history costs ~3 credits/card, so this is opt-in + scoped.
//
// Modes (POST JSON, header x-cron-secret):
//   { "test": "sv8pt5-156", "days": 35 }
//       → one card. Reports exact credits used (usage before/after) + the raw
//         response so we can confirm the shape (and whether graded is included)
//         BEFORE spending on a bulk run. Writes nothing.
//   { "mode": "backfill", "card_ids": ["sv8pt5-156", ...], "days": 35 }
//   { "mode": "backfill", "scope": "set:sv8pt5", "days": 35 }
//   { "mode": "backfill", "scope": "top:2000", "days": 35 }
//       → fetch history per card, upsert daily market points into
//         price_snapshots (idempotent on card_id,recorded_at), then refresh.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
};
const SCRYDEX = "https://api.scrydex.com";
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function getCredits(h: Record<string, string>): Promise<number | null> {
  try {
    const r = await fetch(`${SCRYDEX}/account/v1/usage`, { headers: h });
    if (!r.ok) return null;
    const d = await r.json();
    const c = d?.data?.credits_remaining;
    return typeof c === "number" ? c : null;
  } catch { return null; }
}

// Scrydex doc path is /{game}/v1/cards/{id}/price_history; the exact Pokémon
// locale segment isn't certain, so try a couple and report which worked.
async function fetchHistory(cardId: string, days: number, h: Record<string, string>) {
  const candidates = [
    `${SCRYDEX}/pokemon/v1/cards/${encodeURIComponent(cardId)}/price_history?days=${days}`,
    `${SCRYDEX}/pokemon/v1/en/cards/${encodeURIComponent(cardId)}/price_history?days=${days}`,
  ];
  const attempts: Array<{ url: string; status: number }> = [];
  for (const url of candidates) {
    const r = await fetch(url, { headers: h });
    attempts.push({ url, status: r.status });
    if (r.ok) {
      const text = await r.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 1000) }; }
      return { ok: true, url, status: r.status, data, attempts };
    }
  }
  return { ok: false, url: candidates[0], status: attempts.at(-1)?.status ?? 0, data: null, attempts };
}

// Defensive parse — collapse the response to one market price per day. Field
// names are confirmed via the test before any bulk run.
function parsePoints(data: any): Array<{ date: string; price: number }> {
  const arr: any[] = data?.data ?? data?.prices ?? data?.history ?? [];
  const byDay = new Map<string, number>();
  for (const e of Array.isArray(arr) ? arr : []) {
    const rawDate = e?.date ?? e?.recorded_at ?? e?.day ?? e?.timestamp ?? null;
    const price = typeof e?.market === "number" ? e.market : (typeof e?.price === "number" ? e.price : null);
    if (!rawDate || price == null || price <= 0) continue;
    const date = String(rawDate).slice(0, 10);
    byDay.set(date, Math.max(byDay.get(date) ?? 0, price)); // chase variant = highest market
  }
  return [...byDay.entries()].map(([date, price]) => ({ date, price })).sort((a, b) => a.date.localeCompare(b.date));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.headers.get("x-cron-secret") !== (Deno.env.get("CRON_SECRET") ?? "")) return json({ error: "unauthorized" }, 401);

  const apiKey = Deno.env.get("SCRYDEX_API_KEY") ?? "";
  const teamId = Deno.env.get("SCRYDEX_TEAM_ID") ?? "";
  if (!apiKey || !teamId) return json({ error: "Missing Scrydex credentials" }, 500);
  const sh = { "X-Api-Key": apiKey, "X-Team-ID": teamId };

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  const days = Math.min(Math.max(Number(body.days) || 35, 2), 365);

  // ── TEST: one card, no writes, exact credit cost + raw shape ──
  if (body.test) {
    const before = await getCredits(sh);
    const res = await fetchHistory(String(body.test), days, sh);
    const after = await getCredits(sh);
    return json({
      mode: "test",
      card_id: body.test,
      endpoint_used: res.url,
      attempts: res.attempts,
      status: res.status,
      credits_before: before,
      credits_after: after,
      credits_used: before != null && after != null ? before - after : "unknown",
      parsed_points: res.ok ? parsePoints(res.data) : [],
      raw_response: res.data,
    });
  }

  // ── BACKFILL: scoped cards → upsert daily points → refresh ──
  if (body.mode === "backfill") {
    let cardIds: string[] = Array.isArray(body.card_ids) ? body.card_ids.filter((x: unknown) => typeof x === "string") : [];
    const scope: string = typeof body.scope === "string" ? body.scope : "";
    if (!cardIds.length && scope.startsWith("set:")) {
      const setId = scope.slice(4);
      const { data } = await supabase.from("latest_card_prices").select("card_id").like("card_id", `${setId}-%`);
      cardIds = (data ?? []).map((r: any) => r.card_id);
    } else if (!cardIds.length && scope.startsWith("top:")) {
      const n = Math.min(Number(scope.slice(4)) || 0, 5000);
      const { data } = await supabase.from("latest_card_prices").select("card_id").not("card_id", "like", "sealed-%").order("price", { ascending: false }).limit(n);
      cardIds = (data ?? []).map((r: any) => r.card_id);
    }
    cardIds = [...new Set(cardIds.map((id) => id.split("::")[0]))];
    if (!cardIds.length) return json({ error: "no card_ids resolved (pass card_ids[] or scope set:/top:)" }, 400);

    // name/set lookup for the SnapshotRow required columns
    const meta = new Map<string, { name: string; set: string }>();
    for (let i = 0; i < cardIds.length; i += 500) {
      const { data } = await supabase.from("latest_card_prices").select("card_id, card_name, set_name").in("card_id", cardIds.slice(i, i + 500));
      for (const r of (data ?? []) as any[]) meta.set(r.card_id, { name: r.card_name, set: r.set_name });
    }

    const creditsBefore = await getCredits(sh);
    const rows: Array<{ card_id: string; card_name: string; set_name: string; price: number; recorded_at: string }> = [];
    let okCards = 0, failCards = 0, points = 0;
    const failures: string[] = [];

    for (const cardId of cardIds) {
      const res = await fetchHistory(cardId, days, sh);
      if (!res.ok) { failCards++; if (failures.length < 20) failures.push(`${cardId}:${res.status}`); continue; }
      const m = meta.get(cardId) ?? { name: cardId, set: "" };
      const pts = parsePoints(res.data);
      if (!pts.length) { failCards++; continue; }
      okCards++;
      for (const p of pts) { rows.push({ card_id: cardId, card_name: m.name, set_name: m.set, price: p.price, recorded_at: p.date }); points++; }
      await new Promise((r) => setTimeout(r, 120)); // gentle pacing
    }

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("price_snapshots").upsert(rows.slice(i, i + 500), { onConflict: "card_id,recorded_at" });
      if (!error) upserted += rows.slice(i, i + 500).length;
    }

    let refreshed: number | null = null;
    try { const { data } = await supabase.rpc("refresh_latest_card_prices"); refreshed = (data as number) ?? null; } catch { /* ignore */ }
    const creditsAfter = await getCredits(sh);

    return json({
      mode: "backfill", cards_requested: cardIds.length, cards_ok: okCards, cards_failed: failCards,
      points_written: upserted, refreshed_rows: refreshed,
      credits_used: creditsBefore != null && creditsAfter != null ? creditsBefore - creditsAfter : "unknown",
      sample_failures: failures,
    });
  }

  return json({ error: "pass { test: cardId } or { mode: 'backfill', ... }" }, 400);
});
