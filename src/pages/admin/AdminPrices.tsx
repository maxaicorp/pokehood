// /admin/prices — price audit + override tool.
//
// MAIN FLOW (bulk audit): paste card URLs or IDs into the box, hit "Run audit".
// For each card the page pulls the STORED price (latest_card_prices) and the
// LIVE Scrydex price + 1d/7d/30d trend deltas (through scrydex-proxy — the API
// key stays server-side), shows the diff, and offers a one-click "Fix" that
// pins the correct value via admin_set_card_price. A pin is the SOURCE OF
// TRUTH: it's written as today's official snapshot and re-applied on every
// refresh, so the daily cron can't overwrite it.
//
// This replaces the offline Python validator for day-to-day use — no key
// pasting, no SQL. (scripts/scrydex-tools/ stays for big offline sweeps.)

import { useState } from "react";
import AdminLayout from "./AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { resetLatestPricesCache } from "@/lib/price-snapshots";
import {
  getScrydexCard,
  getScrydexNmAudit,
  getScrydexNmAuditFromCard,
  type ScrydexCard,
  type ScrydexNmAudit,
} from "@/lib/scrydex-api";
import { getMarketSets, type PokemonSet } from "@/lib/pokemon-api";
import { findSetBySlug } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScanLine, Save, Trash2, Loader2, Tag, CheckCircle2, Search } from "lucide-react";
import { toast } from "sonner";

// ─── helpers ──────────────────────────────────────────────────────────────────

const num = (v: string): number | null => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const usd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD" });

/** Turn a pasted line (URL or raw id) into a Scrydex card_id. */
function parseInput(line: string, sets: PokemonSet[]): string | null {
  const t = line.trim();
  if (!t) return null;
  if (t.includes("/sets/")) {
    const path = t.split("?")[0].split("#")[0].replace(/\/+$/, "");
    const segs = path.split("/").filter(Boolean);
    const cardSlug = segs[segs.length - 1];
    const setSlugStr = segs[segs.length - 2];
    const set = setSlugStr ? findSetBySlug(setSlugStr, sets) : undefined;
    const localId = cardSlug?.slice(cardSlug.lastIndexOf("-") + 1);
    if (set && localId) return `${set.id}-${localId}`;
    return null;
  }
  // Raw id (me2pt5-284 or base1-4::unlimitedShadowlessHolofoil) — must have a dash.
  return /-/.test(t) ? t : null;
}

type Status = "ok" | "off" | "nonm" | "new" | "badinput";

interface AuditRow {
  input: string;
  cardId: string | null;
  name: string;
  setName: string;
  storedPrice: number | null;
  scrydex: ScrydexNmAudit | null;
  diff: number | null;       // % stored vs scrydex
  status: Status;
  fixed: boolean;
  fixing: boolean;
}

interface StoredRow {
  card_id: string; card_name: string; set_name: string;
  price: number | null; price_1d: number | null; price_7d: number | null; price_30d: number | null;
  recorded_at?: string | null; updated_at?: string | null;
}

interface ScrydexRawRow {
  variant: string;
  condition: string;
  market: number | null;
  low: number | null;
  currency: string;
}

function flattenRawRows(card: ScrydexCard | null): ScrydexRawRow[] {
  const rows: ScrydexRawRow[] = [];
  for (const variant of card?.variants ?? []) {
    for (const price of variant.prices ?? []) {
      if (price.type !== "raw") continue;
      rows.push({
        variant: variant.name,
        condition: price.condition,
        market: price.market ?? null,
        low: price.low ?? null,
        currency: price.currency ?? "",
      });
    }
  }
  return rows;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>, onTick: () => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
      onTick();
    }
  }));
  return out;
}

// ─── component ──────────────────────────────────────────────────────────────────

