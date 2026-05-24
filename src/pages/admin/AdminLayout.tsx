import { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import AdminRouteGuard from "@/components/AdminRouteGuard";
import { Gift, Trophy, LayoutDashboard, Activity, Code } from "lucide-react";

const NAV = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/admin/health", label: "System health", icon: Activity },
  { to: "/admin/functions", label: "Edge functions", icon: Code },
  { to: "/admin/giveaways", label: "Giveaways", icon: Gift },
  { to: "/admin/prizes", label: "Game Prizes", icon: Trophy },
];

function NavItem({ to, label, icon: Icon, end }: { to: string; label: string; icon: typeof Gift; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          isActive
            ? "bg-primary/10 text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        }`
      }
    >
      <Icon className="w-4 h-4" />
      {label}
    </NavLink>
  );
}

interface Props { children?: ReactNode }

export default function AdminLayout({ children }: Props) {
  return (
    <AdminRouteGuard>
      <div className="min-h-screen bg-background pb-20 sm:pb-0">
        <AppHeader activePage={"market" as any} />
        <div className="container max-w-6xl py-6 px-4 sm:px-8">
          <div className="grid gap-6 sm:grid-cols-[200px_1fr]">
            <aside className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 mb-2">
                Admin
              </p>
              {NAV.map((n) => (
                <NavItem key={n.to} {...n} />
              ))}
            </aside>
            <main className="min-w-0">
              {children ?? <Outlet />}
            </main>
          </div>
        </div>
      </div>
    </AdminRouteGuard>
  );
}
