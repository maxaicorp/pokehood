import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import AppHeader from "@/components/AppHeader";
import GameLeaderboard from "@/components/GameLeaderboard";
import CurrentPrizeCard from "@/components/CurrentPrizeCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { startCardMatch, flipCard, type SlotCard } from "@/lib/games-store";
import { ArrowLeft, RotateCcw, Trophy, Clock, Target, Play, Pause, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

const SLOT_COUNT = 20;
const FLIP_ANIM_MS = 480; // keep in sync with .cm-flipper transition in index.css
// Time both no-match cards stay revealed before rotating back. Generous on
// purpose so the second card is comfortably readable even when the network
// roundtrip ate a chunk of perceived time.
const FLIP_BACK_DELAY_MS = 1800;

interface SlotState {
  card: SlotCard | null; // card data persists across flip-back so the image renders during rotation
  revealed: boolean;     // controls the rotateY(180deg) flip
  matched: boolean;
  flashing?: boolean;
}

function emptySlots(): SlotState[] {
  return Array.from({ length: SLOT_COUNT }, () => ({ card: null, revealed: false, matched: false }));
}

function preloadImages(urls: string[]) {
  for (const url of urls) {
    const img = new Image();
    img.src = url;
  }
}

// Awaits decode() on each URL with a hard cap so a slow image can't stall the
// flip. Used in the per-flip handler so the back face is paint-ready by the
// time the rotation begins — otherwise the card "barely shows up".
function decodeImagesCapped(urls: string[], capMs: number): Promise<void> {
  if (urls.length === 0) return Promise.resolve();
  const decodes = urls.map(
    (url) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.src = url;
        const done = () => resolve();
        if (typeof img.decode === "function") {
          img.decode().then(done, done);
        } else {
          img.onload = done;
          img.onerror = done;
        }
      }),
  );
  return Promise.race([
    Promise.all(decodes).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, capMs)),
  ]);
}

// Resolves once every URL has either loaded or errored. Prevents the board
// from rendering before the network has the images cached.
function preloadImagesAwait(urls: string[]): Promise<void> {
  if (urls.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let remaining = urls.length;
    const done = () => {
      remaining--;
      if (remaining === 0) resolve();
    };
    for (const url of urls) {
      const img = new Image();
      img.onload = done;
      img.onerror = done;
      img.src = url;
    }
  });
}

