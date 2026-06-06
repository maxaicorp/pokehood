import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getGradedPage, getGradedFilterOptions, type GradedRow } from "@/lib/price-snapshots";
import { getCardById, getSets, formatPrice, type PokemonSet } from "@/lib/pokemon-api";
import { addToCollection } from "@/lib/collection-store";
import { useAuth } from "@/contexts/AuthContext";
import { toastAddedToInventory } from "@/lib/inventory-toast";
import { cardPathFromApiId } from "@/lib/slug";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import CardImage from "@/components/CardImage";
import SetLogo from "@/components/SetLogo";

// Common grades per company if the live options list hasn't loaded yet.
const FALLBACK_GRADES: Record<string, number[]> = {
  PSA: [10, 9, 8],
  BGS: [10, 9.5, 9],
  CGC: [10, 9.5, 9],
};
const GRID = "grid-cols-[36px_1fr_220px_92px_110px_40px]";

/** Self-contained Market "Graded" tab — graded slabs by company + grade, value
 *  sorted, set-filterable. Mirrors the Top tab; reads latest_graded_prices. */
export default function GradedTab() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [company, setCompany] = useState("PSA");
  const [grade, setGrade] = useState(10);
  const [selectedSet, setSelectedSet] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);

  const { data: options = [] } = useQuery({
    queryKey: ["graded-options"], queryFn: getGradedFilterOptions, staleTime: 30 * 60_000,
  });
  const { data: setsData } = useQuery({ queryKey: ["pokemon-sets"], queryFn: getSets, staleTime: 5 * 60_000 });

  const companies = [...new Set(options.map((o) => o.company))];
  const liveGrades = options.filter((o) => o.company === company).map((o) => o.grade).sort((a, b) => b - a);
  const gradeList = liveGrades.length ? liveGrades : (FALLBACK_GRADES[company] ?? [10, 9]);

  // Keep the grade valid when the company changes.
  useEffect(() => {
    if (gradeList.length && !gradeList.includes(grade)) setGrade(gradeList[0]);
  }, [gradeList.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["graded-page", company, grade, selectedSet],
    queryFn: () => getGradedPage({ company, grade, setIds: selectedSet ? [selectedSet] : null, limit: 250 }),
    staleTime: 60_000,
  });

  const handleAdd = async (row: GradedRow) => {
    if (!user) { toast.error("Please sign in to add cards."); return; }
    setAddingId(row.cardId);
    try {
      const card = await getCardById(row.cardId);
      if (!card) { toast.error("Couldn't find that card."); return; }
      const ok = await addToCollection(card, user.id, `${row.company} ${row.grade}`);
      if (ok) toastAddedToInventory(card.name, navigate);
      else toast.error("Failed to add card.");
    } finally { setAddingId(null); }
  };

  const physicalSets = (setsData?.data ?? []).filter((s: PokemonSet) => !s.isOnlineOnly);

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Select value={company} onValueChange={setCompany}>
          <SelectTrigger className="w-[110px] bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(companies.length ? companies : ["PSA", "BGS", "CGC"]).map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(grade)} onValueChange={(v) => setGrade(Number(v))}>
          <SelectTrigger className="w-[120px] bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>
            {gradeList.map((g) => (
              <SelectItem key={g} value={String(g)}>{company} {g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedSet || "all"} onValueChange={(v) => setSelectedSet(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[160px] sm:w-[200px] bg-background"><SelectValue placeholder="All Sets" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sets</SelectItem>
            {physicalSets.map((s: PokemonSet) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className={`hidden sm:grid ${GRID} gap-3 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground items-center`}>
          <span>#</span><span>Card</span><span>Set</span><span>Grade</span><span className="text-right">Price</span><span />
        </div>

        {isLoading ? (
          <div className="p-3 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No {company} {grade} prices{selectedSet ? " for this set" : ""} yet.
          </div>
        ) : rows.map((row, i) => (
          <motion.div
            key={row.cardId}
            initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.01, 0.3) }}
            className="border-b border-border/50 last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
            onClick={() => navigate(cardPathFromApiId(row.cardId, row.cardName, row.setName))}
          >
            {/* Desktop */}
            <div className={`hidden sm:grid ${GRID} gap-3 px-4 py-2.5 items-center`}>
              <span className="text-sm font-mono text-muted-foreground tabular-nums">{i + 1}</span>
              <div className="flex items-center gap-3 min-w-0">
                <CardImage src={`https://images.scrydex.com/pokemon/${row.cardId}/small`} alt={row.cardName} className="w-10 shrink-0 shadow-sm" loading="lazy" />
                <p className="text-sm font-semibold text-foreground truncate">{row.cardName}</p>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <SetLogo cardId={row.cardId} alt="" className="h-5 w-auto max-w-[56px] object-contain shrink-0" />
                <p className="text-sm text-muted-foreground truncate">{row.setName}</p>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary w-fit">{row.company} {row.grade}</span>
              <p className="text-sm font-bold text-foreground text-right tabular-nums">{formatPrice(row.market)}</p>
              <Button
                size="icon" variant="ghost" aria-label="Add to inventory" disabled={addingId === row.cardId}
                className="h-7 w-7 rounded-full border border-border/50 hover:border-primary hover:text-primary shrink-0 justify-self-center"
                onClick={(e) => { e.stopPropagation(); handleAdd(row); }}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Mobile */}
            <div className="sm:hidden flex items-center gap-3 p-3">
              <CardImage src={`https://images.scrydex.com/pokemon/${row.cardId}/small`} alt={row.cardName} className="w-12 shrink-0 shadow-sm" loading="lazy" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{row.cardName}</p>
                <p className="text-xs text-muted-foreground truncate">{row.setName}</p>
                <span className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{row.company} {row.grade}</span>
              </div>
              <p className="text-sm font-bold text-foreground tabular-nums shrink-0">{formatPrice(row.market)}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
