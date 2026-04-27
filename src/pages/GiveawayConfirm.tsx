import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { confirmGiveawayEntry } from "@/lib/giveaway-store";

type State =
  | { kind: "loading" }
  | { kind: "success"; alreadyConfirmed: boolean; fullName?: string }
  | { kind: "error"; message: string };

export default function GiveawayConfirmPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "error", message: "Missing confirmation token. The link may be incomplete." });
      return;
    }
    let cancelled = false;
    confirmGiveawayEntry(token).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setState({
          kind: "success",
          alreadyConfirmed: !!res.already_confirmed,
          fullName: res.full_name,
        });
      } else {
        setState({ kind: "error", message: res.error ?? "Could not confirm your entry" });
      }
    });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <AppHeader activePage={"market" as any} />
      <div className="container max-w-md py-16 px-4 sm:px-8">
        <div className="flex flex-col items-center text-center gap-5">
          {state.kind === "loading" && (
            <>
              <span className="w-8 h-8 animate-spin border-2 border-primary border-t-transparent rounded-full" />
              <p className="text-muted-foreground">Confirming your entry…</p>
            </>
          )}
          {state.kind === "success" && (
            <>
              <CheckCircle2 className="w-14 h-14 text-emerald-500" />
              <h1 className="text-2xl font-bold">
                {state.alreadyConfirmed ? "You're already in!" : "You're entered!"}
              </h1>
              <p className="text-muted-foreground max-w-sm">
                {state.alreadyConfirmed
                  ? "Your entry was already confirmed. Sit tight — we'll email the winner."
                  : `Thanks${state.fullName ? `, ${state.fullName.split(" ")[0]}` : ""}. Your entry is locked in. We'll email the winner once the giveaway ends.`}
              </p>
              <Button asChild>
                <Link to="/">Back to Collectiblez</Link>
              </Button>
            </>
          )}
          {state.kind === "error" && (
            <>
              <AlertTriangle className="w-12 h-12 text-destructive" />
              <h1 className="text-2xl font-bold">Couldn't confirm</h1>
              <p className="text-muted-foreground max-w-sm">{state.message}</p>
              <Button asChild variant="outline">
                <Link to="/giveaway">Back to giveaway</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