type Phase = "idle" | "loading" | "playing";

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
  const [phase, setPhase] = useState<Phase>("idle");
  const [paused, setPaused] = useState(false);
  // Wall-clock time when the current pause began (used to shift startedAt
  // forward by the pause duration on resume so the displayed timer continues
  // from where it stopped).
  const pauseStartRef = useRef<number | null>(null);

  // Tracks the active flip-back timer so we can cancel on unmount/restart.
  const flipBackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // State (not ref) so the disabled prop on the buttons actually re-renders.
  const [animating, setAnimating] = useState(false);

  const cancelFlipBack = useCallback(() => {
    if (flipBackTimer.current) {
      clearTimeout(flipBackTimer.current);
      flipBackTimer.current = null;
    }
    setAnimating(false);
  }, []);

  const startNewGame = useCallback(async () => {
    cancelFlipBack();
    setError(null);
    setCompletion(null);
    setSlots(emptySlots());
    setMatchedCount(0);
    setElapsed(0);
    setSessionId(null);
    setPaused(false);
    pauseStartRef.current = null;
    setPhase("loading");
    try {
      const session = await startCardMatch();
      // Preload all 10 unique card images before revealing the board so flips
      // don't race the network. Best-effort: we don't block on preload errors.
      if (session.image_urls && session.image_urls.length > 0) {
        await preloadImagesAwait(session.image_urls);
      }
      setSessionId(session.session_id);
      // Use a CLIENT-side start timestamp so the displayed timer begins at 0:00
      // the moment the board is revealed (after preload), not at session-insert
      // time on the server. The server still scores against its own clock.
      setStartedAt(Date.now());
      setPhase("playing");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start";
      setError(msg);
      setPhase("idle");
      toast.error(msg);
    }
  }, [cancelFlipBack]);

  const togglePause = useCallback(() => {
    if (phase !== "playing" || completion) return;
    setPaused((prev) => {
      if (!prev) {
        // Pausing: capture wall-clock now to compute elapsed pause duration.
        pauseStartRef.current = Date.now();
        return true;
      }
      // Resuming: shift startedAt forward by the pause duration so the
      // displayed elapsed time continues from where it left off.
      if (pauseStartRef.current != null && startedAt != null) {
        const pausedFor = Date.now() - pauseStartRef.current;
        setStartedAt(startedAt + pausedFor);
      }
      pauseStartRef.current = null;
      return false;
    });
  }, [phase, completion, startedAt]);

  // Redirect unauthenticated users; do NOT auto-start the game — show the
  // idle overlay so the player chooses when the timer begins.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      toast.info("Sign in to play");
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  const quitToGames = useCallback(() => {
    cancelFlipBack();
    setPhase("idle");
    setSessionId(null);
    setSlots(emptySlots());
    setMatchedCount(0);
    setElapsed(0);
    navigate("/games");
  }, [cancelFlipBack, navigate]);

  // Cleanup on unmount.
  useEffect(() => () => cancelFlipBack(), [cancelFlipBack]);

  // Elapsed clock — frozen while paused.
  useEffect(() => {
    if (!startedAt || completion || paused) return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(id);
  }, [startedAt, completion, paused]);

  const onFlip = async (slotIdx: number) => {
    if (!sessionId || busy || completion || animating || paused) return;
    if (slots[slotIdx].matched || slots[slotIdx].revealed) return;

    // OPTIMISTIC FLIP: start the rotation immediately so the user sees instant
    // feedback. The back face renders a loading shimmer until the server
    // returns the actual card, then we swap the image in (already preloaded
    // at session start, so the swap is paint-instant).
    setSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = { ...next[slotIdx], revealed: true };
      return next;
    });

    setBusy(true);
    try {
      const res = await flipCard(sessionId, slotIdx);

      if (res.match === true) {
        setSlots((prev) => {
          const next = [...prev];
          next[slotIdx] = { card: res.card, revealed: true, matched: true };
          if (res.otherSlot != null && res.otherCard) {
            next[res.otherSlot] = { card: res.otherCard, revealed: true, matched: true };
          }
          return next;
        });
        setMatchedCount((c) => c + 2);
        if (res.completed) {
          setCompletion(res.completed);
          queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
        }
      } else if (res.match === false) {
        // Reveal both face-up with red flash, lock input, then flip back.
        setAnimating(true);
        setSlots((prev) => {
          const next = [...prev];
          next[slotIdx] = { card: res.card, revealed: true, matched: false, flashing: true };
          if (res.otherSlot != null && res.otherCard) {
            next[res.otherSlot] = {
              card: res.otherCard,
              revealed: true,
              matched: false,
              flashing: true,
            };
          }
          return next;
        });
        const otherSlot = res.otherSlot;
        flipBackTimer.current = setTimeout(() => {
          flipBackTimer.current = null;
          // Drop the red flash + start rotating back. Keep `card` data so the
          // image stays visible on the back face during the rotation.
          setSlots((prev) => {
            const next = [...prev];
            if (!next[slotIdx].matched) {
              next[slotIdx] = { ...next[slotIdx], revealed: false, flashing: false };
            }
            if (otherSlot != null && !next[otherSlot].matched) {
              next[otherSlot] = { ...next[otherSlot], revealed: false, flashing: false };
            }
            return next;
          });
          // Release the input lock once the rotation has finished.
          setTimeout(() => setAnimating(false), FLIP_ANIM_MS);
        }, FLIP_BACK_DELAY_MS);
      } else {
        // First-of-pair: server returned the card — fill it in (slot is already revealed).
        setSlots((prev) => {
          const next = [...prev];
          next[slotIdx] = { ...next[slotIdx], card: res.card, revealed: true };
          return next;
        });
      }
    } catch (e) {
      // Rollback the optimistic reveal on error.
      setSlots((prev) => {
        const next = [...prev];
        if (!next[slotIdx].matched) {
          next[slotIdx] = { ...next[slotIdx], revealed: false };
        }
        return next;
      });
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

        <div className="cm-layout grid grid-cols-1 gap-6 lg:items-stretch">
          {/* Game */}
          <div>
            <div className="mb-4">
              <h1 className="font-display font-bold text-2xl text-foreground">Card Match</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Find all 10 pairs. Faster + fewer mistakes = higher score.
              </p>
            </div>

            {/* Mobile: 4 cols × 5 rows. Desktop: 5 cols × 4 rows. */}
            <div className="max-w-[420px] sm:max-w-[560px] mx-auto lg:mx-0">
              {/* Live stats + controls sit directly above the board so they read as part of it. */}
              <div className="flex items-center justify-between mb-2.5 px-1 gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    <span className="tabular-nums font-semibold text-foreground">{fmtTime(elapsed)}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Target className="w-3.5 h-3.5" />
                    <span className="tabular-nums font-semibold text-foreground">{matchedCount / 2}/10</span>
                  </span>
                </div>
                {phase === "playing" && !completion && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={togglePause}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                      aria-label={paused ? "Resume" : "Pause"}
                      title={paused ? "Resume" : "Pause"}
                    >
                      {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                      <span className="hidden sm:inline">{paused ? "Resume" : "Pause"}</span>
                    </button>
                    <button
                      onClick={startNewGame}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                      aria-label="Restart"
                      title="Restart"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Restart</span>
                    </button>
                    <button
                      onClick={quitToGames}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label="Quit"
                      title="Quit"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Quit</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Board area: always renders the grid so the overlay can sit on top of it. */}
              <div className="relative">
                {error ? (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
                    <p className="text-sm text-destructive font-medium break-words">{error}</p>
                    <Button onClick={startNewGame} variant="outline" className="mt-3">
                      Try again
                    </Button>
                  </div>
                ) : phase !== "playing" || !sessionId ? (
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 sm:gap-3">
                    {Array.from({ length: SLOT_COUNT }).map((_, i) => (
                      <Skeleton key={i} className="aspect-[2.5/3.5] rounded-lg" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 sm:gap-3">
                    {slots.map((s, i) => (
                      <SlotTile
                        key={i}
                        state={s}
                        onClick={() => onFlip(i)}
                        disabled={busy || !!completion || animating || paused}
                      />
                    ))}
                  </div>
                )}

                {/* Idle overlay: sits over the skeleton until the player presses Play. */}
                {!error && phase === "idle" && !completion && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm">
                    <div className="text-center px-4">
                      <div className="w-14 h-14 rounded-full bg-primary/15 text-primary flex items-center justify-center mx-auto mb-3">
                        <Play className="w-7 h-7 ml-0.5" />
                      </div>
                      <h2 className="font-display font-bold text-lg text-foreground">Ready to play?</h2>
                      <p className="text-xs text-muted-foreground mt-1 max-w-[260px] mx-auto">
                        Match all 10 pairs. The clock starts when you press Play.
                      </p>
                      <Button onClick={startNewGame} className="mt-4 px-6">
                        <Play className="w-4 h-4 mr-2" />
                        Play Now
                      </Button>
                    </div>
                  </div>
                )}

                {/* Loading overlay: while images preload after Play is pressed. */}
                {!error && phase === "loading" && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm">
                    <div className="text-center">
                      <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
                      <p className="text-xs text-muted-foreground mt-3">Preparing cards…</p>
                    </div>
                  </div>
                )}

                {/* Pause overlay: dims the board so the player can't read positions. */}
                {phase === "playing" && paused && !completion && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/85 backdrop-blur-md">
                    <div className="text-center">
                      <div className="w-14 h-14 rounded-full bg-primary/15 text-primary flex items-center justify-center mx-auto mb-3">
                        <Pause className="w-7 h-7" />
                      </div>
                      <h2 className="font-display font-bold text-lg text-foreground">Paused</h2>
                      <p className="text-xs text-muted-foreground mt-1">Timer is stopped.</p>
                      <Button onClick={togglePause} className="mt-4 px-6">
                        <Play className="w-4 h-4 mr-2" />
                        Resume
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Leaderboard column */}
          <div className="space-y-4 lg:h-full">
            <GameLeaderboard game="card-match" className="lg:h-full" />
          </div>

          {/* Prize column */}
          <div className="space-y-4 lg:h-full">
            <CurrentPrizeCard game="card-match" className="lg:h-full lg:flex lg:flex-col" />
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
  const { revealed, matched, flashing, card } = state;
  const ringClass = matched
    ? "ring-2 ring-emerald-500/60"
    : flashing
      ? "ring-2 ring-red-500/60"
      : revealed
        ? "ring-1 ring-border"
        : "ring-1 ring-primary/30 hover:ring-primary/60";
  const hoverClass = revealed || matched ? "" : "hover:scale-[1.02] active:scale-[0.98]";

  return (
    <button
      onClick={onClick}
      disabled={disabled || matched || revealed}
      className={`cm-slot group relative aspect-[2.5/3.5] rounded-lg transition-transform ${ringClass} ${hoverClass}`}
    >
      <div className={`cm-flipper ${revealed ? "is-flipped" : ""}`}>
        {/* Front face: card back with logo */}
        <div className="cm-face">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-primary/10 to-background" />
          <div
            className="absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, hsl(var(--primary) / 0.25) 0%, transparent 65%)",
            }}
          />
          <div className="absolute inset-1.5 rounded-md border border-primary/25 group-hover:border-primary/50 transition-colors" />
          <div className="absolute inset-0 flex items-center justify-center">
            <img
              src="/logo.png"
              alt=""
              className="w-1/2 h-1/2 object-contain opacity-80 drop-shadow-[0_2px_6px_hsl(var(--primary)/0.4)] group-hover:opacity-100 transition-opacity"
              draggable={false}
            />
          </div>
        </div>
        {/* Back face: the actual card image (kept mounted during flip-back so it stays visible during rotation) */}
        <div className="cm-face cm-face-back">
          {card && (
            <img
              src={card.image_small}
              alt={card.name}
              className="absolute inset-0 w-full h-full object-cover"
              draggable={false}
            />
          )}
        </div>
      </div>
    </button>
  );
}
