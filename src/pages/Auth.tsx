import { useState, useEffect } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Particles } from "@/components/ui/particles";
import { useTheme } from "next-themes";
import SEO from "@/components/SEO";

export default function Auth() {
  const { user, loading } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [view, setView] = useState<"login" | "signup" | "forgot" | "recover">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isLogin = view === "login";

  // Supabase fires PASSWORD_RECOVERY when the user returns from a reset email
  // link. Switch to the "set a new password" view (and don't bounce them to
  // /dashboard before they've set it).
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setView("recover");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (user && view !== "recover") return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (view === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth` });
        if (error) throw error;
        toast.success("Check your email for a password reset link.");
        setView("login");
      } else if (view === "recover") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success("Password updated — you're signed in.");
        navigate("/dashboard", { replace: true });
      } else if (view === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back!");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account!");
      }
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
      <SEO
        title="Sign in to Collectiblez"
        description="Sign in or create a free Collectiblez account to start tracking your Pokémon TCG collection."
        path="/auth"
      />
      <Particles
        className="absolute inset-0 z-0"
        quantity={200}
        ease={80}
        color={theme === "dark" ? "#ffffff" : "#000000"}
        refresh
      />
      <div className="w-full max-w-sm relative z-10 bg-background/80 backdrop-blur-xl p-8 rounded-2xl border border-border/50 shadow-2xl shadow-primary/10">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link to="/" className="inline-flex flex-col items-center gap-2 mb-2">
            <img src="/logo.png" alt="Collectiblez" className="w-10 h-10 object-contain" />
            <span className="font-display font-bold text-lg text-foreground">Collectiblez</span>
          </Link>
          <h1 className="font-display font-bold text-2xl text-foreground mt-4">
            {view === "login" ? "Welcome back" : view === "signup" ? "Create your account" : view === "forgot" ? "Reset your password" : "Set a new password"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {view === "login" ? "Sign in to access your collection." : view === "signup" ? "Start tracking your Pokémon TCG collection." : view === "forgot" ? "Enter your email and we'll send a reset link." : "Choose a new password for your account."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {view !== "recover" && (
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="mt-1" />
            </div>
          )}
          {view !== "forgot" && (
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{view === "recover" ? "New password" : "Password"}</Label>
                {view === "login" && (
                  <button type="button" onClick={() => setView("forgot")} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                    Forgot password?
                  </button>
                )}
              </div>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} className="mt-1" />
            </div>
          )}
          <Button type="submit" className="w-full bg-foreground text-background hover:bg-foreground/90" disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {view === "login" ? "Sign In" : view === "signup" ? "Sign Up" : view === "forgot" ? "Send reset link" : "Update password"}
          </Button>
        </form>

        {(view === "login" || view === "signup") && (<>
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
          <div className="relative flex justify-center text-xs"><span className="bg-background px-2 text-muted-foreground">or</span></div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full hover:bg-muted hover:text-foreground"
          onClick={async () => {
            const { error } = await lovable.auth.signInWithOAuth("google", {
              redirect_uri: window.location.origin,
            });
            if (error) toast.error(error.message || "Google sign-in failed");
          }}
        >
          <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          Continue with Google
        </Button>
        </>)}

        <p className="text-center text-sm text-muted-foreground mt-6">
          {view === "forgot" || view === "recover" ? (
            <button type="button" onClick={() => setView("login")} className="text-foreground font-semibold hover:underline">
              Back to sign in
            </button>
          ) : (<>
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button type="button" onClick={() => setView(isLogin ? "signup" : "login")} className="text-foreground font-semibold hover:underline">
              {isLogin ? "Sign Up" : "Sign In"}
            </button>
          </>)}
        </p>
      </div>
    </div>
  );
}
