import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import AppHeader from "@/components/AppHeader";
import PrizeCard from "@/components/PrizeCard";
import GiveawayEntryForm from "@/components/GiveawayEntryForm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getActiveGiveaway, type Giveaway } from "@/lib/giveaway-store";
import { Gift, Clock, DollarSign } from "lucide-react";

function useCountdown(target: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (!target) return null;
  const remaining = Math.max(0, new Date(target).getTime() - now);
  if (remaining <= 0) return "Ended";
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const mins = Math.floor((remaining % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  return `${hours}h ${mins}m`;
}

export default function GiveawayPage() {
  const [formOpen, setFormOpen] = useState(false);
  const { data: giveaway, isLoading } = useQuery<Giveaway | null>({
    queryKey: ["active-giveaway"],
    queryFn: getActiveGiveaway,
    staleTime: 60_000,
  });
  const countdown = useCountdown(giveaway?.ends_at ?? null);

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <AppHeader activePage={"market" as any} />

      <div className="container max-w-3xl py-10 sm:py-16 px-4 sm:px-8">
        {isLoading ? (
          <div className="flex flex-col items-center gap-6">
            <Skeleton className="w-64 sm:w-80 aspect-[2.5/3.5] rounded-lg" />
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        ) : !giveaway ? (
          <div className="flex flex-col items-center text-center gap-4 py-12">
            <Gift className="w-12 h-12 text-muted-foreground/50" />
            <h1 className="text-2xl font-bold">No active giveaway right now</h1>
            <p className="text-muted-foreground max-w-md">
              Check back soon — we run sweepstakes regularly. Follow along on socials so you don't miss the next one.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center gap-8">
            <div className="w-64 sm:w-80">
              <PrizeCard imageUrl={giveaway.prize_image_url} alt={giveaway.title} />
            </div>

            <div className="space-y-3 max-w-xl">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{giveaway.title}</h1>
              {giveaway.description && (
                <p className="text-muted-foreground leading-relaxed">{giveaway.description}</p>
              )}
              <div className="flex flex-wrap items-center justify-center gap-4 pt-2 text-sm">
                {giveaway.estimated_value_usd != null && (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <DollarSign className="w-4 h-4" />
                    Est. value: <strong className="text-foreground">${Number(giveaway.estimated_value_usd).toLocaleString()}</strong>
                  </span>
                )}
                {countdown && (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    Ends in: <strong className="text-foreground tabular-nums">{countdown}</strong>
                  </span>
                )}
              </div>
            </div>

            <Button size="lg" className="h-12 px-8 text-base font-semibold" onClick={() => setFormOpen(true)}>
              Enter giveaway
            </Button>

            <p className="text-xs text-muted-foreground">
              No purchase necessary. US shipping only. Must be 18+ to enter.
            </p>

            {giveaway.rules_text && (
              <details className="w-full max-w-xl text-left text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground transition-colors">
                  Official rules
                </summary>
                <div className="mt-3 whitespace-pre-wrap leading-relaxed border border-border/50 rounded-md p-4 bg-muted/30">
                  {giveaway.rules_text}
                </div>
              </details>
            )}

            <GiveawayEntryForm
              open={formOpen}
              onOpenChange={setFormOpen}
              giveawayId={giveaway.id}
              giveawayTitle={giveaway.title}
            />
          </div>
        )}
      </div>
    </div>
  );
}