export default function AdminPrices() {
  // Bulk audit
  const [bulk, setBulk] = useState("");
  const [threshold, setThreshold] = useState("5");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState<AuditRow[]>([]);

  // Single-card manual override
  const [cardId, setCardId] = useState("");
  const [mLoading, setMLoading] = useState(false);
  const [mSaving, setMSaving] = useState(false);
  const [mRow, setMRow] = useState<StoredRow | null>(null);
  const [mOverridden, setMOverridden] = useState(false);
  const [mNotFound, setMNotFound] = useState(false);
  const [mPrice, setMPrice] = useState("");
  const [mP1d, setMP1d] = useState("");
  const [mP7d, setMP7d] = useState("");
  const [mP30d, setMP30d] = useState("");
  // graded override inputs
  const [gCompany, setGCompany] = useState("PSA");
  const [gGrade, setGGrade] = useState("10");
  const [gMarket, setGMarket] = useState("");
  const [gLow, setGLow] = useState("");
  const [gHigh, setGHigh] = useState("");
  const [gSaving, setGSaving] = useState(false);

  // Codex Scrydex admin update
  const [cInput, setCInput] = useState("");
  const [cLoading, setCLoading] = useState(false);
  const [cSaving, setCSaving] = useState(false);
  const [cResolvedId, setCResolvedId] = useState("");
  const [cStored, setCStored] = useState<StoredRow | null>(null);
  const [cHistoryFallback, setCHistoryFallback] = useState(false);
  const [cCard, setCCard] = useState<ScrydexCard | null>(null);
  const [cAudit, setCAudit] = useState<ScrydexNmAudit | null>(null);
  const [cPrice, setCPrice] = useState("");
  const [cStatus, setCStatus] = useState("");

  // ── bulk audit ──
  const runAudit = async () => {
    const thr = Number(threshold) || 5;
    const sets = (await getMarketSets()).data as PokemonSet[];
    const lines = bulk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    setScanning(true);
    setRows([]);
    setProgress({ done: 0, total: lines.length });

    // Resolve ids + batch-load stored prices in one DB query.
    const parsed = lines.map((l) => ({ input: l, cardId: parseInput(l, sets) }));
    const ids = parsed.map((p) => p.cardId).filter((x): x is string => !!x);
    const storedMap = new Map<string, StoredRow>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await (supabase.from as any)("latest_card_prices")
        .select("card_id, card_name, set_name, price, price_1d, price_7d, price_30d")
        .in("card_id", ids.slice(i, i + 200));
      for (const r of (data ?? []) as StoredRow[]) storedMap.set(r.card_id, r);
    }

    let done = 0;
    const results = await mapLimit(parsed, 4, async ({ input, cardId }): Promise<AuditRow> => {
      const base: AuditRow = {
        input, cardId, name: "", setName: "", storedPrice: null,
        scrydex: null, diff: null, status: "badinput", fixed: false, fixing: false,
      };
      if (!cardId) return base;
      const stored = storedMap.get(cardId) ?? null;
      base.name = stored?.card_name ?? "";
      base.setName = stored?.set_name ?? "";
      base.storedPrice = stored?.price ?? null;
      const scrydex = await getScrydexNmAudit(cardId).catch(() => null);
      base.scrydex = scrydex;
      if (!scrydex) { base.status = "nonm"; return base; }
      if (stored?.price == null) { base.status = "new"; return base; }
      base.diff = ((stored.price - scrydex.market) / scrydex.market) * 100;
      base.status = Math.abs(base.diff) > thr ? "off" : "ok";
      return base;
    }, () => { done += 1; setProgress({ done, total: lines.length }); });

    setRows(results);
    setScanning(false);
    const offCount = results.filter((r) => r.status === "off" || r.status === "new").length;
    toast.success(`Audited ${results.length} — ${offCount} need attention.`);
  };

  const applyFix = async (idx: number) => {
    const r = rows[idx];
    if (!r.cardId || !r.scrydex) return;
    setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, fixing: true } : x)));
    try {
      const { error } = await (supabase.rpc as any)("admin_set_card_price", {
        p_card_id: r.cardId,
        p_price: r.scrydex.market,
        p_price_1d: r.scrydex.price1d,
        p_price_7d: r.scrydex.price7d,
        p_price_30d: r.scrydex.price30d,
        p_note: "Scrydex audit fix",
        p_card_name: r.name || null,
        p_set_name: r.setName || null,
      });
      if (error) throw error;
      resetLatestPricesCache();
      setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, fixed: true, fixing: false, storedPrice: r.scrydex!.market, diff: 0, status: "ok" } : x)));
    } catch (e) {
      toast.error(`Fix failed: ${e instanceof Error ? e.message : String(e)}`);
      setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, fixing: false } : x)));
    }
  };

  const fixAll = async () => {
    const targets = rows.map((r, i) => ({ r, i })).filter(({ r }) => (r.status === "off" || r.status === "new") && !r.fixed && r.scrydex);
    for (const { i } of targets) await applyFix(i);
    toast.success(`Fixed ${targets.length} card${targets.length === 1 ? "" : "s"}.`);
  };

  // ── Codex Scrydex admin update ──
  const resolveCodexInput = async (value: string): Promise<string | null> => {
    const raw = value.trim();
    if (!raw) return null;
    if (!raw.includes("/sets/")) return /-/.test(raw) ? raw : null;
    const sets = (await getMarketSets()).data as PokemonSet[];
    return parseInput(raw, sets);
  };

  const loadCodexUpdate = async () => {
    setCLoading(true);
    setCStatus("");
    setCStored(null);
    setCHistoryFallback(false);
    setCCard(null);
    setCAudit(null);
    setCResolvedId("");
    try {
      const resolved = await resolveCodexInput(cInput);
      if (!resolved) {
        setCStatus("Could not resolve that input to a card id.");
        return;
      }
      const [base, want] = resolved.split("::");
      setCResolvedId(resolved);

      const [{ data: latest }, { data: history }, card] = await Promise.all([
        (supabase.from as any)("latest_card_prices")
          .select("card_id, card_name, set_name, price, price_1d, price_7d, price_30d, recorded_at, updated_at")
          .eq("card_id", resolved)
          .maybeSingle(),
        (supabase.from as any)("price_snapshots")
          .select("card_id, card_name, set_name, price, recorded_at")
          .eq("card_id", resolved)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        getScrydexCard(base),
      ]);

      const stored = latest as StoredRow | null;
      const hist = history as { card_id: string; card_name: string; set_name: string; price: number; recorded_at: string } | null;
      if (stored) {
        setCStored(stored);
      } else if (hist) {
        setCHistoryFallback(true);
        setCStored({
          card_id: hist.card_id,
          card_name: hist.card_name,
          set_name: hist.set_name,
          price: hist.price,
          price_1d: null,
          price_7d: null,
          price_30d: null,
          recorded_at: hist.recorded_at,
          updated_at: null,
        });
      }

      setCCard(card);
      const audit = getScrydexNmAuditFromCard(card, want);
      setCAudit(audit);
      setCPrice(audit?.market != null ? String(audit.market) : stored?.price != null ? String(stored.price) : hist?.price != null ? String(hist.price) : "");

      if (!card) setCStatus("Scrydex card fetch failed through scrydex-proxy.");
      else if (!audit) setCStatus("Scrydex responded, but this extractor found no raw NM USD row. Check the raw rows below.");
      else setCStatus(`Scrydex raw NM found on ${audit.variant ?? "unknown"} at ${usd(audit.market)}.`);
    } catch (e) {
      setCStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setCLoading(false);
    }
  };

  const pinCodexPrice = async (useLive: boolean) => {
    if (!cResolvedId) return;
    const p = useLive ? cAudit?.market ?? null : num(cPrice);
    if (p == null || p <= 0) {
      toast.error("Enter a positive price.");
      return;
    }
    setCSaving(true);
    try {
      const { error } = await (supabase.rpc as any)("admin_set_card_price", {
        p_card_id: cResolvedId,
        p_price: p,
        p_price_1d: useLive ? cAudit?.price1d ?? null : cStored?.price_1d ?? null,
        p_price_7d: useLive ? cAudit?.price7d ?? null : cStored?.price_7d ?? null,
        p_price_30d: useLive ? cAudit?.price30d ?? null : cStored?.price_30d ?? null,
        p_note: "Codex Scrydex admin update",
        p_card_name: cStored?.card_name || cCard?.name || null,
        p_set_name: cStored?.set_name || cCard?.expansion?.name || null,
      });
      if (error) throw error;
      resetLatestPricesCache();
      toast.success(`Pinned ${cCard?.name || cStored?.card_name || cResolvedId} at ${usd(p)}.`);
      await loadCodexUpdate();
    } catch (e) {
      toast.error(`Codex pin failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCSaving(false);
    }
  };

  const backfillCodexHistory = async () => {
    if (!cResolvedId) return;
    setCSaving(true);
    try {
      const { error } = await supabase.functions.invoke("backfill-price-history", {
        body: { mode: "backfill", card_ids: [cResolvedId.split("::")[0]], days: 35, onlyIfDiff: true },
      });
      if (error) throw error;
      toast.success("Scrydex history backfill queued. Check function logs/cache after it finishes.");
    } catch (e) {
      toast.error(`Backfill failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCSaving(false);
    }
  };

  // ── single-card manual override ──
  const lookup = async () => {
    let id = cardId.trim();
    if (!id) return;
    setMLoading(true); setMRow(null); setMNotFound(false);
    try {
      if (id.includes("/sets/")) {
        const sets = (await getMarketSets()).data as PokemonSet[];
        id = parseInput(id, sets) ?? id;
      }
      const [{ data: pd }, { data: ovr }] = await Promise.all([
        (supabase.from as any)("latest_card_prices").select("card_id, card_name, set_name, price, price_1d, price_7d, price_30d").eq("card_id", id).maybeSingle(),
        (supabase.from as any)("card_price_overrides").select("card_id").eq("card_id", id).maybeSingle(),
      ]);
      if (!pd) { setMNotFound(true); return; }
      const r = pd as StoredRow;
      setMRow(r); setMOverridden(!!ovr);
      setMPrice(r.price != null ? String(r.price) : "");
      setMP1d(r.price_1d != null ? String(r.price_1d) : "");
      setMP7d(r.price_7d != null ? String(r.price_7d) : "");
      setMP30d(r.price_30d != null ? String(r.price_30d) : "");
    } catch (e) {
      toast.error(`Lookup failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setMLoading(false); }
  };
  const save = async () => {
    if (!mRow) return;
    const p = num(mPrice);
    if (p == null || p <= 0) { toast.error("Enter a positive price."); return; }
    setMSaving(true);
    try {
      const { error } = await (supabase.rpc as any)("admin_set_card_price", {
        p_card_id: mRow.card_id, p_price: p, p_price_1d: num(mP1d), p_price_7d: num(mP7d),
        p_price_30d: num(mP30d), p_note: null, p_card_name: mRow.card_name || null, p_set_name: mRow.set_name || null,
      });
      if (error) throw error;
      resetLatestPricesCache(); setMOverridden(true);
      toast.success(`Pinned ${mRow.card_name} at ${usd(p)}.`);
    } catch (e) { toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setMSaving(false); }
  };
  const clear = async () => {
    if (!mRow) return;
    setMSaving(true);
    try {
      const { error } = await (supabase.rpc as any)("admin_clear_card_price_override", { p_card_id: mRow.card_id });
      if (error) throw error;
      resetLatestPricesCache(); setMOverridden(false);
      toast.success("Override cleared.");
      await lookup();
    } catch (e) { toast.error(`Clear failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setMSaving(false); }
  };

  const saveGraded = async () => {
    if (!mRow) return;
    const mk = num(gMarket);
    const gr = num(gGrade);
    if (mk == null || mk <= 0) { toast.error("Enter a positive graded market price."); return; }
    if (gr == null) { toast.error("Enter a grade (e.g. 10, 9.5)."); return; }
    setGSaving(true);
    try {
      const { error } = await (supabase.rpc as any)("admin_set_graded_price", {
        p_card_id: mRow.card_id, p_company: gCompany, p_grade: gr,
        p_market: mk, p_low: num(gLow), p_high: num(gHigh), p_note: null,
      });
      if (error) throw error;
      resetLatestPricesCache();
      toast.success(`Pinned ${gCompany} ${gr} at ${usd(mk)}.`);
      setGMarket(""); setGLow(""); setGHigh("");
    } catch (e) { toast.error(`Graded pin failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setGSaving(false); }
  };

  const flaggedCount = rows.filter((r) => (r.status === "off" || r.status === "new") && !r.fixed).length;
  const codexRawRows = flattenRawRows(cCard);

  return (
    <AdminLayout>
      <div className="space-y-8 max-w-4xl">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <ScanLine className="w-5 h-5" /> Price audit &amp; override
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Paste card links or IDs, run a live Scrydex check, and pin the correct
            price for anything that's off. Pins are the source of truth — they
            survive the daily cron until you clear them.
          </p>
        </div>

        {/* ── Bulk audit ── */}
        <div className="rounded-xl border border-border p-4 space-y-3">
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={"Paste one per line — links or IDs:\nhttps://collectiblez.app/sets/ascended-heroes/mega-gengar-ex-284\nme2pt5-276\nbase1-4::unlimitedShadowlessHolofoil"}
            rows={6}
            className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs resize-y focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={runAudit} disabled={scanning || !bulk.trim()}>
              {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
              <span className="ml-2">{scanning ? `Checking ${progress.done}/${progress.total}…` : "Run audit"}</span>
            </Button>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Flag over</span>
              <Input value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-16 h-9 text-center" />
              <span className="text-muted-foreground">%</span>
            </div>
            {flaggedCount > 0 && (
              <Button onClick={fixAll} variant="default" className="ml-auto">
                <Save className="w-4 h-4" /> <span className="ml-2">Fix all flagged ({flaggedCount})</span>
              </Button>
            )}
          </div>

          {rows.length > 0 && (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border">
                    <th className="text-left font-medium py-2 px-1">Card</th>
                    <th className="text-right font-medium py-2 px-1">Stored</th>
                    <th className="text-right font-medium py-2 px-1">Scrydex (NM)</th>
                    <th className="text-right font-medium py-2 px-1">Δ</th>
                    <th className="text-right font-medium py-2 px-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 px-1 min-w-0">
                        <div className="font-medium text-foreground truncate max-w-[260px]">{r.name || r.cardId || r.input}</div>
                        <div className="text-[11px] font-mono text-muted-foreground truncate max-w-[260px]">{r.cardId ?? "couldn't parse"}</div>
                      </td>
                      <td className="text-right tabular-nums py-2 px-1">{usd(r.storedPrice)}</td>
                      <td className="text-right tabular-nums py-2 px-1">
                        {r.scrydex ? usd(r.scrydex.market) : "—"}
                        {r.scrydex && (
                          <div className="text-[10px] text-muted-foreground">
                            {usd(r.scrydex.price1d)} / {usd(r.scrydex.price7d)} / {usd(r.scrydex.price30d)}
                          </div>
                        )}
                      </td>
                      <td className={`text-right tabular-nums py-2 px-1 ${r.diff != null && Math.abs(r.diff) > (Number(threshold) || 5) ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                        {r.diff != null ? `${r.diff >= 0 ? "+" : ""}${r.diff.toFixed(1)}%` : "—"}
                      </td>
                      <td className="text-right py-2 px-1 whitespace-nowrap">
                        <StatusCell r={r} onFix={() => applyFix(i)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Codex Scrydex admin update ── */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <ScanLine className="w-4 h-4" /> Codex Scrydex admin update
          </h2>
          <div className="flex gap-2">
            <Input
              placeholder="Collectiblez URL or card ID, e.g. me4-116"
              value={cInput}
              onChange={(e) => setCInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadCodexUpdate()}
              className="font-mono"
            />
            <Button onClick={loadCodexUpdate} disabled={cLoading || !cInput.trim()} variant="outline">
              {cLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span className="ml-2">Load</span>
            </Button>
          </div>

          {cStatus && <p className="text-sm text-muted-foreground">{cStatus}</p>}

          {cResolvedId && (
            <div className="rounded-xl border border-border p-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{cCard?.name || cStored?.card_name || cResolvedId}</p>
                  <p className="text-xs font-mono text-muted-foreground">{cResolvedId}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {cHistoryFallback && <Badge variant="outline">history</Badge>}
                  {cAudit ? <Badge variant="secondary">NM live</Badge> : <Badge variant="outline" className="text-amber-500">no live NM</Badge>}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Stored</p>
                  <p className="font-semibold tabular-nums">{usd(cStored?.price)}</p>
                  <p className="text-[11px] text-muted-foreground">{cStored?.recorded_at ?? "no row"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Scrydex NM</p>
                  <p className="font-semibold tabular-nums">{usd(cAudit?.market)}</p>
                  <p className="text-[11px] text-muted-foreground">{cAudit?.variant ?? "none"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Raw rows</p>
                  <p className="font-semibold tabular-nums">{codexRawRows.length}</p>
                  <p className="text-[11px] text-muted-foreground">{cCard ? "Scrydex response" : "not loaded"}</p>
                </div>
                <Field label="Pin price" value={cPrice} onChange={setCPrice} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => pinCodexPrice(true)} disabled={cSaving || !cAudit}>
                  {cSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span className="ml-2">Pin live NM</span>
                </Button>
                <Button onClick={() => pinCodexPrice(false)} disabled={cSaving || !cPrice.trim()} variant="outline">
                  <Save className="w-4 h-4" /><span className="ml-2">Pin typed</span>
                </Button>
                <Button onClick={backfillCodexHistory} disabled={cSaving} variant="outline">
                  <ScanLine className="w-4 h-4" /><span className="ml-2">Queue history backfill</span>
                </Button>
              </div>

              {codexRawRows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border">
                        <th className="text-left font-medium py-2">Variant</th>
                        <th className="text-left font-medium py-2">Cond.</th>
                        <th className="text-right font-medium py-2">Market</th>
                        <th className="text-right font-medium py-2">Low</th>
                        <th className="text-right font-medium py-2">Currency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {codexRawRows.map((r, i) => (
                        <tr key={`${r.variant}-${r.condition}-${i}`} className="border-b border-border/50">
                          <td className="py-2 pr-2 font-mono">{r.variant}</td>
                          <td className="py-2 pr-2">{r.condition}</td>
                          <td className="py-2 text-right tabular-nums">{usd(r.market)}</td>
                          <td className="py-2 text-right tabular-nums">{usd(r.low)}</td>
                          <td className="py-2 text-right">{r.currency || "N/A"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Single-card manual override ── */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Tag className="w-4 h-4" /> Manual single-card override
          </h2>
          <div className="flex gap-2">
            <Input placeholder="Card ID — e.g. me2pt5-284" value={cardId}
              onChange={(e) => setCardId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookup()} className="font-mono" />
            <Button onClick={lookup} disabled={mLoading || !cardId.trim()} variant="outline">
              {mLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}<span className="ml-2">Load</span>
            </Button>
          </div>
          {mNotFound && <p className="text-sm text-muted-foreground">No <code>latest_card_prices</code> row for that id.</p>}
          {mRow && (
            <div className="rounded-xl border border-border p-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{mRow.card_name}</p>
                  <p className="text-xs font-mono text-muted-foreground">{mRow.card_id}</p>
                </div>
                {mOverridden && <Badge variant="secondary" className="shrink-0">Pinned</Badge>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Price (NM)" value={mPrice} onChange={setMPrice} />
                <Field label="1d ago" value={mP1d} onChange={setMP1d} />
                <Field label="7d ago" value={mP7d} onChange={setMP7d} />
                <Field label="30d ago" value={mP30d} onChange={setMP30d} />
              </div>
              <div className="flex gap-2">
                <Button onClick={save} disabled={mSaving} className="flex-1">
                  {mSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span className="ml-2">{mOverridden ? "Update pin" : "Pin price"}</span>
                </Button>
                {mOverridden && <Button onClick={clear} disabled={mSaving} variant="outline"><Trash2 className="w-4 h-4" /><span className="ml-2">Clear</span></Button>}
              </div>

              {/* Graded override — pins one (company, grade) market price */}
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Graded override (PSA / BGS / CGC)</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                  <div>
                    <label className="text-xs text-muted-foreground">Company</label>
                    <select
                      value={gCompany}
                      onChange={(e) => setGCompany(e.target.value)}
                      className="w-full h-10 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option>PSA</option><option>BGS</option><option>CGC</option>
                    </select>
                  </div>
                  <Field label="Grade" value={gGrade} onChange={setGGrade} />
                  <Field label="Market" value={gMarket} onChange={setGMarket} />
                  <Field label="Low" value={gLow} onChange={setGLow} />
                  <Field label="High" value={gHigh} onChange={setGHigh} />
                </div>
                <Button size="sm" variant="outline" onClick={saveGraded} disabled={gSaving}>
                  {gSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span className="ml-2">Pin graded price</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

function StatusCell({ r, onFix }: { r: AuditRow; onFix: () => void }) {
  if (r.fixed) return <span className="inline-flex items-center gap-1 text-green-500 text-xs"><CheckCircle2 className="w-3.5 h-3.5" /> pinned</span>;
  if (r.status === "badinput") return <Badge variant="outline" className="text-muted-foreground">bad input</Badge>;
  if (r.status === "nonm") return <Badge variant="outline" className="text-amber-500">no NM</Badge>;
  if (r.status === "ok") return <span className="text-xs text-muted-foreground">ok</span>;
  // off | new → fixable
  return (
    <Button size="sm" variant="outline" onClick={onFix} disabled={r.fixing}>
      {r.fixing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
      <span className="ml-1.5">{r.status === "new" ? "Add" : "Fix"}</span>
    </Button>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input type="number" inputMode="decimal" step="0.01" min="0" value={value} onChange={(e) => onChange(e.target.value)} className="tabular-nums" />
    </div>
  );
}
