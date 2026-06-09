import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { STRIPE_CONFIG, FREE_TIER_LIMITS, PRO_TIER_LIMITS } from "@/lib/stripe-config";

interface SubscriptionInfo {
  subscribed: boolean;
  productId: string | null;
  subscriptionEnd: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  subscription: SubscriptionInfo;
  isPro: boolean;
  isAdmin: boolean;
  // True once the has_role RPC has returned for the current session. Guards
  // that gate on isAdmin (e.g. AdminRouteGuard) must wait on this — otherwise
  // they redirect during the ~200ms window between session arrival and the
  // RPC resolving, kicking real admins out to the home page.
  adminChecked: boolean;
  limits: typeof FREE_TIER_LIMITS | typeof PRO_TIER_LIMITS;
  checkSubscription: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionInfo>({
    subscribed: false,
    productId: null,
    subscriptionEnd: null,
  });

  const checkSubscription = useCallback(async () => {
    if (!session) {
      setSubscription({ subscribed: false, productId: null, subscriptionEnd: null });
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("check-subscription");
      if (error) throw error;
      setSubscription({
        subscribed: data?.subscribed ?? false,
        productId: data?.product_id ?? null,
        subscriptionEnd: data?.subscription_end ?? null,
      });
    } catch (err) {
      console.error("Failed to check subscription:", err);
    }
  }, [session]);

  useEffect(() => {
    // onAuthStateChange fires an INITIAL_SESSION event on subscribe, so it's
    // sufficient as the sole source of truth. We intentionally do NOT also
    // call getSession() here: when it resolves with `null` slightly before
    // INITIAL_SESSION arrives with the real session, `loading` flips to false
    // with `user=null`, and route guards like AdminRouteGuard fire a redirect
    // to /auth before the real session lands — kicking real admins off pages
    // like /vault even though has_role would have returned true. Verified
    // 2026-06-09 from a /vault redirect report (Vault chunk was never fetched).
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => authSub.unsubscribe();
  }, []);

  // Check subscription + admin role when session changes
  useEffect(() => {
    if (session) {
      checkSubscription();
      // Reset adminChecked before each new lookup so guards know to wait again
      // (covers fast user-switch scenarios where the old `true` would stick).
      setAdminChecked(false);
      (async () => {
        try {
          const { data } = await supabase.rpc("has_role", { _user_id: session.user.id, _role: "admin" });
          setIsAdmin(!!data);
        } catch {
          setIsAdmin(false);
        } finally {
          setAdminChecked(true);
        }
      })();
    } else {
      setSubscription({ subscribed: false, productId: null, subscriptionEnd: null });
      setIsAdmin(false);
      // Only mark the admin question "settled" once we definitively know there
      // is no session (loading has resolved). On initial mount session is null
      // by default; if we flipped adminChecked=true here, AdminRouteGuard
      // would briefly see (user=truthy from incoming session) + adminChecked=true
      // + isAdmin=false in the render between session arriving and this effect
      // re-running, and would redirect real admins away. Verified 2026-06-09.
      if (!loading) setAdminChecked(true);
    }
  }, [session, checkSubscription, loading]);

  // Periodic refresh every 60s
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(checkSubscription, 60_000);
    return () => clearInterval(interval);
  }, [session, checkSubscription]);

  const isPro = isAdmin || (subscription.subscribed && subscription.productId === STRIPE_CONFIG.pro.product_id);
  const limits = isPro ? PRO_TIER_LIMITS : FREE_TIER_LIMITS;

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setSubscription({ subscribed: false, productId: null, subscriptionEnd: null });
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, subscription, isPro, isAdmin, adminChecked, limits, checkSubscription, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
