// One-time explainer shown the first time a user casts a sentiment vote.
// Mounted once globally (App.tsx); opens when castVote fires the
// SENTIMENT_INTRO_EVENT (see lib/sentiment-intro.ts). The "seen" flag is set in
// that util, so this just listens + renders.

import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SENTIMENT_INTRO_EVENT } from "@/lib/sentiment-intro";

export default function SentimentIntroDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onIntro = () => setOpen(true);
    window.addEventListener(SENTIMENT_INTRO_EVENT, onIntro);
    return () => window.removeEventListener(SENTIMENT_INTRO_EVENT, onIntro);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {/* Animated up/down demo */}
          <div className="flex items-center justify-center gap-3 mb-2">
            <span className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/15 text-emerald-400 animate-bounce">
              <ArrowUp className="w-6 h-6" />
            </span>
            <span
              className="flex items-center justify-center w-12 h-12 rounded-full bg-red-500/15 text-red-400 animate-bounce"
              style={{ animationDelay: "0.15s" }}
            >
              <ArrowDown className="w-6 h-6" />
            </span>
          </div>
          <DialogTitle className="text-center">Introducing sentiment voting</DialogTitle>
          <DialogDescription className="text-center">
            Sentiment voting is the community's best guess on whether a card is{" "}
            <span className="text-emerald-400 font-medium">undervalued</span> or{" "}
            <span className="text-red-400 font-medium">overvalued</span> at its
            current price. Tap <span className="text-emerald-400">▲</span> if you
            think it's a good buy, <span className="text-red-400">▼</span> if you
            think it's pricey. Your vote is anonymous — only the totals show.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => setOpen(false)} className="w-full">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
