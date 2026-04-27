import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import AdminLayout from "./AdminLayout";
import { listGiveaways, type Giveaway } from "@/lib/giveaway-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT: Record<Giveaway["status"], "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  active: "default",
  closed: "outline",
  drawn: "outline",
};

export default function AdminGiveaways() {
  const { data: giveaways, isLoading } = useQuery({
    queryKey: ["admin-giveaways"],
    queryFn: listGiveaways,
  });

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Giveaways</h1>
        <Button asChild>
          <Link to="/admin/giveaways/new">+ New</Link>
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !giveaways?.length ? (
        <div className="rounded-lg border border-border/50 p-8 text-center text-muted-foreground">
          <p className="mb-3">No giveaways yet.</p>
          <Button asChild>
            <Link to="/admin/giveaways/new">Create your first giveaway</Link>
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Title</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Ends</th>
                <th className="text-right px-4 py-2.5 font-medium">Value</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {giveaways.map((g) => (
                <tr key={g.id} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <Link to={`/admin/giveaways/${g.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                      {g.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[g.status]} className="capitalize">{g.status}</Badge>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell tabular-nums text-muted-foreground">
                    {new Date(g.ends_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {g.estimated_value_usd != null ? `$${Number(g.estimated_value_usd).toLocaleString()}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link to={`/admin/giveaways/${g.id}`}>Open</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
