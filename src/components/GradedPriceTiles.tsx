// GradedPriceTiles — one card per major grading company (PSA / BGS / CGC),
// each with a grade dropdown so the user picks which grade's market price to
// view. Replaces the old fixed 6-tile (PSA/BGS/CGC × 10,9) layout, which hid
// every grade that wasn't a 10 or 9 — so cards with only, say, PSA 8 or BGS
// 9.5 looked empty even though we had data.
//
// Data flow:
//   snapshot-prices (daily) → graded_price_snapshots → latest_graded_prices
//   → get_graded_tiles_for_card RPC → this component
//
// The RPC returns ALL grades for the 3 companies; each dropdown lists whatever
// grades that company actually has for the card, defaulting to the highest.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  // Card id from our index. Strips ::variant suffix before querying — graded
  // prices don't change per variant in Scrydex's data model.
  cardId: string;
}

const COMPANIES = ["PSA", "BGS", "CGC"] as const;

interface GradedRow {
  company: string;
  grade: number;
  market: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  currency: string;
}

function formatUsd(n: number | null): string {
  if (n == null || n <= 0) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  });
}

function CompanyCard({ company, rows }: { company: string; rows: GradedRow[] }) {
  // Only grades with a real market price, highest first.
  const grades = useMemo(
    () =>
      rows
        .filter((r) => r.market != null && r.market > 0)
        .sort((a, b) => b.grade - a.grade),
    [rows],
  );

  const [picked, setPicked] = useState<number | null>(null);
  // Default to the highest available grade until the user picks one.
  const current = grades.find((r) => r.grade === picked) ?? grades[0];
  const hasData = !!current;
  const showRange =
    hasData && current.low != null && current.high != null && current.low !== current.high;

  return (
    <div
      className={`rounded-xl border bg-card p-3 sm:p-4 ${
        hasData ? "border-border" : "border-border/40 opacity-60"
      }`}
    >
      <div className="flex items-center justify-between gap-2 min-h-[28px]">
        <span className="text-xs font-semibold text-muted-foreground tracking-wide">
          {company}
        </span>
        {hasData && grades.length > 0 && (
          <Select value={String(current.grade)} onValueChange={(v) => setPicked(Number(v))}>
            <SelectTrigger className="h-7 w-[64px] text-xs px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {grades.map((r) => (
                <SelectItem key={r.grade} value={String(r.grade)} className="text-xs">
                  {r.grade}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div
        className={`mt-2 text-base sm:text-lg font-bold tabular-nums ${
          hasData ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {hasData ? formatUsd(current.market) : "—"}
      </div>
      {showRange ? (
        <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
          {formatUsd(current.low)} – {formatUsd(current.high)}
        </div>
      ) : (
        <div className="mt-0.5 h-[14px] text-[10px] text-muted-foreground">
          {hasData ? "" : "No graded sales yet"}
        </div>
      )}
    </div>
  );
}

export default function GradedPriceTiles({ cardId }: Props) {
  const baseCardId = cardId.split("::")[0];

  const { data, isLoading } = useQuery({
    queryKey: ["graded-tiles", baseCardId],
    queryFn: async (): Promise<GradedRow[]> => {
      const { data, error } = await supabase.rpc("get_graded_tiles_for_card", {
        p_card_id: baseCardId,
      });
      if (error) {
        console.warn("[GradedPriceTiles] RPC error:", error.message);
        return [];
      }
      return (data ?? []) as GradedRow[];
    },
    staleTime: 60 * 60_000, // 1 hour — graded prices update daily at most
    refetchOnWindowFocus: false,
    enabled: !!baseCardId,
  });

  if (isLoading) {
    return (
      <section className="mt-8">
        <h3 className="font-display font-semibold text-foreground mb-3">Graded Prices</h3>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  // Group the flat RPC rows by company so each card gets its own grade list.
  const byCompany = new Map<string, GradedRow[]>();
  for (const r of data ?? []) {
    if (!byCompany.has(r.company)) byCompany.set(r.company, []);
    byCompany.get(r.company)!.push(r);
  }

  const anyData = (data ?? []).some((r) => r.market != null && r.market > 0);

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-display font-semibold text-foreground">Graded Prices</h3>
        <span className="text-[10px] text-muted-foreground">
          {anyData ? "Market · daily snapshot" : "Graded data coming soon"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {COMPANIES.map((c) => (
          <CompanyCard key={c} company={c} rows={byCompany.get(c) ?? []} />
        ))}
      </div>
    </section>
  );
}
