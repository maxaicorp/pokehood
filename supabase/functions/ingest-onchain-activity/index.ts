// ingest-onchain-activity — backend worker that owns ALL Magic Eden + Helius
// calls for the Onchain Activity feed.
//
// Architecture:
//   pg_cron (every 60s) → POST /ingest-onchain-activity
//                          → pulls newest 100 events from ME per collection
//                          → enriches new mints with Helius getAssetBatch
//                          → upserts into onchain_activities + nft_names
//   browser → /onchain-activity (read fn) → SELECT from DB only
//
// This decouples API cost from page traffic. 1 user or 10,000 users = same
// upstream calls. Previously every page load + 30s poll burned a fresh ME +
// Helius round-trip, which is exactly the recipe for rate-limit pain.
//
// USD enrichment: Top Sales needs to sort by USD across SOL + USDC trades,
// which requires the SOL/USD spot at ingest time. USDC trades use splPrice
// directly; SOL trades multiply price × spot. If both Jupiter and Pyth are
// down we still write the row with price_usd NULL — Top Sales just won't
// include it until the next ingest catches it up (idempotent upsert).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ME_API = "https://api-mainnet.magiceden.dev/v2";
const HELIUS_RPC = "https://mainnet.helius-rpc.com";

// Collections to ingest. Mirrors the read-side allowlist; expanding here is
// how you onboard a new ME collection into Collectiblez Onchain.
const COLLECTIONS = [
  "collector_crypt",
  "collector_crypt_graded",
];

// USDC mint on Solana. ME's priceInfo.splPrice.address equals this when a
// trade settled in USDC; rawAmount is then USDC base units (6 decimals).
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// ─── Spot SOL/USD (Jupiter primary, Pyth fallback) ───────────────────────────
// Both are public, no API key. We swallow individual failures and only return
// null when both sources fail — the caller writes price_usd=NULL in that case.
async function getSolUsd(): Promise<number | null> {
  // Jupiter Lite Price API
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3_000);
    const res = await fetch(
      "https://lite-api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112",
      { signal: ctl.signal },
    );
    clearTimeout(t);
    if (res.ok) {
      const j = await res.json();
      const p = Number(j?.data?.So11111111111111111111111111111111111111112?.price);
      if (p > 0) return p;
    }
  } catch (e) {
    console.warn("[sol-usd] jupiter failed:", (e as Error).message);
  }
  // Pyth Hermes
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3_000);
    const res = await fetch(
      "https://hermes.pyth.network/api/latest_price_feeds?ids[]=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
      { signal: ctl.signal },
    );
    clearTimeout(t);
    if (res.ok) {
      const arr = await res.json();
      const feed = Array.isArray(arr) ? arr[0] : null;
      const raw = Number(feed?.price?.price);
      const expo = Number(feed?.price?.expo);
      if (raw > 0 && Number.isFinite(expo)) return raw * Math.pow(10, expo);
    }
  } catch (e) {
    console.warn("[sol-usd] pyth failed:", (e as Error).message);
  }
  return null;
}

// Compute USD value for an activity given its raw price + priceInfo + spot.
// USDC: splPrice.rawAmount / 1e6. SOL: price * solUsd. Either may be null.
function computeUsd(price: number | null | undefined, priceInfo: any, solUsd: number | null): number | null {
  const splAddr = priceInfo?.splPrice?.address;
  const splRaw = priceInfo?.splPrice?.rawAmount;
  if (splAddr === USDC_MINT && splRaw) {
    const usdc = Number(splRaw) / 1_000_000;
    if (usdc > 0) return usdc;
  }
  const sol = typeof price === "number" ? price : Number(price);
  if (sol > 0 && solUsd && solUsd > 0) return sol * solUsd;
  return null;
}

