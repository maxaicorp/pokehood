import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "./AdminLayout";
import PrizeCard from "@/components/PrizeCard";
import {
  getGiveaway,
  createGiveaway,
  updateGiveaway,
  deleteGiveaway,
  uploadGiveawayImage,
  listEntries,
  drawWinner,
  updateEntryStatus,
  type Giveaway,
  type GiveawayEntry,
} from "@/lib/giveaway-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, Trash2, Trophy } from "lucide-react";

function toDatetimeLocal(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  // toISOString minus seconds + Z, in local time
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(local: string): string {
  return new Date(local).toISOString();
}

export default function AdminGiveawayForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: existing, isLoading } = useQuery({
    queryKey: ["admin-giveaway", id],
    queryFn: () => (isNew ? Promise.resolve(null) : getGiveaway(id!)),
    enabled: !isNew,
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [estValue, setEstValue] = useState<string>("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [status, setStatus] = useState<Giveaway["status"]>("draft");
  const [rulesText, setRulesText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) {
      setTitle(existing.title);
      setDescription(existing.description ?? "");
      setImageUrl(existing.prize_image_url);
      setEstValue(existing.estimated_value_usd?.toString() ?? "");
      setStartsAt(toDatetimeLocal(existing.starts_at));
      setEndsAt(toDatetimeLocal(existing.ends_at));
      setStatus(existing.status);
      setRulesText(existing.rules_text ?? "");
    } else if (isNew) {
      // Default new giveaway: starts now, ends in 7 days
      const now = new Date();
      const week = new Date(Date.now() + 7 * 86_400_000);
      setStartsAt(toDatetimeLocal(now.toISOString()));
      setEndsAt(toDatetimeLocal(week.toISOString()));
    }
  }, [existing, isNew]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadGiveawayImage(file);
      setImageUrl(url);
      toast.success("Image uploaded");
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = ""; // allow re-uploading the same filename
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Partial<Giveaway> = {
        title: title.trim(),
        description: description.trim() || null,
        prize_image_url: imageUrl,
        estimated_value_usd: estValue ? Number(estValue) : null,
        starts_at: fromDatetimeLocal(startsAt),
        ends_at: fromDatetimeLocal(endsAt),
        status,
        rules_text: rulesText.trim() || null,
      };
      if (isNew) {
        const created = await createGiveaway(payload);
        toast.success("Giveaway created");
        qc.invalidateQueries({ queryKey: ["admin-giveaways"] });
        if (created) navigate(`/admin/giveaways/${created.id}`);
      } else {
        await updateGiveaway(id!, payload);
        toast.success("Saved");
        qc.invalidateQueries({ queryKey: ["admin-giveaway", id] });
        qc.invalidateQueries({ queryKey: ["admin-giveaways"] });
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !confirm("Delete this giveaway permanently? This will remove all its entries.")) return;
    try {
      await deleteGiveaway(id);
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin-giveaways"] });
      navigate("/admin/giveaways");
    } catch (err: any) {
      toast.error(err?.message ?? "Delete failed");
    }
  };

  const handleDraw = async () => {
    if (!id || !confirm("Pick a random winner from confirmed entries?")) return;
    try {
      const winner = await drawWinner(id);
      if (!winner) {
        toast.error("No confirmed entries to draw from");
        return;
      }
      toast.success(`Winner: ${winner.full_name}`);
      qc.invalidateQueries({ queryKey: ["admin-giveaway", id] });
    } catch (err: any) {
      toast.error(err?.message ?? "Draw failed");
    }
  };

  if (!isNew && isLoading) {
    return <AdminLayout><p className="text-sm text-muted-foreground">Loading…</p></AdminLayout>;
  }

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 gap-4">
        <h1 className="text-2xl font-bold truncate">
          {isNew ? "New giveaway" : title || "Untitled"}
        </h1>
        {!isNew && existing && (
          <Badge variant={existing.status === "active" ? "default" : "secondary"} className="capitalize">
            {existing.status}
          </Badge>
        )}
      </div>

      <form onSubmit={handleSave} className="grid gap-6 sm:grid-cols-[1fr_240px]">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="desc">Description</Label>
            <Textarea id="desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="starts">Starts</Label>
              <Input id="starts" type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ends">Ends</Label>
              <Input id="ends" type="datetime-local" required value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="value">Estimated value (USD)</Label>
              <Input id="value" type="number" step="0.01" min="0" value={estValue} onChange={(e) => setEstValue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Giveaway["status"])}>
                <SelectTrigger id="status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="drawn">Drawn</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rules">Official rules (optional)</Label>
            <Textarea id="rules" rows={4} placeholder="Eligibility, odds, AMOE, void where prohibited…" value={rulesText} onChange={(e) => setRulesText(e.target.value)} />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : isNew ? "Create giveaway" : "Save changes"}</Button>
            {!isNew && (
              <>
                <Button type="button" variant="outline" onClick={handleDraw} disabled={existing?.status === "drawn"}>
                  <Trophy className="w-4 h-4 mr-1.5" />
                  Draw winner
                </Button>
                <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={handleDelete}>
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>

        <aside className="space-y-3">
          <Label>Prize image</Label>
          <div className="rounded-lg overflow-hidden">
            <PrizeCard imageUrl={imageUrl} alt={title || "Prize"} />
          </div>
          <label className="flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-border/50 hover:border-primary/40 cursor-pointer text-sm transition-colors">
            <Upload className="w-4 h-4" />
            {uploading ? "Uploading…" : imageUrl ? "Replace image" : "Upload image"}
            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
          </label>
          {imageUrl && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setImageUrl(null)} className="w-full text-xs">
              Remove image
            </Button>
          )}
        </aside>
      </form>

      {!isNew && id && <EntriesSection giveawayId={id} />}
    </AdminLayout>
  );
}

