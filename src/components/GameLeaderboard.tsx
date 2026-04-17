import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLeaderboard, type LeaderboardPeriod } from "@/lib/games-store";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy } from "lucide-react";

interface Props {
  game: string;
  defaultPeriod?: LeaderboardPeriod;
  className?: string;
}

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "daily", label: "Today" },
  { value: "weekly", label: "This Week" },
  { value: "alltime", label: "All Time" },
];

export default function GameLeaderboard({ game, defaultPeriod = "weekly", className = "" }: Props) {
  const [period, setPeriod] = useState<LeaderboardPeriod>(defaultPeriod);
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["leaderboard", game, period],
    queryFn: () => getLeaderboard(game, period),
    staleTime: 30_000,
  });

  return (
    <div className={`rounded-xl border border-border bg-card ${className}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Leaderboard</h3>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-2 py-1 rounded-md transition-colors ${
                period === p.value
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[480px] overflow-y-auto">
        {isLoading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <Trophy className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No scores yet — play first!</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {data.map((row) => {
              const isMe = user?.id === row.user_id;
              return (
                <li
                  key={row.user_id + row.rank}
                  className={`grid grid-cols-[40px_1fr_auto] gap-3 items-center px-4 py-2.5 ${
                    isMe ? "bg-primary/5" : ""
                  }`}
                >
                  <span
                    className={`text-sm font-bold tabular-nums ${
                      row.rank === 1
                        ? "text-amber-400"
                        : row.rank === 2
                          ? "text-slate-300"
                          : row.rank === 3
                            ? "text-orange-400"
                            : "text-muted-foreground"
                    }`}
                  >
                    #{row.rank}
                  </span>
                  <span className="text-sm font-medium text-foreground truncate">
                    {row.username}
                    {isMe && <span className="ml-2 text-xs text-primary">(you)</span>}
                  </span>
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {row.score.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