// ─── Helius name + attribute resolution ──────────────────────────────────────
// Returns a Map<mint, ResolvedNft> for mints we don't already have in
// nft_names. Cache miss → single Helius RPC call (covers up to 1000 mints in
// one batch). On any failure we return an empty Map; the caller proceeds
// without names and the next ingest run will retry the same mints.
//
// We capture both the human-readable name AND the structured attribute array
// so the upcoming CC-discovery matcher can join NFT slabs to Scrydex
// graded_prices deterministically (rather than parsing free-form names).

interface HeliusAttr { trait_type?: string; value?: unknown }
interface ResolvedNft {
  name: string | null;
  cert_number: string | null;
  attributes: HeliusAttr[];
  card_name_attr: string | null;
  set_hint: string | null;
  card_number: string | null;
  grading_company: string | null;
  grade_value: number | null;
  year_attr: string | null;
}

// Map a normalized trait_type (lowercased, punctuation-stripped) to one of
// the canonical fields we extract. Collector Crypt's slab attributes use a
// handful of common labels but we keep the dispatch table generous in case
// labels vary across collections.
function normalizeTraitType(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseGradingCompany(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).toUpperCase().trim();
  if (!s) return null;
  // Canonicalize to short codes Scrydex uses.
  if (s.includes("PSA")) return "PSA";
  if (s.includes("CGC")) return "CGC";
  if (s.includes("BGS") || s.includes("BECKETT")) return "BGS";
  if (s.includes("TAG")) return "TAG";
  if (s.includes("SGC")) return "SGC";
  if (s.includes("ACE")) return "ACE";
  return s; // unknown — store verbatim, matcher will handle
}

