import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoteType, SetSentiment } from "@/lib/sentiment-store";

interface Props {
  sentiment: SetSentiment | null;
  onVote: (voteType: VoteType) => void;
}

export default function CardSentimentWidget({ sentiment, onVote }: Props) {
  const upvotes = sentiment?.upvotes ?? 0;
  const downvotes = sentiment?.downvotes ?? 0;
  const total = upvotes + downvotes;
  const bullishPct = total > 0 ? (upvotes / total) * 100 : 50;
  const bearishPct = 100 - bullishPct;
  const currentVote = sentiment?.currentUserVote ?? null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-foreground">Community Sentiment</p>
        {total > 0 && (
          <span className="text-xs text-muted-foreground">
            {total} vote{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {total > 0 ? (
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-green-400 font-medium">{bullishPct.toFixed(0)}% Bullish</span>
            <span className="text-red-400 font-medium">{bearishPct.toFixed(0)}% Bearish</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-red-500/25 flex">
            <div
              className="h-full bg-green-500 transition-all duration-500"
              style={{ width: `${bullishPct}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center mb-3">Be the first to vote!</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onVote("up")}
          className={cn(
            "flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium border transition-colors",
            currentVote === "up"
              ? "bg-green-500/15 border-green-500/40 text-green-400"
              : "border-border/50 text-muted-foreground hover:bg-green-500/10 hover:border-green-500/30 hover:text-green-400"
          )}
        >
          <ArrowUp className="w-4 h-4" />
          Bullish
          {upvotes > 0 && <span className="text-xs opacity-60 tabular-nums">{upvotes}</span>}
        </button>
        <button
          onClick={() => onVote("down")}
          className={cn(
            "flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium border transition-colors",
            currentVote === "down"
              ? "bg-red-500/15 border-red-500/40 text-red-400"
              : "border-border/50 text-muted-foreground hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400"
          )}
        >
          <ArrowDown className="w-4 h-4" />
          Bearish
          {downvotes > 0 && <span className="text-xs opacity-60 tabular-nums">{downvotes}</span>}
        </button>
      </div>
    </div>
  );
}
