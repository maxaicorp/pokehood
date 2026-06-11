import { forwardRef, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoteType } from "@/lib/sentiment-store";

interface SetSentimentBadgeProps {
  upvotes: number;
  downvotes: number;
  score: number;
  currentUserVote: VoteType | null;
  onVote: (voteType: VoteType) => void;
  compact?: boolean;
}

const SetSentimentBadge = forwardRef<HTMLDivElement, SetSentimentBadgeProps>(function SetSentimentBadge({
  upvotes,
  downvotes,
  score,
  currentUserVote,
  onVote,
  compact = false,
}, ref) {
  // Brief scale-pop on the clicked arrow for tactile feedback.
  const [pop, setPop] = useState<VoteType | null>(null);
  const handleVote = (vt: VoteType, e: React.MouseEvent) => {
    e.stopPropagation();
    setPop(vt);
    setTimeout(() => setPop(null), 300);
    onVote(vt);
  };
  const buttonClasses = compact ? "gap-0.5 px-1.5 py-1" : "gap-1 px-2 py-1";
  const iconClasses = compact ? "w-3 h-3" : "w-3.5 h-3.5";
  const countClasses = compact ? "min-w-[12px]" : "min-w-[14px]";

  return (
    <div
      ref={ref}
      className={cn(
        "flex shrink-0 items-center rounded-lg border border-border/50 bg-muted/30 overflow-hidden whitespace-nowrap",
        compact ? "gap-0 text-[10px]" : "gap-1 text-xs"
      )}
      onClick={(e) => e.stopPropagation()}
      data-score={score}
    >
      <button
        onClick={(e) => handleVote("up", e)}
        className={cn(
          "flex shrink-0 items-center transition-colors hover:bg-emerald-500/10",
          buttonClasses,
          currentUserVote === "up"
            ? "text-emerald-400 bg-emerald-500/15"
            : "text-muted-foreground hover:text-emerald-400"
        )}
        aria-label="Upvote"
      >
        <ArrowUp className={cn(iconClasses, "transition-transform duration-200", pop === "up" && "scale-[1.6] -translate-y-0.5")} />
        <span className={cn("tabular-nums font-medium text-center", countClasses)}>{upvotes}</span>
      </button>

      <div className="w-px h-4 shrink-0 bg-border/50" />

      <button
        onClick={(e) => handleVote("down", e)}
        className={cn(
          "flex shrink-0 items-center transition-colors hover:bg-red-500/10",
          buttonClasses,
          currentUserVote === "down"
            ? "text-red-400 bg-red-500/15"
            : "text-muted-foreground hover:text-red-400"
        )}
        aria-label="Downvote"
      >
        <ArrowDown className={cn(iconClasses, "transition-transform duration-200", pop === "down" && "scale-[1.6] translate-y-0.5")} />
        <span className={cn("tabular-nums font-medium text-center", countClasses)}>{downvotes}</span>
      </button>
    </div>
  );
});

export default SetSentimentBadge;
