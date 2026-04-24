/**
 * snapshot-prices edge function — Scrydex edition
 *
 * Fetches current card prices from Scrydex and upserts into price_snapshots.
 *
 * Modes (pass in POST body):
 *   {}                                    → daily: newest 60 pages + oldest 60 pages (~12,000 cards, 120 credits)
 *   { mode:"full" }                       → full:  all pages (~23,000 cards, ~235 credits) — run weekly
 *   { mode:"sets", setIds:["me3",...] }   → backfill specific sets only (1-2 credits per set,
 *                                            paginated at page_size=250). Use this to fix gaps
 *                                            in middle-numbered cards that the daily passes miss.
 *
 * Credit budget:
 *   Daily 120 pages × 30 days  = 3,600 credits/month
 *   Full  235 pages × 4 weeks  =   940 credits/month
 *   Total ≈ 4,540 credits/month (460 buffer under 5,000 Starter limit)
 *
 * Scheduling:
 *   - Daily job: POST {} every day (covers newest + oldest ~6k each)
 *   - Weekly job: POST { mode:"full" } once/week (covers all middle cards too)
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PAGE_SIZE = 100;
const DAILY_PAGE_LIMIT = 60; // 60 pages newest + 60 pages oldest = 120 credits/day
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

// Variant names that indicate a card genuinely has multiple collectible
// printings worth tracking separately (vintage-era markers). When none of
// these are present, Scrydex's "normal" and "holofoil" entries are usually
// two takes on the same physical card and should be collapsed.
const VINTAGE_VARIANTS = new Set([
  "1stEdition",
  "1stEditionNormal",
  "1stEditionHolofoil",
  "unlimitedHolofoil",
  "shadowless",
  "shadowlessHolofoil",
]);
const MODERN_PRIORITY = ["normal", "holofoil", "reverseHolofoil"];

function extractAllVariantPrices(card: ScrydexCard): { variant: string; price: number }[] {
  const all: { variant: string; price: number }[] = [];
  const variants = card.variants ?? [];

  for (const v of variants) {
    let price = v.prices?.find((x) => x.condition === "NM" && x.type === "raw" && x.currency === "USD" && x.market > 0)?.market;
    if (!price) price = v.prices?.find((x) => x.condition === "NM" && x.type === "raw" && x.market > 0)?.market;
    if (!price) price = v.prices?.find((x) => x.type === "raw" && x.currency === "USD" && x.market > 0)?.market;
    if (!price) price = v.prices?.find((x) => x.type === "raw" && x.market > 0)?.market;

    if (price && price > 0) {
      all.push({ variant: v.name, price });
    }
  }

  if (all.length === 0) return [];

  // If any vintage marker is present, keep every variant — the card has
  // multiple real printings (1st Edition, Shadowless, Unlimited Holo, etc.).
  const isVintage = all.some((vp) => VINTAGE_VARIANTS.has(vp.variant));
  if (isVintage) return all;

  // Modern card: collapse to a single bare-id row using the best available
  // price. Emitting as "normal" means the downstream code writes no ::suffix.
  const best =
    MODERN_PRIORITY.map((p) => all.find((vp) => vp.variant === p)).find(Boolean) ??
    all[0];
  return [{ variant: "normal", price: best!.price }];
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

// ─── Fetch pass helper ────────────────────────────────────────────────────────

async function runPass(opts: {
  label: string;
  orderBy: string;
  pageLimit: number;
  startPage?: number;
  apiKey: string;
  teamId: string;
  supabase: any;
  today: string;
  seenIds: Set<string>;
  buffer: SnapshotRow[];
  counters: { inserted: number; skipped: number };
}): Promise<number> {
  const { label, orderBy, pageLimit, apiKey, teamId, supabase, today, seenIds, buffer, counters } = opts;
  const startPage = Math.max(1, opts.startPage ?? 1);
  let page = startPage;
  let totalPages = 1;
  let pagesProcessed = 0;
  const endPage = startPage + pageLimit - 1;

  do {
    const endpoint = `/pokemon/v1/en/cards?page=${page}&page_size=${PAGE_SIZE}&include=prices&orderBy=${orderBy}`;
    const result = await scrydexFetch(endpoint, apiKey, teamId);

    if (!result) {
      console.error(`[${label}] Page ${page}: fetch failed, stopping pass`);
      break;
    }

    if (page === startPage) {
      const total = result.total_count ?? 0;
      totalPages = Math.ceil(total / PAGE_SIZE);
      const lastPage = Math.min(endPage, totalPages);
      console.log(`[${label}] Total cards: ${total} — ${totalPages} pages total, fetching ${startPage}..${lastPage}`);
    }

    for (const card of result.data ?? []) {
      // English physical TCG only
      if (card.expansion?.language_code !== "EN") continue;
      if (card.expansion?.is_online_only) continue; // skip TCG Pocket
      const series = (card.expansion?.series ?? "").toLowerCase();
      if (series === "pokémon tcg pocket") continue;
      const variantPrices = extractAllVariantPrices(card);
      if (variantPrices.length === 0) continue;
      
      // We only deduplicate based on base card.id
      if (seenIds.has(card.id)) continue;
      seenIds.add(card.id);
      
      for (const vp of variantPrices) {
        // We append the variant name to make it unique in the DB
        const suffix = vp.variant !== "normal" ? `::${vp.variant}` : "";
        buffer.push({
          card_id: `${card.id}${suffix}`,
          card_name: card.name ?? "",
          set_name: card.expansion?.name ?? "",
          price: vp.price,
          recorded_at: today,
        });
      }
    }

    // Flush every 500 rows to avoid memory pressure
    if (buffer.length >= 500) {
      const { inserted, skipped } = await flushRows(supabase, buffer);
      counters.inserted += inserted;
      counters.skipped += skipped;
      buffer.length = 0;
    }

    pagesProcessed++;
    const lastPage = Math.min(endPage, totalPages);
    console.log(`[${label}] Page ${page}/${lastPage} — ${counters.inserted} saved so far`);
    page++;
    if (page <= lastPage) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  } while (page <= Math.min(endPage, totalPages));

  return pagesProcessed;
}

// ─── Per-set backfill helper ──────────────────────────────────────────────────
//
// Queries Scrydex for one set at a time using q=expansion.id:{id}. page_size=250
// is Scrydex's max, so the largest current set (~295 cards) needs 2 pages.

async function runSetBackfill(opts: {
  setId: string;
  apiKey: string;
  teamId: string;
  supabase: any;
  today: string;
  seenIds: Set<string>;
  buffer: SnapshotRow[];
  counters: { inserted: number; skipped: number };
}): Promise<{ pages: number; cardsWithPrice: number }> {
  const { setId, apiKey, teamId, supabase, today, seenIds, buffer, counters } = opts;
  // Scrydex caps page_size at 100 for the cards endpoint; asking for 250 silently truncates
  // and reports total_count == returned, leading to "page 1/1" with missing cards.
  const pageSize = 100;
  let page = 1;
  let totalPages = 1;
  let cardsWithPrice = 0;
  const MAX_PAGES = 10; // hard ceiling — no real set has 1000+ cards

  do {
    const endpoint =
      `/pokemon/v1/en/cards?q=${encodeURIComponent(`expansion.id:${setId}`)}` +
      `&page=${page}&page_size=${pageSize}&include=prices`;
    const result = await scrydexFetch(endpoint, apiKey, teamId);
    if (!result) {
      console.error(`[set:${setId}] Page ${page}: fetch failed, stopping`);
      break;
    }
    if (page === 1) {
      const total = result.total_count ?? 0;
      totalPages = Math.max(1, Math.min(MAX_PAGES, Math.ceil(total / pageSize)));
      console.log(`[set:${setId}] Total cards: ${total} — ${totalPages} pages`);
    }

    const rows = result.data ?? [];
    for (const card of rows) {
      const variantPrices = extractAllVariantPrices(card);
      if (variantPrices.length === 0) continue;
      if (seenIds.has(card.id)) continue;
      seenIds.add(card.id);
      cardsWithPrice++;
      
      for (const vp of variantPrices) {
        const suffix = vp.variant !== "normal" ? `::${vp.variant}` : "";
        buffer.push({
          card_id: `${card.id}${suffix}`,
          card_name: card.name ?? "",
          set_name: card.expansion?.name ?? "",
          price: vp.price,
          recorded_at: today,
        });
      }
    }

    if (buffer.length >= 500) {
      const { inserted, skipped } = await flushRows(supabase, buffer);
      counters.inserted += inserted;
      counters.skipped += skipped;
      buffer.length = 0;
    }

    console.log(`[set:${setId}] Page ${page}/${totalPages} (rows:${rows.length}) — ${cardsWithPrice} priced so far`);
    // Stop early if Scrydex returned a short page (true end of data) even if totalPages claims more
    if (rows.length < pageSize) break;
    page++;
    if (page <= totalPages) await new Promise((r) => setTimeout(r, DELAY_MS));
  } while (page <= totalPages);

  return { pages: page, cardsWithPrice };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
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
    const mode: "daily" | "full" | "chunk" | "sets" =
      body.mode === "full" ? "full"
      : body.mode === "chunk" ? "chunk"
      : body.mode === "sets" ? "sets"
      : "daily" as "daily" | "full" | "chunk" | "sets";
    const today = new Date().toISOString().split("T")[0];
    // Optional chunking: { mode:"chunk", startPage:1, pageLimit:50, orderBy:"-expansion.release_date" }
    const startPage: number = Math.max(1, Number(body.startPage) || 1);
    const chunkPageLimit: number = Math.max(1, Number(body.pageLimit) || 50);
    const orderBy: string = typeof body.orderBy === "string" ? body.orderBy : "-expansion.release_date";
    const setIds: string[] = Array.isArray(body.setIds)
      ? body.setIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
      : [];

    console.log(`snapshot-prices [${mode}] starting — ${today}`);

    const seenIds = new Set<string>();
    const buffer: SnapshotRow[] = [];
    const counters = { inserted: 0, skipped: 0 };
    let pagesProcessed = 0;

    const setSummaries: Array<{ setId: string; pages: number; priced: number }> = [];

    if (mode === "sets") {
      if (setIds.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "mode=sets requires setIds: string[]" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
        );
      }
      // Run in background so proxy timeout doesn't kill the function mid-backfill.
      const work = (async () => {
        for (const setId of setIds) {
          const { pages, cardsWithPrice } = await runSetBackfill({
            setId, apiKey, teamId, supabase, today, seenIds, buffer, counters,
          });
          pagesProcessed += pages;
          setSummaries.push({ setId, pages, priced: cardsWithPrice });
          await new Promise((r) => setTimeout(r, DELAY_MS));
        }
        const { inserted, skipped } = await flushRows(supabase, buffer);
        counters.inserted += inserted;
        counters.skipped += skipped;
        console.log(`[sets] BACKGROUND DONE — sets=${setIds.length} inserted=${counters.inserted} skipped=${counters.skipped}`, setSummaries);
      })();
      // @ts-ignore — EdgeRuntime is available in Supabase Edge runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(work);
      } else {
        work.catch((e) => console.error("[sets] background error", e));
      }
      return new Response(
        JSON.stringify({ success: true, mode: "sets", queued: setIds.length, setIds, note: "Running in background — see logs for completion." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
      );
    } else if (mode === "chunk") {
      // Chunk mode: fetch a specific page range (caller orchestrates pagination)
      pagesProcessed += await runPass({
        label: `chunk@${startPage}+${chunkPageLimit}`,
        orderBy,
        pageLimit: chunkPageLimit,
        startPage,
        apiKey, teamId, supabase, today, seenIds, buffer, counters,
      });
    } else if (mode === "full") {
      // Full mode: single pass newest-first through all pages (~235 credits).
      // Run in background so the proxy/client timeout (~150s) doesn't kill the worker
      // mid-pass. Caller can pass { mode:"full", startPage:N } to resume.
      const fullStartPage = startPage > 1 ? startPage : 1;
      const work = (async () => {
        try {
          pagesProcessed += await runPass({
            label: "full",
            orderBy: "-expansion.release_date",
            pageLimit: Infinity,
            startPage: fullStartPage,
            apiKey, teamId, supabase, today, seenIds, buffer, counters,
          });
          const { inserted, skipped } = await flushRows(supabase, buffer);
          counters.inserted += inserted;
          counters.skipped += skipped;
          // 90-day cleanup
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 90);
          await supabase.from("price_snapshots").delete().lt("recorded_at", cutoff.toISOString().split("T")[0]);
          console.log(`[full] BACKGROUND DONE — pages=${pagesProcessed} inserted=${counters.inserted} skipped=${counters.skipped}`);
        } catch (e) {
          console.error("[full] background error:", e);
        }
      })();
      // @ts-ignore — EdgeRuntime is available in Supabase Edge runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(work);
      } else {
        work.catch((e) => console.error("[full] background error", e));
      }
      return new Response(
        JSON.stringify({ success: true, mode: "full", startPage: fullStartPage, note: "Running in background — see logs for completion." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
      );
    } else {
      // Daily mode: pass 1 — newest 60 pages (~6,000 most-recent cards)
      pagesProcessed += await runPass({
        label: "newest",
        orderBy: "-expansion.release_date",
        pageLimit: DAILY_PAGE_LIMIT,
        startPage: 1,
        apiKey, teamId, supabase, today, seenIds, buffer, counters,
      });

      // Daily mode: pass 2 — oldest 60 pages (~6,000 oldest cards), skip any already seen
      pagesProcessed += await runPass({
        label: "oldest",
        orderBy: "expansion.release_date",
        pageLimit: DAILY_PAGE_LIMIT,
        startPage: 1,
        apiKey, teamId, supabase, today, seenIds, buffer, counters,
      });
    }

    // Final flush
    const { inserted, skipped } = await flushRows(supabase, buffer);
    counters.inserted += inserted;
    counters.skipped += skipped;

    // Cleanup: remove snapshots older than 90 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    await supabase
      .from("price_snapshots")
      .delete()
      .lt("recorded_at", cutoff.toISOString().split("T")[0]);

    const summary: Record<string, unknown> = {
      success: true,
      mode,
      date: today,
      pages_processed: pagesProcessed,
      prices_saved: counters.inserted,
      prices_skipped: counters.skipped,
    };
    if (mode === "sets") summary.sets = setSummaries;
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