function parseGradeValue(raw: unknown): number | null {
  if (raw == null) return null;
  // Grades arrive as numbers ("10"), decimals ("9.5"), or strings with
  // qualifiers ("Pristine 10", "Authentic"). parseFloat handles the first
  // two and a leading "Pristine 10" string by skipping non-numeric prefix.
  const s = String(raw).trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

async function resolveNamesForNewMints(
  supabase: any,
  apiKey: string,
  mints: string[],
): Promise<Map<string, ResolvedNft>> {
  const result = new Map<string, ResolvedNft>();
  if (!mints.length || !apiKey) return result;

  // Filter to mints we either don't have OR have but never extracted
  // structured attributes for (legacy rows from before this column existed).
  const { data: existing, error } = await supabase
    .from("nft_names")
    .select("mint, attributes")
    .in("mint", mints);
  if (error) {
    console.warn("[helius] nft_names lookup failed:", error.message);
  }
  const fullyCached = new Set(
    (existing ?? [])
      .filter((r: { attributes: unknown }) => r.attributes != null)
      .map((r: { mint: string }) => r.mint),
  );
  const missing = mints.filter((m) => !fullyCached.has(m));
  if (missing.length === 0) return result;

  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8_000);
    const res = await fetch(`${HELIUS_RPC}/?api-key=${apiKey}`, {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "ingest-onchain-activity",
        method: "getAssetBatch",
        params: { ids: missing },
      }),
    });
    clearTimeout(t);
    if (!res.ok) {
      console.warn(`[helius] getAssetBatch ${res.status}`);
      return result;
    }
    const j = await res.json() as {
      result?: Array<{
        id?: string;
        content?: { metadata?: { name?: string; attributes?: HeliusAttr[] } };
      }>;
    };
    for (const asset of j.result ?? []) {
      const id = asset?.id;
      if (!id) continue;
      const name = asset?.content?.metadata?.name ?? null;
      const attrs = asset?.content?.metadata?.attributes ?? [];

      // Walk attributes once, dispatching by normalized trait_type into the
      // structured fields. Generous on label variants because Collector
      // Crypt + other graded-NFT projects don't share a consistent schema.
      let cert: string | null = null;
      let cardName: string | null = null;
      let setHint: string | null = null;
      let cardNumber: string | null = null;
      let gradingCompany: string | null = null;
      let gradeValue: number | null = null;
      let year: string | null = null;

      for (const a of attrs) {
        const tt = normalizeTraitType((a?.trait_type ?? "").toString());
        const v = a?.value;
        if (v == null || v === "") continue;
        switch (tt) {
          case "certificate":
          case "certificate number":
          case "cert number":
          case "cert":
          case "psa cert":
          case "psa certificate":
          case "cgc certificate":
          case "bgs certificate":
            cert ??= String(v);
            break;
          case "card name":
          case "name":
          case "card":
            cardName ??= String(v);
            break;
          case "set":
          case "set name":
          case "expansion":
          case "series":
            setHint ??= String(v);
            break;
          case "card number":
          case "number":
          case "card no":
          case "card num":
            cardNumber ??= String(v);
            break;
          case "grading company":
          case "grader":
          case "authenticator":
          case "grading service":
          case "tpa":
            gradingCompany ??= parseGradingCompany(v);
            break;
          case "grade":
          case "grade value":
          case "overall grade":
            gradeValue ??= parseGradeValue(v);
            break;
          case "year":
          case "release year":
            year ??= String(v);
            break;
        }
      }

      // Some collections embed grading company in the grade string itself
      // (e.g. "PSA 10"). If we still don't have a company, try to extract.
      if (!gradingCompany && gradeValue == null) {
        for (const a of attrs) {
          const tt = normalizeTraitType((a?.trait_type ?? "").toString());
          if (tt === "grade" || tt === "overall grade") {
            const s = String(a?.value ?? "");
            const company = parseGradingCompany(s);
            const value = parseGradeValue(s);
            if (company) gradingCompany = company;
            if (value != null) gradeValue = value;
            break;
          }
        }
      }

      result.set(id, {
        name,
        cert_number: cert,
        attributes: attrs,
        card_name_attr: cardName,
        set_hint: setHint,
        card_number: cardNumber,
        grading_company: gradingCompany,
        grade_value: gradeValue,
        year_attr: year,
      });
    }
  } catch (e) {
    console.warn("[helius] getAssetBatch threw:", (e as Error).message);
    return result;
  }

  // Upsert. Persist even when fields are null so we don't re-hit Helius
  // every cron tick for mints whose metadata is permanently sparse.
  if (result.size > 0) {
    const rows = [...result.entries()].map(([mint, v]) => ({
      mint,
      name: v.name,
      cert_number: v.cert_number,
      attributes: v.attributes,
      card_name_attr: v.card_name_attr,
      set_hint: v.set_hint,
      card_number: v.card_number,
      grading_company: v.grading_company,
      grade_value: v.grade_value,
      year_attr: v.year_attr,
      fetched_at: new Date().toISOString(),
    }));
    const { error: upErr } = await supabase
      .from("nft_names")
      .upsert(rows, { onConflict: "mint" });
    if (upErr) console.warn("[helius] nft_names upsert failed:", upErr.message);
  }
  return result;
}

// ─── ME activity fetch + DB upsert per collection ────────────────────────────
interface MeActivity {
  signature: string;
  type: string;
  source?: string;
  tokenMint?: string;
  collection?: string;
  collectionSymbol?: string;
  blockTime: number;
  buyer?: string;
  seller?: string;
  price?: number;
  priceInfo?: any;
  image?: string;
}