function EntriesSection({ giveawayId }: { giveawayId: string }) {
  const qc = useQueryClient();
  const { data: entries, isLoading } = useQuery({
    queryKey: ["admin-giveaway-entries", giveawayId],
    queryFn: () => listEntries(giveawayId),
  });

  const handleStatusChange = async (entryId: string, status: GiveawayEntry["status"]) => {
    try {
      await updateEntryStatus(entryId, status);
      qc.invalidateQueries({ queryKey: ["admin-giveaway-entries", giveawayId] });
    } catch (err: any) {
      toast.error(err?.message ?? "Update failed");
    }
  };

  const exportCsv = () => {
    if (!entries?.length) return;
    const header = ["created_at","status","full_name","email","street_address","city","state","zip","ip_address"];
    const rows = entries.map((e) =>
      header.map((k) => {
        const v = (e as any)[k] ?? "";
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      }).join(","),
    );
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `giveaway-entries-${giveawayId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const counts = {
    pending: entries?.filter((e) => e.status === "pending").length ?? 0,
    confirmed: entries?.filter((e) => e.status === "confirmed").length ?? 0,
    rejected: entries?.filter((e) => e.status === "rejected").length ?? 0,
  };

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Entries ({entries?.length ?? 0})</h2>
          <p className="text-xs text-muted-foreground">
            {counts.confirmed} confirmed · {counts.pending} pending · {counts.rejected} rejected
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!entries?.length}>
          Export CSV
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading entries…</p>
      ) : !entries?.length ? (
        <p className="text-sm text-muted-foreground border border-border/50 rounded-md p-4">No entries yet.</p>
      ) : (
        <div className="rounded-lg border border-border/50 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">Status</th>
                <th className="text-left px-3 py-2.5 font-medium">Name</th>
                <th className="text-left px-3 py-2.5 font-medium">Email</th>
                <th className="text-left px-3 py-2.5 font-medium hidden md:table-cell">Address</th>
                <th className="text-left px-3 py-2.5 font-medium hidden sm:table-cell">Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-border/40">
                  <td className="px-3 py-2.5">
                    <Badge
                      variant={e.status === "confirmed" ? "default" : e.status === "rejected" ? "destructive" : "secondary"}
                      className="capitalize"
                    >
                      {e.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 font-medium">{e.full_name}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{e.email}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                    {e.street_address}, {e.city}, {e.state} {e.zip}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground hidden sm:table-cell tabular-nums">
                    {new Date(e.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {e.status !== "confirmed" && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleStatusChange(e.id, "confirmed")}>
                        Confirm
                      </Button>
                    )}
                    {e.status !== "rejected" && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleStatusChange(e.id, "rejected")}>
                        Reject
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
