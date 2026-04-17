import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import AppHeader from "@/components/AppHeader";
import GameLeaderboard from "@/components/GameLeaderboard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { startCardMatch, flipCard, type SlotCard } from "@/lib/games-store";
import { ArrowLeft, RotateCcw, Trophy, Clock, Target } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

const SLOT_COUNT = 20;
const FLIP_BACK_DELAY_MS = 900;

interface SlotState {
  card: SlotCard | null; // null = face-down
  matched: boolean;
  flashing?: boolean;
}

function emptySlots(): SlotState[] {
  return Array.from({ length: SLOT_COUNT }, () => ({ card: null, matched: false }));
}

export default function CardMatch() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [slots, setSlots] = useState<SlotState[]>(emptySlots());
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [completion, setCompletion] = useState<{ score: number; duration_ms: number; wrong_flips: number } | null>(null);
  const [matchedCount, setMatchedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const startNewGame = useCallback(async () => {
    setError(null);
    setCompletion(null);
    setSlots(emptySlots());
    setMatchedCount(0);
    setElapsed(0);
    try {
      const session = await startCardMatch();
      setSessionId(session.session_id);
      setStartedAt(new Date(session.started_at).getTime());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start";
      setError(msg);
      toast.error(msg);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      toast.info("Sign in to play");
      navigate("/auth");
      return;
    }
    startNewGame();
  }, [user, authLoading, navigate, startNewGame]);

  // Elapsed clock
  useEffect(() => {
    if (!startedAt || completion) return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(id);
  }, [startedAt, completion]);

  const onFlip = async (slotIdx: number) => {
    if (!sessionId || busy || completion) return;
    if (slots[slotIdx].matched || slots[slotIdx].card) return;
    setBusy(true);
    try {
      const res = await flipCard(sessionId, slotIdx);
      // Reveal the clicked slot
      setSlots((prev) => {
        const next = [...prev];
        next[slotIdx] = { ...next[slotIdx], card: res.card };
        return next;
      });

      if (res.match === true) {
        // Mark both as matched
        setSlots((prev) => {
          const next = [...prev];
          next[slotIdx] = { card: res.card, matched: true };
          if (res.otherSlot != null && res.otherCard) {
            next[res.otherSlot] = { card: res.otherCard, matched: true };
          }
          return next;
        });
        setMatchedCount((c) => c + 2);
        if (res.completed) {
          setCompletion(res.completed);
          // Refresh leaderboard
          queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
        }
      } else if (res.match === false) {
        // Flash both, then flip back
        setSlots((prev) => {
          const next = [...prev];
          next[slotIdx] = { card: res.card, matched: false, flashing: true };
          if (res.otherSlot != null && res.otherCard) {
            next[res.otherSlot] = { card: res.otherCard, matched: false, flashing: true };
          }
          return next;
        });
        setTimeout(() => {
          setSlots((prev) => {
            const next = [...prev];
            if (!next[slotIdx].matched) next[slotIdx] = { card: null, matched: false };
            if (res.otherSlot != null && !next[res.otherSlot].matched) {
              next[res.otherSlot] = { card: null, matched: false };
            }
            return next;
          });
        }, FLIP_BACK_DELAY_MS);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Flip failed";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const fmtTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <AppHeader activePage="games" />
      <div className="container py-6 px-4 sm:px-8">
        <button
          onClick={() => navigate("/games")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Games
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Game */}
          <div>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <h1 className="font-display font-bold text-2xl text-foreground">Card Match</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Find all 10 pairs. Faster + fewer mistakes = higher score.
                </p>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="tabular-nums font-medium text-foreground">{fmtTime(elapsed)}</span>
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Target className="w-3.5 h-3.5" />
                  <span className="tabular-nums font-medium text-foreground">{matchedCount / 2}/10</span>
                </span>
              </div>
            </div>

            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
                <p className="text-sm text-destructive font-medium">{error}</p>
                <Button onClick={startNewGame} variant="outline" className="mt-3">
                  Try again
                </Button>
              </div>
            ) : !sessionId ? (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 sm:gap-3">
                {Array.from({ length: SLOT_COUNT }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[2.5/3.5] rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 sm:gap-3">
                {slots.map((s, i) => (
                  <SlotTile key={i} state={s} onClick={() => onFlip(i)} disabled={busy || !!completion} />
                ))}
              </div>
            )}
          </div>

          {/* Side panel */}
          <div className="space-y-4">
            <GameLeaderboard game="card-match" />
          </div>
        </div>
      </div>

      {/* Completion modal */}
      <AnimatePresence>
        {completion && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="rounded-2xl bg-card border border-border p-8 max-w-sm w-full text-center"
            >
              <div className="w-14 h-14 rounded-full bg-primary/15 text-primary flex items-center justify-center mx-auto mb-3">
                <Trophy className="w-7 h-7" />
              </div>
              <h2 className="font-display font-bold text-2xl text-foreground">Round complete!</h2>
              <p className="text-4xl font-bold text-primary tabular-nums mt-3">
                {completion.score.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground mt-1">points</p>
              <div className="flex items-center justify-center gap-6 mt-5 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Time</p>
                  <p className="font-semibold tabular-nums">{fmtTime(completion.duration_ms)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Misses</p>
                  <p className="font-semibold tabular-nums">{completion.wrong_flips}</p>
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <Button onClick={startNewGame} className="flex-1">
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Play again
                </Button>
                <Button onClick={() => navigate("/games")} variant="outline" className="flex-1">
                  Done
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SlotTile({
  state,
  onClick,
  disabled,
}: {
  state: SlotState;
  onClick: () => void;
  disabled: boolean;
}) {
  const showCard = state.card !== null;
  return (
    <button
      onClick={onClick}
      disabled={disabled || state.matched || showCard}
      className={`relative aspect-[2.5/3.5] rounded-lg overflow-hidden transition-all ${
        state.matched
          ? "ring-2 ring-emerald-500/60 opacity-90"
          : state.flashing
            ? "ring-2 ring-red-500/60"
            : showCard
              ? "ring-1 ring-border"
              : "bg-gradient-to-br from-primary/20 via-primary/10 to-background border border-border hover:border-primary/40"
      }`}
    >
      {showCard && state.card ? (
        <img
          src={state.card.image_small}
          alt={state.card.name}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-primary/20 border border-primary/40" />
        </div>
      )}
    </button>
  );
}
