import { Link } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import { Gamepad2, Trophy } from "lucide-react";
import SEO from "@/components/SEO";

export default function Games() {
  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <SEO
        title="Pokémon TCG Mini-Games & Weekly Prizes — Collectiblez"
        description="Play Pokémon-themed mini-games and climb the weekly leaderboard for a chance to win real Pokémon TCG prizes."
        path="/games"
      />
      <AppHeader activePage="games" />
      <div className="container py-10 px-4 sm:px-8 max-w-5xl">
        <div className="mb-8">
          <h1 className="font-display font-bold text-3xl text-foreground">Games</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Play to top the weekly leaderboard. Top score each week wins a real Pokémon prize.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            to="/games/card-match"
            className="group rounded-xl border border-border bg-card p-5 hover:border-primary/40 transition-colors"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Gamepad2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display font-semibold text-foreground">Card Match</h2>
                <p className="text-xs text-muted-foreground">Memory · Skill</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Flip face-down cards to find pairs. Fastest with the fewest mistakes wins.
            </p>
          </Link>

          <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-5 flex items-center justify-center text-center">
            <div>
              <Trophy className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">More games coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
