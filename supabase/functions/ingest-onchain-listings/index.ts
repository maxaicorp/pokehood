// ingest-onchain-listings — backend worker that owns all Magic Eden listings
// calls for the Onchain Marketplace tab.
//
// Architecture mirror of ingest-onchain-activity:
//   pg_cron (every 2 min) → POST /ingest-onchain-listings
//                             → walks ME /listings paginated until empty
//                             → upserts active rows into onchain_listings
//                             → soft-deletes (delisted_at = now) any active
//                               rows missing from this run's snapshot
//   browser → /onchain-listings (read fn) → SELECT from DB only
//
// Why paginate the full list every run instead of incrementally:
// Magic Eden's /listings endpoint doesn't expose a "changed since" filter,
// and ascending-by-price is the only sort. The simplest correct approach is
// to snapshot the entire active set on each cron tick, then diff against the
// existing active rows. Collector Crypt has ~hundreds of listings so this is
// cheap (a few ME pages, all under rate limits).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ME_API = "https://api-mainnet.magiceden.dev/v2";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const COLLECTIONS = [
  "collector_crypt",
  "collector_crypt_graded",
];

// Items by exact name we don't want surfacing on Collectiblez (non-Pokémon
// physical items that share the same Magic Eden collection). Keep in sync
// with the legacy NAME_BLOCKLIST in supabase/functions/onchain-listings —
// once the read function is rewritten to SELECT from DB, this is the only
// filter point.
const NAME_BLOCKLIST = new Set(["moonbirds physical collectible"]);

async function getSolUsd(): Promise<number | null> {
  // Same Jupiter→Pyth fallback as ingest-onchain-activity. Duplicated rather
  // than shared so each function deploys standalone (Supabase edge functions
  // don't share local modules across functions).
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

interface MeListing {
  pdaAddress: string;
  tokenMint: string;
  seller: string;
  price: number;
  priceInfo?: any;
  rarity?: { howRare?: { rank?: number } };
  extra?: { img?: string };
  token?: { name?: string };
}

async function ingestCollection(
  supabase: any,
  collection: string,
  solUsd: number | null,
  maxPages: number,
): Promise<{ collection: string; fetched: number; active_upserted: number; soft_deleted: number; blocked: number }> {
  const seenPda = new Set<string>();
  const rows: any[] = [];
  let fetched = 0;
  let blocked = 0;

  // Walk ME until we get a short page or hit our safety cap. Default 5 pages
  // (500 listings) is enough headroom for current Collector Crypt volumes.
  for (let page = 0; page < maxPages; page++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15_000);
    // ME returns 500 when `sort=listPrice` is passed; default (ascending price)
    // is what we want anyway. Cachebusters also trigger 500s — omit both.
    const url = `${ME_API}/collections/${collection}/listings?offset=${page * 100}&limit=100`;
    let raw: MeListing[] = [];
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

    for (const l of raw) {
      if (!l?.pdaAddress) continue;
      const nm = (l.token?.name ?? "").trim().toLowerCase();
      if (NAME_BLOCKLIST.has(nm)) {
        blocked++;
        continue;
      }
      // Some collections show the same pdaAddress on multiple pages near the
      // boundary; dedupe within this pass.
      if (seenPda.has(l.pdaAddress)) continue;
      seenPda.add(l.pdaAddress);

      rows.push({
        pda_address: l.pdaAddress,
        collection,
        token_mint: l.tokenMint,
        seller: l.seller,
        price: l.price,
        price_usd: computeUsd(l.price, l.priceInfo, solUsd),
        price_info: l.priceInfo ?? null,
        rarity_rank: l.rarity?.howRare?.rank ?? null,
        name: l.token?.name ?? null,
        image: l.extra?.img ?? null,
        marketplace_url: `https://magiceden.us/item-details/${l.tokenMint}`,
        last_seen_at: new Date().toISOString(),
        delisted_at: null,
      });
    }
    if (raw.length < 100) break;
  }

  // Upsert all seen listings as active. ON CONFLICT updates everything
  // EXCEPT first_seen_at so we preserve the original list date for analytics.
  let active_upserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200);
    const { error } = await supabase
      .from("onchain_listings")
      .upsert(slice, { onConflict: "pda_address", ignoreDuplicates: false });
    if (error) {
      console.error(`[${collection}] listings upsert error:`, error.message);
    } else {
      active_upserted += slice.length;
    }
  }

  // Soft-delete: anything currently marked active but NOT in this run's seen
  // set has been delisted/sold. Stamp delisted_at = now() so the read RPC
  // (WHERE delisted_at IS NULL) hides them. We compare PDAs in bulk via NOT IN
  // on the seen set, capped to a single update.
  let soft_deleted = 0;
  const seenArr = [...seenPda];
  // Only soft-delete when we actually got pages back from ME — if ME was down
  // and seenPda is empty, blowing away every active listing would be a
  // catastrophe. The fetched>0 check ensures we only diff against a real
  // snapshot.
  if (fetched > 0) {
    // PostgREST has a URL-length limit on .in() filters; do the diff in DB
    // via an RPC-friendly approach: update where pda_address not in (seen).
    // For safety chunk seenArr — Postgres array literal supports thousands
    // easily, but PostgREST's URL encoding gets ugly past ~1500. Our
    // collections are well under that, but we cap anyway.
    if (seenArr.length <= 2000) {
      const { error, count } = await supabase
        .from("onchain_listings")
        .update({ delisted_at: new Date().toISOString() }, { count: "exact" })
        .eq("collection", collection)
        .is("delisted_at", null)
        .not("pda_address", "in", `(${seenArr.map((s) => `"${s}"`).join(",")})`);
      if (error) {
        console.warn(`[${collection}] soft-delete failed:`, error.message);
      } else {
        soft_deleted = count ?? 0;
      }
    } else {
      console.warn(`[${collection}] seenPda=${seenArr.length} too large to diff; skipping soft-delete this run`);
    }
  }

  return { collection, fetched, active_upserted, soft_deleted, blocked };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

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

  const body = await req.json().catch(() => ({}));
  const maxPages = Math.max(1, Math.min(20, Number(body.maxPages) || 5));

  const t0 = Date.now();
  const solUsd = await getSolUsd();
  const results = [];
  for (const c of COLLECTIONS) {
    try {
      results.push(await ingestCollection(supabase, c, solUsd, maxPages));
    } catch (e) {
      console.error(`[${c}] ingest threw:`, (e as Error).message);
      results.push({ collection: c, fetched: 0, active_upserted: 0, soft_deleted: 0, blocked: 0, error: (e as Error).message });
    }
  }

  const summary = {
    success: true,
    duration_ms: Date.now() - t0,
    sol_usd: solUsd,
    collections: results,
  };
  console.log("ingest-onchain-listings done:", summary);
  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
