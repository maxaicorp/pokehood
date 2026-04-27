import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AdminLayout from "./AdminLayout";
import PrizeCard from "@/components/PrizeCard";
import { supabase } from "@/integrations/supabase/client";
import { uploadGiveawayImage } from "@/lib/giveaway-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, Trash2 } from "lucide-react";

interface Prize {
  id: string;
  game: string;
  week_start: string;
  week_end: string;
  title: string;
  description: string | null;
  image_url: string | null;
  estimated_value_usd: number | null;
  status: "scheduled" | "active" | "judged" | "cancelled";
  created_by: string;
  created_at: string;
}

async function listPrizes(): Promise<Prize[]> {
  const { data, error } = await (supabase.from as any)("prizes")
    .select("*")
    .order("week_start", { ascending: false });
  if (error) {
    console.error(error);
    return [];
  }
  return (data ?? []) as Prize[];
}

async function createPrize(payload: Partial<Prize>): Promise<void> {
  const userRes = await supabase.auth.getUser();
  const userId = userRes.data.user?.id;
  if (!userId) throw new Error("Must be signed in");
  const { error } = await (supabase.from as any)("prizes").insert({ ...payload, created_by: userId });
  if (error) throw error;
}

async function deletePrize(id: string): Promise<void> {
  const { error } = await (supabase.from as any)("prizes").delete().eq("id", id);
  if (error) throw error;
}

export default function AdminPrizes() {
  const qc = useQueryClient();
  const { data: prizes, isLoading } = useQuery({ queryKey: ["admin-prizes"], queryFn: listPrizes });

  const [formOpen, setFormOpen] = useState(false);
  const [game, setGame] = useState("card-match");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [estValue, setEstValue] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (formOpen && !weekStart) {
      // Default: this Monday → next Sunday
      const today = new Date();
      const day = today.getDay() === 0 ? 7 : today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - (day - 1));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      setWeekStart(fmt(monday));
      setWeekEnd(fmt(sunday));
    }
  }, [formOpen, weekStart]);

  const reset = () => {
    setGame("card-match"); setTitle(""); setDescription(""); setImageUrl(null);
    setEstValue(""); setWeekStart(""); setWeekEnd(""); setFormOpen(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadGiveawayImage(file);
      setImageUrl(url);
      toast.success("Uploaded");
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createPrize({
        game,
        title: title.trim(),
        description: description.trim() || null,
        image_url: imageUrl,
        estimated_value_usd: estValue ? Number(estValue) : null,
        week_start: weekStart,
        week_end: weekEnd,
        status: "scheduled",
      });
      toast.success("Prize created");
      qc.invalidateQueries({ queryKey: ["admin-prizes"] });
      reset();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this prize?")) return;
    try {
      await deletePrize(id);
      qc.invalidateQueries({ queryKey: ["admin-prizes"] });
      toast.success("Deleted");
    } catch (err: any) {
      toast.error(err?.message ?? "Delete failed");
    }
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Game prizes</h1>
        {!formOpen && (
          <Button onClick={() => setFormOpen(true)}>+ New prize</Button>
        )}
      </div>

      {formOpen && (
        <form onSubmit={handleCreate} className="rounded-lg border border-border/50 p-4 mb-6 grid sm:grid-cols-[1fr_180px] gap-4">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-game">Game</Label>
              <Select value={game} onValueChange={setGame}>
                <SelectTrigger id="p-game"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="card-match">Card Match</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-title">Title</Label>
              <Input id="p-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-desc">Description</Label>
              <Textarea id="p-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-start">Week start</Label>
                <Input id="p-start" type="date" required value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-end">Week end</Label>
                <Input id="p-end" type="date" required value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-value">Value ($)</Label>
                <Input id="p-value" type="number" step="0.01" min="0" value={estValue} onChange={(e) => setEstValue(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Create"}</Button>
              <Button type="button" variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </div>
          <aside className="space-y-2">
            <Label>Image</Label>
            <PrizeCard imageUrl={imageUrl} alt={title || "Prize"} />
            <label className="flex items-center justify-center gap-2 px-2 py-1.5 rounded-md border border-border/50 hover:border-primary/40 cursor-pointer text-xs transition-colors">
              <Upload className="w-3.5 h-3.5" />
              {uploading ? "Uploading…" : imageUrl ? "Replace" : "Upload"}
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
            </label>
          </aside>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !prizes?.length ? (
        <p className="text-sm text-muted-foreground">No prizes scheduled yet.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {prizes.map((p) => (
            <div key={p.id} className="rounded-lg border border-border/50 p-3 flex gap-3">
              <div className="w-20 shrink-0">
                <PrizeCard imageUrl={p.image_url} alt={p.title} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold truncate">{p.title}</h3>
                  <Badge variant={p.status === "active" ? "default" : "secondary"} className="capitalize text-[10px] shrink-0">
                    {p.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {p.game} · {p.week_start} → {p.week_end}
                </p>
                {p.estimated_value_usd != null && (
                  <p className="text-xs text-muted-foreground mt-1">${Number(p.estimated_value_usd).toLocaleString()}</p>
                )}
                {p.description && <p className="text-xs text-foreground/80 mt-1 line-clamp-2">{p.description}</p>}
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleDelete(p.id)}>
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
