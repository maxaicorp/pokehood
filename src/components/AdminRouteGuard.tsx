import { ReactNode, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function AdminRouteGuard({ children }: { children: ReactNode }) {
  const { user, isAdmin, loading, adminChecked } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      toast.info("Sign in required");
      navigate("/auth");
      return;
    }
    // CRITICAL: wait for adminChecked before deciding. Without this, the
    // ~200ms window between session arrival and the has_role RPC resolving
    // makes `isAdmin === false` for every freshly-loaded admin user and
    // kicks them to /. Verified 2026-05-20 from a user report.
    if (!adminChecked) return;
    if (!isAdmin) {
      toast.error("Not authorized");
      navigate("/");
    }
  }, [user, isAdmin, loading, adminChecked, navigate]);

  if (loading || !user || !adminChecked || !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <span className="w-6 h-6 animate-spin border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return <>{children}</>;
}
