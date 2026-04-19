import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Gift, Clock } from "lucide-react";

interface Prize {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  estimated_value_usd: number | null;
  week_start: string; // YYYY-MM-DD
  week_end: string;
  status: string;
}

interface Props {
  game: string;
  className?: string;
}

async function fetchActivePrize(game: string): Promise<Prize | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("prizes")
    .select("id, title, description, image_url, estimated_value_usd, week_start, week_end, status")
    .eq("game", game)
    .lte("week_start", today)
    .gte("week_end", today)
    .neq("status", "cancelled")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Prize) ?? null;
}

function useCountdown(targetDate: string | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!targetDate) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [targetDate]);
  if (!targetDate) return "";
  // Week ends at end of week_end day (next-day 00:00 UTC).
  const end = new Date(`${targetDate}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000;
  const diff = end - now;
  if (diff <= 0) return "ended";
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days >= 1) return `${days}d ${hours}h`;
  const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  return `${hours}h ${mins}m`;
}

export default function CurrentPrizeCard({ game, className = "" }: Props) {
  const { data: prize, isLoading } = useQuery({
    queryKey: ["active-prize", game],
    queryFn: () => fetchActivePrize(game),
    staleTime: 5 * 60_000,
  });

  const countdown = useCountdown(prize?.week_end ?? null);

  return (
    <div className={`rounded-xl border border-border bg-card overflow-hidden ${className}`}>
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Gift className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">This week's prize</h3>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-3">
          <Skeleton className="aspect-[4/3] w-full rounded-lg" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ) : !prize ? (
        <div className="py-10 px-4 text-center">
          <Gift className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No prize active yet.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Weekly giveaways start soon — keep playing to climb the leaderboard.
          </p>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          {prize.image_url ? (
            <div className="relative aspect-[4/3] rounded-lg overflow-hidden border border-border bg-background/40">
              <img
                src={prize.image_url}
                alt={prize.title}
                className="absolute inset-0 w-full h-full object-contain"
                loading="lazy"
              />
            </div>
          ) : (
            <div className="aspect-[4/3] rounded-lg border border-border bg-gradient-to-br from-primary/15 to-background flex items-center justify-center">
              <Gift className="w-10 h-10 text-primary/50" />
            </div>
          )}

          <div>
            <h4 className="font-semibold text-foreground leading-snug">{prize.title}</h4>
            {prize.estimated_value_usd != null && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Est. value{" "}
                <span className="font-medium text-foreground">
                  ${Number(prize.estimated_value_usd).toLocaleString()}
                </span>
              </p>
            )}
          </div>

          {prize.description && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              {prize.description}
            </p>
          )}

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1 border-t border-border">
            <Clock className="w-3 h-3" />
            <span>
              Ends in <span className="font-semibold text-foreground tabular-nums">{countdown}</span>
            </span>
          </div>

          <p className="text-[11px] text-muted-foreground/80 leading-snug">
            Top weekly score wins. Tiebreaker: earliest completion.
          </p>
        </div>
      )}
    </div>
  );
}
