// ingest-cc-native — captures Collector Crypt sales that happen on CC's OWN
// marketplace program (NOT Magic Eden). The existing ingest-onchain-activity
// pulls collector_crypt/collector_crypt_graded from Magic Eden's API; those are
// ME trades. CC also runs its own on-chain marketplace program where a large
// share of sales settle in USDC and never touch ME — those were invisible until
// now.
//
// Source of truth: program CcmRKTuZCGJBWQwMHvDYApBRvSZNHqGJXkznqpDTSQUr.
// A sale = the `BuyPnft` instruction. From the parsed tx (verified on-chain):
//   buyer  = account whose NFT balance goes +1  AND USDC balance goes negative
//   seller = account whose NFT balance goes -1  AND USDC balance goes positive
//   price  = total USDC paid by buyer (seller proceeds + marketplace/royalty fee)
//   mint   = the NFT (SPL token, decimals 0, amount 1)
//
// Rows are written to onchain_activities with collection='collector_crypt' and
// source='collector_crypt_native', so they appear in the existing Onchain feed
// + Top Sales with zero frontend changes. Idempotent upsert on `signature`.
//
// NOTE (2026-05-29): written from on-chain recon but NOT yet run against the
// live Helius key (edge-fn deploys were blocked at authoring time). First run
// should be a manual backfill ({ "pageLimit": 5 }) with the row counts checked.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HELIUS_RPC = "https://mainnet.helius-rpc.com";
const CC_PROGRAM = "CcmRKTuZCGJBWQwMHvDYApBRvSZNHqGJXkznqpDTSQUr";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const COLLECTION = "collector_crypt";
const SOURCE = "collector_crypt_native";

interface ParsedSale {
  signature: string;
  token_mint: string;
  buyer: string;
  seller: string;
  price: number;       // USDC paid by buyer
  block_time: number;
}

async function heliusRpc(key: string, method: string, params: unknown): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(`${HELIUS_RPC}/?api-key=${key}`, {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "ingest-cc-native", method, params }),
    });
    clearTimeout(t);
    if (!res.ok) {
      console.warn(`[helius] ${method} ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    console.warn(`[helius] ${method} threw:`, (e as Error).message);
    return null;
  }
}

// Parse a single jsonParsed transaction into a sale, or null if it isn't one.
// Driven entirely by token-balance deltas so we don't depend on the program IDL.
function parseSale(sig: string, tx: any): ParsedSale | null {
  const logs: string[] = tx?.meta?.logMessages ?? [];
  // CC's sale instruction. Guard on the log so we skip offers/lists/cancels.
  if (!logs.some((l) => l.includes("Instruction: BuyPnft"))) return null;
  if (tx?.meta?.err) return null;

  const pre = tx?.meta?.preTokenBalances ?? [];
  const post = tx?.meta?.postTokenBalances ?? [];

  // accountIndex -> { mint, owner, amount }
  const map = (arr: any[]) => {
    const m: Record<number, { mint: string; owner: string; amt: number }> = {};
    for (const b of arr) {
      m[b.accountIndex] = {
        mint: b.mint,
        owner: b.owner ?? "",
        amt: Number(b.uiTokenAmount?.uiAmount ?? 0),
      };
    }
    return m;
  };
  const P = map(pre), Q = map(post);
  const idxs = new Set<number>([...Object.keys(P), ...Object.keys(Q)].map(Number));

  let buyer = "", seller = "", tokenMint = "";
  let usdcPaid = 0; // sum of positive USDC deltas = gross price buyer paid

  for (const i of idxs) {
    const a = P[i], b = Q[i];
    const mint = b?.mint ?? a?.mint;
    const owner = b?.owner ?? a?.owner ?? "";
    const delta = (b?.amt ?? 0) - (a?.amt ?? 0);
    if (delta === 0 || !mint) continue;

    if (mint === USDC_MINT) {
      if (delta > 0) usdcPaid += delta; // seller proceeds + fee/royalty recipients
    } else if (delta === 1) {
      tokenMint = mint; buyer = owner;   // NFT received
    } else if (delta === -1) {
      tokenMint = mint; seller = owner;  // NFT sent
    }
  }

  if (!tokenMint || !buyer || !seller || usdcPaid <= 0) return null;
  return {
    signature: sig,
    token_mint: tokenMint,
    buyer,
    seller,
    price: Math.round(usdcPaid * 1e6) / 1e6,
    block_time: Number(tx?.blockTime ?? 0),
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Auth — same pattern as the other ingest crons.
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
    return new Response(JSON.stringify({ error: "Unauthorized — admin or cron secret required" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const heliusKey = Deno.env.get("HELIUS_API_KEY") ?? "";
  if (!heliusKey) {
    return new Response(JSON.stringify({ error: "Missing HELIUS_API_KEY" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const body = await req.json().catch(() => ({}));
  // sigLimit = how many recent program signatures to scan. Cron default 200
  // (covers ~25 min of CC volume at ~8 sigs/min); bump for a manual backfill.
  const sigLimit = Math.max(50, Math.min(1000, Number(body.sigLimit) || 200));
  const t0 = Date.now();

  // 1. Newest program signatures.
  const sigResp = await heliusRpc(heliusKey, "getSignaturesForAddress", [CC_PROGRAM, { limit: sigLimit }]);
  const sigs: string[] = (sigResp?.result ?? [])
    .filter((s: any) => !s.err)
    .map((s: any) => s.signature);
  if (sigs.length === 0) {
    return new Response(JSON.stringify({ success: true, scanned: 0, note: "no signatures" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // 2. Skip signatures we've already ingested (most are offers/cancels — cheap
  //    to skip before spending a getTransaction on them).
  const { data: existing } = await supabase
    .from("onchain_activities")
    .select("signature")
    .in("signature", sigs);
  const have = new Set((existing ?? []).map((r: { signature: string }) => r.signature));
  const fresh = sigs.filter((s) => !have.has(s));

  // 3. Fetch + parse each new tx. Sequential with a small delay to stay polite
  //    to the RPC; the per-run set is small at a 2-5 min cadence.
  const sales: ParsedSale[] = [];
  for (const sig of fresh) {
    const t = await heliusRpc(heliusKey, "getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
    const sale = t?.result ? parseSale(sig, t.result) : null;
    if (sale) sales.push(sale);
    await new Promise((r) => setTimeout(r, 60));
  }

  // 4. Upsert sales as buyNow activities (collection=collector_crypt so they
  //    join the existing feed/Top Sales). price_usd == price since USDC ≈ USD.
  let upserted = 0;
  if (sales.length > 0) {
    const rows = sales.map((s) => ({
      signature: s.signature,
      collection: COLLECTION,
      type: "buyNow",
      source: SOURCE,
      token_mint: s.token_mint,
      block_time: s.block_time,
      buyer: s.buyer,
      seller: s.seller,
      price: s.price,
      price_usd: s.price,
      price_info: { currency: "USDC", splAddress: USDC_MINT, amount: s.price },
      image: null,
    }));
    const { error } = await supabase.from("onchain_activities").upsert(rows, { onConflict: "signature" });
    if (error) console.error("[cc-native] upsert error:", error.message);
    else upserted = rows.length;
  }

  const summary = {
    success: true,
    duration_ms: Date.now() - t0,
    scanned: sigs.length,
    new_signatures: fresh.length,
    sales_found: sales.length,
    upserted,
  };
  console.log("ingest-cc-native done:", summary);
  return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
