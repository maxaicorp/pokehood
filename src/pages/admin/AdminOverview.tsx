import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import AdminLayout from "./AdminLayout";
import { listGiveaways } from "@/lib/giveaway-store";
import { supabase } from "@/integrations/supabase/client";
import { Gift, Mail, Trophy, Activity, CheckCircle2, AlertTriangle, Newspaper, Video } from "lucide-react";

function StatCard({ icon: Icon, label, value, to }: { icon: typeof Gift; label: string; value: number | string; to: string }) {
  return (
    <Link
      to={to}
      className="block rounded-lg border border-border/50 p-4 hover:border-primary/40 hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-center gap-2 mb-2 text-muted-foreground">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </Link>
  );
}

export default function AdminOverview() {
  const { data: giveaways } = useQuery({
    queryKey: ["admin-giveaways"],
    queryFn: listGiveaways,
  });
  const { data: pendingCount } = useQuery({
    queryKey: ["admin-pending-entries"],
    queryFn: async () => {
      const { count } = await (supabase.from as any)("giveaway_entries")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      return count ?? 0;
    },
  });
  const { data: confirmedCount } = useQuery({
    queryKey: ["admin-confirmed-entries"],
    queryFn: async () => {
      const { count } = await (supabase.from as any)("giveaway_entries")
        .select("*", { count: "exact", head: true })
        .eq("status", "confirmed");
      return count ?? 0;
    },
  });

  const { data: health } = useQuery({
    queryKey: ["admin-health-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("health-check");
      if (error) return null;
      return data as { healthy: boolean; checks: Record<string, { ok: boolean }> };
    },
    staleTime: 60_000,
  });

  const activeGiveaways = giveaways?.filter((g) => g.status === "active").length ?? 0;
  const failingChecks = health
    ? Object.values(health.checks).filter((c) => !c.ok).length
    : null;

  return (
    <AdminLayout>
      <h1 className="text-2xl font-bold mb-6">Admin overview</h1>

      <Link
        to="/admin/health"
        className={`block rounded-lg border p-4 mb-6 transition-colors ${
          health == null
            ? "border-border/50 hover:border-primary/40"
            : health.healthy
            ? "border-green-500/30 bg-green-500/5 hover:bg-green-500/10"
            : "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10"
        }`}
      >
        <div className="flex items-center gap-3">
          {health == null ? (
            <Activity className="w-5 h-5 text-muted-foreground" />
          ) : health.healthy ? (
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">
              {health == null
                ? "System health — loading…"
                : health.healthy
                ? "All systems operational"
                : `${failingChecks} check${failingChecks === 1 ? "" : "s"} failing`}
            </p>
            <p className="text-xs text-muted-foreground">View full report →</p>
          </div>
        </div>
      </Link>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Gift} label="Active giveaways" value={activeGiveaways} to="/admin/giveaways" />
        <StatCard icon={Mail} label="Confirmed entries" value={confirmedCount ?? "…"} to="/admin/giveaways" />
        <StatCard icon={Mail} label="Pending entries" value={pendingCount ?? "…"} to="/admin/giveaways" />
      </div>

      <h2 className="text-lg font-semibold mt-10 mb-3">Quick links</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        <Link to="/admin/giveaways/new" className="rounded-md border border-border/50 px-4 py-3 hover:border-primary/40 hover:bg-muted/30 transition-colors text-sm">
          + Create giveaway
        </Link>
        <Link to="/admin/prizes" className="rounded-md border border-border/50 px-4 py-3 hover:border-primary/40 hover:bg-muted/30 transition-colors text-sm flex items-center gap-2">
          <Trophy className="w-4 h-4" /> Manage game prizes
        </Link>
        <Link to="/admin/content-signals" className="rounded-md border border-border/50 px-4 py-3 hover:border-primary/40 hover:bg-muted/30 transition-colors text-sm flex items-center gap-2">
          <Newspaper className="w-4 h-4" /> Content signals
        </Link>
        <Link to="/admin/video-studio" className="rounded-md border border-border/50 px-4 py-3 hover:border-primary/40 hover:bg-muted/30 transition-colors text-sm flex items-center gap-2">
          <Video className="w-4 h-4" /> Video Studio
        </Link>
        <Link to="/admin/health" className="rounded-md border border-border/50 px-4 py-3 hover:border-primary/40 hover:bg-muted/30 transition-colors text-sm flex items-center gap-2">
          <Activity className="w-4 h-4" /> System health
        </Link>
      </div>
    </AdminLayout>
  );
}
