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

// Modern sets collapse to one bare card_id (no ::variant suffix), but early
// vintage sets (base1–6, gym1/2, neo1–4) keep separate ::variant rows in
// price_snapshots, exactly like snapshot-prices does. So when parsing history
// we emit one entry per (date, variant) and let the caller decide how to map
// that to row keys.
const EARLY_VARIANT_SET_IDS = new Set([
  "base1","base2","base3","base4","base5","base6","gym1","gym2","neo1","neo2","neo3","neo4",
]);
const MODERN_PRIORITY = ["holofoil","reverseHolofoil","normal","unlimitedHolofoil","firstEditionHolofoil"];

function isEarlyVariantSet(cardId: string): boolean {
  const setId = cardId.split("-").slice(0, -1).join("-");
  return EARLY_VARIANT_SET_IDS.has(setId);
}

// Returns Array<{ date, variant, price }> — variant === "normal" means the
// caller writes to the bare card_id with no ::suffix.
function parsePointsByVariant(cardId: string, data: any): Array<{ date: string; variant: string; price: number }> {
  const arr: any[] = data?.data ?? data?.prices ?? data?.history ?? [];
  const out: Array<{ date: string; variant: string; price: number }> = [];
  const early = isEarlyVariantSet(cardId);
  for (const e of Array.isArray(arr) ? arr : []) {
    const rawDate = e?.date ?? e?.recorded_at ?? e?.day ?? e?.timestamp ?? null;
    if (!rawDate) continue;
    const date = String(rawDate).slice(0, 10).replace(/\//g, "-");

    const prices: any[] = Array.isArray(e?.prices) ? e.prices : [];
    if (prices.length) {
      // Keep raw NM (preferred), fall back to raw any-condition.
      const raws = prices.filter((p) => p?.type === "raw" && typeof p?.market === "number" && p.market > 0);
      const nm = raws.filter((p) => p?.condition === "NM");
      const pool = nm.length ? nm : raws;
      if (!pool.length) continue;

      if (early) {
        // Early set: one row per variant, deduped to highest market per variant.
        const byVar = new Map<string, number>();
        for (const p of pool) {
          const v = typeof p?.variant === "string" && p.variant ? p.variant : "normal";
          byVar.set(v, Math.max(byVar.get(v) ?? 0, p.market as number));
        }
        for (const [variant, price] of byVar) out.push({ date, variant, price });
      } else {
        // Modern: one row with the canonical price (priority list, else max).
        const chosen =
          MODERN_PRIORITY.map((p) => pool.find((x) => x.variant === p)).find(Boolean) ??
          pool.reduce((a, b) => ((b.market as number) > (a.market as number) ? b : a));
        out.push({ date, variant: "normal", price: chosen.market as number });
      }
    } else {
      const flat = typeof e?.market === "number" ? e.market : (typeof e?.price === "number" ? e.price : null);
      if (flat != null && flat > 0) out.push({ date, variant: "normal", price: flat });
    }
  }
  return out;
}

// Legacy alias for the test-mode response shape.
function parsePoints(data: any): Array<{ date: string; price: number }> {
  const byDay = new Map<string, number>();
  for (const p of parsePointsByVariant("modern-placeholder-x", data)) {
    byDay.set(p.date, Math.max(byDay.get(p.date) ?? 0, p.price));
  }
  return [...byDay.entries()].map(([date, price]) => ({ date, price })).sort((a, b) => a.date.localeCompare(b.date));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

  // Auth: CRON_SECRET header (scheduler) or admin JWT (manual one-off runs).
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  let authorized = !!(cronSecret && providedSecret && providedSecret === cronSecret);
  if (!authorized) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: u } = await supabase.auth.getUser(token);
      if (u?.user) {
        const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
        authorized = !!isAdmin;
      }
    }
  }
  if (!authorized) return json({ error: "unauthorized — admin or cron secret required" }, 401);

  const apiKey = Deno.env.get("SCRYDEX_API_KEY") ?? "";
  const teamId = Deno.env.get("SCRYDEX_TEAM_ID") ?? "";
  if (!apiKey || !teamId) return json({ error: "Missing Scrydex credentials" }, 500);
  const sh = { "X-Api-Key": apiKey, "X-Team-ID": teamId };

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
    // Dedupe to bare card ids; the Scrydex price_history endpoint returns
    // ALL variants for a card in one call, so we never want to call it twice
    // for the same base id.
    cardIds = [...new Set(cardIds.map((id) => id.split("::")[0]))];
    if (!cardIds.length) return json({ error: "no card_ids resolved (pass card_ids[] or scope set:/top:)" }, 400);

    const onlyIfDiff = body.onlyIfDiff === true;
    const diffPct = Number(body.diffPct) > 0 ? Number(body.diffPct) : 1;
    const idsForResponse = cardIds.slice();

    // Run the long work in the background so an HTTP client timeout (or a
    // pg_net 60s cap) can never kill it mid-run. Returns 202 immediately;
    // poll price_snapshots / latest_card_prices for actual progress.
    const work = async () => {
      // name/set lookup for the SnapshotRow required columns. Map both bare
      // and ::variant ids → bare meta so we can label per-variant rows too.
      const baseMeta = new Map<string, { name: string; set: string }>();
      for (let i = 0; i < cardIds.length; i += 500) {
        const { data } = await supabase.from("latest_card_prices").select("card_id, card_name, set_name").in("card_id", cardIds.slice(i, i + 500));
        for (const r of (data ?? []) as any[]) baseMeta.set(r.card_id, { name: r.card_name, set: r.set_name });
      }

      const creditsBefore = await getCredits(sh);
      const rows: Array<{ card_id: string; card_name: string; set_name: string; price: number; recorded_at: string }> = [];
      let okCards = 0, failCards = 0, points = 0;
      const failures: string[] = [];

      for (const bareId of cardIds) {
        const res = await fetchHistory(bareId, days, sh);
        if (!res.ok) { failCards++; if (failures.length < 20) failures.push(`${bareId}:${res.status}`); continue; }
        const m = baseMeta.get(bareId) ?? { name: bareId, set: "" };
        const pts = parsePointsByVariant(bareId, res.data);
        if (!pts.length) { failCards++; continue; }
        okCards++;
        for (const p of pts) {
          const rowCardId = p.variant === "normal" ? bareId : `${bareId}::${p.variant}`;
          rows.push({ card_id: rowCardId, card_name: m.name, set_name: m.set, price: p.price, recorded_at: p.date });
          points++;
        }
        await new Promise((r) => setTimeout(r, 120));
      }

      // Compare-and-correct mode: only write rows that differ from existing
      // by more than diffPct, so we don't churn snapshots that are already right.
      let toWrite = rows;
      let corrected = 0;
      const corrections: string[] = [];
      if (onlyIfDiff && rows.length) {
        const minDate = rows.reduce((m, r) => (r.recorded_at < m ? r.recorded_at : m), rows[0].recorded_at);
        const existing = new Map<string, number>();
        const ids = [...new Set(rows.map((r) => r.card_id))];
        for (let i = 0; i < ids.length; i += 200) {
          const { data } = await supabase
            .from("price_snapshots")
            .select("card_id, recorded_at, price")
            .in("card_id", ids.slice(i, i + 200))
            .gte("recorded_at", minDate);
          for (const r of (data ?? []) as any[]) existing.set(`${r.card_id}|${r.recorded_at}`, Number(r.price));
        }
        toWrite = rows.filter((r) => {
          const prev = existing.get(`${r.card_id}|${r.recorded_at}`);
          if (prev == null) return true;
          const pctDelta = (Math.abs(prev - r.price) / Math.max(r.price, 0.01)) * 100;
          const changed = pctDelta > diffPct;
          if (changed && corrections.length < 25) corrections.push(`${r.card_id}@${r.recorded_at}: ${prev}→${r.price}`);
          return changed;
        });
        corrected = toWrite.length;
      }

      let upserted = 0;
      for (let i = 0; i < toWrite.length; i += 500) {
        const { error } = await supabase.from("price_snapshots").upsert(toWrite.slice(i, i + 500), { onConflict: "card_id,recorded_at" });
        if (!error) upserted += toWrite.slice(i, i + 500).length;
      }

      let refreshed: number | null = null;
      if (upserted > 0) {
        try { const { data } = await supabase.rpc("refresh_latest_card_prices"); refreshed = (data as number) ?? null; } catch { /* ignore */ }
      }
      const creditsAfter = await getCredits(sh);
      console.log("[backfill-price-history done]", JSON.stringify({
        cards_requested: cardIds.length, cards_ok: okCards, cards_failed: failCards,
        points_fetched: points, points_corrected: onlyIfDiff ? corrected : upserted,
        points_written: upserted, refreshed_rows: refreshed,
        credits_used: creditsBefore != null && creditsAfter != null ? creditsBefore - creditsAfter : "unknown",
        sample_failures: failures, sample_corrections: corrections,
      }));
    };

    // Background it via EdgeRuntime.waitUntil so the runtime keeps the
    // function alive after we send the 202. Falls back to fire-and-forget if
    // the API isn't present.
    try { (globalThis as any).EdgeRuntime?.waitUntil?.(work()); }
    catch { void work(); }
    if (!(globalThis as any).EdgeRuntime?.waitUntil) void work();

    return json({
      mode: "backfill", started: true, onlyIfDiff,
      cards_requested: idsForResponse.length,
      note: "running in background — poll latest_card_prices / function logs for completion",
    }, 202);
  }

  return json({ error: "pass { test: cardId } or { mode: 'backfill', ... }" }, 400);
});
