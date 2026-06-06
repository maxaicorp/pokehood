import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getGradedPage, type GradedRow } from "@/lib/price-snapshots";
import { getCardById, getSets, formatPrice } from "@/lib/pokemon-api";
import { addToCollection } from "@/lib/collection-store";
import { useAuth } from "@/contexts/AuthContext";
import { toastAddedToInventory } from "@/lib/inventory-toast";
import { cardPathFromApiId } from "@/lib/slug";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import CardImage from "@/components/CardImage";
import SetLogo from "@/components/SetLogo";

const GRID = "grid-cols-[36px_1fr_220px_92px_110px_40px]";

interface Props {
  /** Company (PSA/BGS/CGC/TAG) + grade + resolved set ids — all from the Market
   *  header so the controls sit exactly where Top's set dropdown does. */
  company: string;
  grade: number;
  setIds: string[] | null;
}

/** Market "Graded" tab body — value-sorted graded slabs from latest_graded_prices.
 *  Mirrors the Top table; filters are lifted to the Market header. */
export default function GradedTab({ company, grade, setIds }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [addingId, setAddingId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["graded-page", company, grade, setIds],
    queryFn: () => getGradedPage({ company, grade, setIds, limit: 250 }),
    staleTime: 60_000,
  });

  // Fallback set name: some graded cards (secret rares) aren't in the catalog,
  // so the RPC's set_name comes back blank. Derive it from the card-id prefix
  // via the sets list (same prefix the logo already resolves from).
  const { data: setsData } = useQuery({ queryKey: ["pokemon-sets"], queryFn: getSets, staleTime: 5 * 60_000 });
  const setNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of (setsData?.data ?? [])) m.set(s.id, s.name);
    return m;
  }, [setsData]);
  const setIdOf = (id: string) => id.split("::")[0].split("-").slice(0, -1).join("-");
  const displaySet = (row: GradedRow) => row.setName || setNameById.get(setIdOf(row.cardId)) || "";
  // Some secret rares aren't in the catalog, so the RPC returns the id as the
  // name. Show a clean "#<number>" instead of the raw id (the set + logo still
  // resolve), so the row reads intentional until the targeted name-backfill.
  const displayName = (row: GradedRow) =>
    row.cardName && row.cardName !== row.cardId
      ? row.cardName
      : `#${row.cardId.split("::")[0].split("-").at(-1) ?? "?"}`;

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

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className={`hidden sm:grid ${GRID} gap-3 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground items-center`}>
        <span>#</span><span>Card</span><span>Set</span><span>Grade</span><span className="text-right">Price</span><span />
      </div>

      {isLoading ? (
        <div className="p-3 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          No {company} {grade} prices for this filter yet.
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
              <p className="text-sm font-semibold text-foreground truncate">{displayName(row)}</p>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <SetLogo cardId={row.cardId} alt="" className="h-5 w-auto max-w-[56px] object-contain shrink-0" />
              <p className="text-sm text-muted-foreground truncate">{displaySet(row)}</p>
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
              <p className="text-sm font-semibold text-foreground truncate">{displayName(row)}</p>
              <p className="text-xs text-muted-foreground truncate">{displaySet(row)}</p>
              <span className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{row.company} {row.grade}</span>
            </div>
            <p className="text-sm font-bold text-foreground tabular-nums shrink-0">{formatPrice(row.market)}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
