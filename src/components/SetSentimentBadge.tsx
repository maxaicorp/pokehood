import { ThumbsUp, ThumbsDown } from "lucide-react";
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

export default function SetSentimentBadge({
  upvotes,
  downvotes,
  score,
  currentUserVote,
  onVote,
  compact = false,
}: SetSentimentBadgeProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-lg border border-border/50 bg-muted/30 overflow-hidden",
        compact ? "text-[10px]" : "text-xs"
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onVote("up");
        }}
        className={cn(
          "flex items-center gap-0.5 px-1.5 py-1 transition-colors hover:bg-emerald-500/10",
          currentUserVote === "up"
            ? "text-emerald-400 bg-emerald-500/15"
            : "text-muted-foreground hover:text-emerald-400"
        )}
        aria-label="Upvote set"
      >
        <ThumbsUp className={cn(compact ? "w-3 h-3" : "w-3.5 h-3.5")} />
        {upvotes > 0 && (
          <span className="tabular-nums font-medium">{upvotes}</span>
        )}
      </button>

      <div
        className={cn(
          "px-1 py-1 font-bold tabular-nums border-x border-border/30 min-w-[20px] text-center",
          score > 0
            ? "text-emerald-400"
            : score < 0
            ? "text-red-400"
            : "text-muted-foreground"
        )}
      >
        {score > 0 ? `+${score}` : score}
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onVote("down");
        }}
        className={cn(
          "flex items-center gap-0.5 px-1.5 py-1 transition-colors hover:bg-red-500/10",
          currentUserVote === "down"
            ? "text-red-400 bg-red-500/15"
            : "text-muted-foreground hover:text-red-400"
        )}
        aria-label="Downvote set"
      >
        <ThumbsDown className={cn(compact ? "w-3 h-3" : "w-3.5 h-3.5")} />
        {downvotes > 0 && (
          <span className="tabular-nums font-medium">{downvotes}</span>
        )}
      </button>
    </div>
  );
}