async function ingestCollection(
  supabase: any,
  heliusKey: string,
  collection: string,
  solUsd: number | null,
  pageLimit: number,
): Promise<{ collection: string; fetched: number; upserted: number; new_names: number }> {
  // ME caps `limit` at 500 on /activities. We pull 500 per page and walk up
  // to `pageLimit` pages — controls how deep the catchup goes if the cron
  // ever falls behind. Default is 1 page (500 events / ~1-2hrs of activity)
  // which is plenty for a 60s cadence; bumps to 5+ for a manual backfill.
  let fetched = 0;
  let upserted = 0;
  let allMints = new Set<string>();
  const allRows: any[] = [];

  for (let page = 0; page < pageLimit; page++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15_000);
    const url = `${ME_API}/collections/${collection}/activities?offset=${page * 500}&limit=500&_t=${Date.now()}`;
    let raw: MeActivity[] = [];
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
      clearTimeout(t);
      if (!res.ok) {
        console.warn(`[${collection}] ME ${res.status} on page ${page}; stopping pass`);
        break;
      }
      raw = await res.json();
      if (!Array.isArray(raw)) raw = [];
    } catch (e) {
      console.warn(`[${collection}] ME fetch failed on page ${page}: ${(e as Error).message}`);
      break;
    }
    if (raw.length === 0) break;
    fetched += raw.length;

    for (const a of raw) {
      if (!a?.signature) continue;
      if (a.tokenMint) allMints.add(a.tokenMint);
      allRows.push({
        signature: a.signature,
        collection,
        type: a.type ?? "unknown",
        source: a.source ?? "magiceden_v2",
        token_mint: a.tokenMint ?? null,
        block_time: a.blockTime ?? 0,
        buyer: a.buyer ?? null,
        seller: a.seller ?? null,
        price: typeof a.price === "number" ? a.price : null,
        price_usd: computeUsd(a.price, a.priceInfo, solUsd),
        price_info: a.priceInfo ?? null,
        image: a.image ?? null,
      });
    }
    if (raw.length < 500) break; // ran out, no need to keep paging
  }

  // Helius enrich for any mints we don't already have cached.
  const resolved = await resolveNamesForNewMints(supabase, heliusKey, [...allMints]);

  // Dedupe by signature within this run — ME occasionally returns the same
  // signature twice across pages, and Postgres ON CONFLICT errors out if a
  // single statement targets the same key twice.
  const bySig = new Map<string, any>();
  for (const r of allRows) bySig.set(r.signature, r);
  const dedupedRows = [...bySig.values()];

  // Upsert in chunks of 500 to keep request bodies modest.
  for (let i = 0; i < dedupedRows.length; i += 500) {
    const slice = dedupedRows.slice(i, i + 500);
    const { error } = await supabase
      .from("onchain_activities")
      .upsert(slice, { onConflict: "signature" });
    if (error) {
      console.error(`[${collection}] upsert error:`, error.message);
    } else {
      upserted += slice.length;
    }
  }

  return { collection, fetched, upserted, new_names: resolved.size };
}

// ─── Main ────────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Auth — same pattern as snapshot-prices. Either x-cron-secret header
  // (pg_cron path) or an admin JWT (manual /admin/functions test path).
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
  if (!authorized) {
    return new Response(
      JSON.stringify({ error: "Unauthorized — admin or cron secret required" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const heliusKey = Deno.env.get("HELIUS_API_KEY") ?? "";
  const body = await req.json().catch(() => ({}));
  // pageLimit=1 = 500 events (cron default). Bump to 5-10 for manual catchup.
  const pageLimit = Math.max(1, Math.min(20, Number(body.pageLimit) || 1));

  const t0 = Date.now();
  const solUsd = await getSolUsd();
  const results = [];
  for (const c of COLLECTIONS) {
    try {
      results.push(await ingestCollection(supabase, heliusKey, c, solUsd, pageLimit));
    } catch (e) {
      console.error(`[${c}] ingest threw:`, (e as Error).message);
      results.push({ collection: c, fetched: 0, upserted: 0, new_names: 0, error: (e as Error).message });
    }
  }

  // Retention sweep — drop activities older than 90 days so the table doesn't
  // grow unbounded. Top Sales windows only need 30 days; keep 90 for safety.
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 90 * 86400;
    await supabase.from("onchain_activities").delete().lt("block_time", cutoff);
  } catch (e) {
    console.warn("[retention] sweep failed:", (e as Error).message);
  }

  const summary = {
    success: true,
    duration_ms: Date.now() - t0,
    sol_usd: solUsd,
    collections: results,
  };
  console.log("ingest-onchain-activity done:", summary);
  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
