/**
 * snapshot-prices edge function — Scrydex edition
 *
 * Fetches current card prices from Scrydex and upserts into price_snapshots.
 *
 * Modes (pass in POST body):
 *   {}              → daily: newest 30 pages (~3,000 cards, 30 credits)
 *   { mode:"full" } → full:  all pages (~23,000 cards, ~235 credits) — run weekly
 *
 * Credit budget:
 *   Daily 30 pages × 30 days  = 900 credits/month
 *   Full  235 pages × 4 weeks = 940 credits/month
 *   Total ≈ 1,840 credits/month (well within 5,000 Starter limit)
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PAGE_SIZE = 100;
const DAILY_PAGE_LIMIT = 30; // ~3,000 most-recent cards
const DELAY_MS = 150;        // ~6-7 req/sec, well under 100/sec limit

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScrydexPrice {
  market: number;
  low: number;
  currency: string;
  condition: string;  // "NM" | "LP" | "MP" | "HP" | "DMG"
  type: string;       // "raw" | "graded" | etc.
}

interface ScrydexVariant {
  name: string;
  prices?: ScrydexPrice[];
}

interface ScrydexCard {
  id: string;
  name: string;
  expansion?: {
    id: string;
    name: string;
    series?: string;
    release_date?: string;
    language_code?: string;
    is_online_only?: boolean;
  };
  variants?: ScrydexVariant[];
}

interface SnapshotRow {
  card_id: string;
  card_name: string;
  set_name: string;
  price: number;
  recorded_at: string;
}

// ─── Price extraction ─────────────────────────────────────────────────────────

function extractCardPrice(card: ScrydexCard): number | null {
  const variants = card.variants ?? [];

  // 1. NM raw USD market (most accurate price for a near-mint ungraded card)
  for (const v of variants) {
    const p = (v.prices ?? []).find(
      (x) => x.condition === "NM" && x.type === "raw" && x.currency === "USD" && x.market > 0
    );
    if (p) return p.market;
  }

  // 2. NM raw any currency
  for (const v of variants) {
    const p = (v.prices ?? []).find(
      (x) => x.condition === "NM" && x.type === "raw" && x.market > 0
    );
    if (p) return p.market;
  }

  // 3. Any raw USD market (LP/MP/etc. fallback — only if no NM exists)
  for (const v of variants) {
    const p = (v.prices ?? []).find(
      (x) => x.type === "raw" && x.currency === "USD" && x.market > 0
    );
    if (p) return p.market;
  }

  // 4. Any raw market (last resort)
  for (const v of variants) {
    const p = (v.prices ?? []).find((x) => x.type === "raw" && x.market > 0);
    if (p) return p.market;
  }

  return null;
}

// ─── Scrydex fetch helper ─────────────────────────────────────────────────────

async function scrydexFetch(
  endpoint: string,
  apiKey: string,
  teamId: string,
): Promise<{ data: ScrydexCard[]; total_count: number } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(`https://api.scrydex.com${endpoint}`, {
      headers: { "X-Api-Key": apiKey, "X-Team-ID": teamId },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`Scrydex ${res.status} for ${endpoint}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error("Scrydex fetch error:", e);
    return null;
  }
}

// ─── Supabase upsert helper ───────────────────────────────────────────────────

async function flushRows(
  supabase: any,
  rows: SnapshotRow[],
): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  const { error } = await supabase
    .from("price_snapshots")
    .upsert(rows, { onConflict: "card_id,recorded_at" });
  if (error) {
    console.error("Upsert error:", error.message);
    return { inserted: 0, skipped: rows.length };
  }
  return { inserted: rows.length, skipped: 0 };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("SCRYDEX_API_KEY") ?? "";
  const teamId = Deno.env.get("SCRYDEX_TEAM_ID") ?? "";

  if (!apiKey || !teamId) {
    return new Response(
      JSON.stringify({ error: "Missing SCRYDEX_API_KEY or SCRYDEX_TEAM_ID env vars" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const mode: "daily" | "full" = body.mode === "full" ? "full" : "daily";
    const pageLimit = mode === "full" ? Infinity : DAILY_PAGE_LIMIT;
    const today = new Date().toISOString().split("T")[0];

    console.log(`snapshot-prices [${mode}] starting — ${today}`);

    let page = 1;
    let totalPages = 1;
    let totalInserted = 0;
    let totalSkipped = 0;
    const buffer: SnapshotRow[] = [];
    const seenIds = new Set<string>();

    do {
      const endpoint = `/pokemon/v1/en/cards?page=${page}&page_size=${PAGE_SIZE}&include=prices&orderBy=-expansion.release_date`;
      const result = await scrydexFetch(endpoint, apiKey, teamId);

      if (!result) {
        console.error(`Page ${page}: fetch failed, stopping`);
        break;
      }

      if (page === 1) {
        const total = result.total_count ?? 0;
        totalPages = Math.ceil(total / PAGE_SIZE);
        const fetchPages = Math.min(pageLimit, totalPages);
        console.log(`Total cards: ${total} — ${totalPages} pages total, fetching ${fetchPages}`);
      }

      for (const card of result.data ?? []) {
        // English physical TCG only — strict checks (treat missing field as non-EN / non-physical)
        if (card.expansion?.language_code !== "EN") continue;
        if (card.expansion?.is_online_only) continue; // skip TCG Pocket
        const series = (card.expansion?.series ?? "").toLowerCase();
        if (series === "pokémon tcg pocket" || series === "mega evolution") continue;
        const price = extractCardPrice(card);
        if (!price || price <= 0) continue;
        // Deduplicate: keep first (best) price per card_id per day
        const key = card.id;
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        buffer.push({
          card_id: card.id,
          card_name: card.name ?? "",
          set_name: card.expansion?.name ?? "",
          price,
          recorded_at: today,
        });
      }

      // Flush every 500 rows to avoid memory pressure
      if (buffer.length >= 500) {
        const { inserted, skipped } = await flushRows(supabase, buffer);
        totalInserted += inserted;
        totalSkipped += skipped;
        buffer.length = 0;
      }

      console.log(`Page ${page}/${Math.min(pageLimit, totalPages)} — ${totalInserted} saved so far`);
      page++;
      if (page <= Math.min(pageLimit, totalPages)) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    } while (page <= Math.min(pageLimit, totalPages));

    // Final flush
    const { inserted, skipped } = await flushRows(supabase, buffer);
    totalInserted += inserted;
    totalSkipped += skipped;

    // Cleanup: remove snapshots older than 90 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    await supabase
      .from("price_snapshots")
      .delete()
      .lt("recorded_at", cutoff.toISOString().split("T")[0]);

    const summary = {
      success: true,
      mode,
      date: today,
      pages_processed: page - 1,
      prices_saved: totalInserted,
      prices_skipped: totalSkipped,
    };
    console.log("Done:", summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Snapshot error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
