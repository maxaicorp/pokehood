import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, GripVertical, Loader2, ExternalLink, Crown } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { getPlatformIcon, PLATFORM_PRESETS } from "@/lib/platform-icons";

interface UserLink {
  id: string;
  label: string;
  url: string;
  sort_order: number;
  user_id: string;
}

export default function LinkManager() {
  const { user, isPro, limits } = useAuth();
  const queryClient = useQueryClient();
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const { data: links = [], isLoading } = useQuery({
    queryKey: ["my-links", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_links")
        .select("*")
        .eq("user_id", user!.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as UserLink[];
    },
    enabled: !!user,
  });

  const atLimit = !isPro && links.length >= limits.maxLinks;

  const addLink = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("user_links").insert({
        user_id: user!.id,
        label: newLabel.trim(),
        url: newUrl.trim().startsWith("http") ? newUrl.trim() : `https://${newUrl.trim()}`,
        sort_order: links.length,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-links"] });
      setNewLabel("");
      setNewUrl("");
      toast.success("Link added!");
    },
    onError: (err: any) => toast.error(err.message || "Failed to add link"),
  });

  const deleteLink = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_links").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-links"] });
      toast.success("Link removed");
    },
    onError: (err: any) => toast.error(err.message || "Failed to remove link"),
  });

  const updateOrder = useMutation({
    mutationFn: async (reordered: UserLink[]) => {
      const updates = reordered.map((link, i) =>
        supabase.from("user_links").update({ sort_order: i }).eq("id", link.id)
      );
      await Promise.all(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-links"] });
    },
  });

  const handleReorder = (newOrder: UserLink[]) => {
    // Optimistically update the query cache
    queryClient.setQueryData(["my-links", user?.id], newOrder);
    updateOrder.mutate(newOrder);
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim() || !newUrl.trim()) return;
    addLink.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h3 className="font-display font-bold text-foreground text-base mb-1">Your Links</h3>
        <p className="text-sm text-muted-foreground">
          Add links to your selling platforms, social media, and more. These appear on your public profile.
          {!isPro && (
            <span className="text-amber-600 dark:text-amber-400"> Free tier: {links.length}/{limits.maxLinks} links.</span>
          )}
        </p>
      </div>

      {/* Existing Links */}
      {links.length > 0 ? (
        <Reorder.Group axis="y" values={links} onReorder={handleReorder} className="space-y-2">
          <AnimatePresence>
            {links.map((link) => (
              <Reorder.Item
                key={link.id}
                value={link}
                className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 group"
              >
                <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab shrink-0" />
                <span className="shrink-0">{getPlatformIcon(link.label + " " + link.url, "w-4 h-4")}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground text-sm truncate">{link.label}</p>
                </div>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  onClick={() => deleteLink.mutate(link.id)}
                  disabled={deleteLink.isPending}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </Reorder.Item>
            ))}
          </AnimatePresence>
        </Reorder.Group>
      ) : (
        <div className="text-center py-10 rounded-xl bg-card border border-border/50">
          <p className="text-muted-foreground text-sm">No links yet. Add your first one below!</p>
        </div>
      )}

      {/* Add new link */}
      {atLimit ? (
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 flex items-center gap-3">
          <Crown className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-sm text-foreground">
            You've reached the free tier limit of {limits.maxLinks} links.{" "}
            <span className="font-semibold">Upgrade to Pro</span> for unlimited links.
          </p>
        </div>
      ) : (
        <form onSubmit={handleAdd} className="space-y-3 p-4 rounded-xl bg-card border border-border/50">
          <p className="font-semibold text-foreground text-sm">Add New Link</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="linkLabel" className="text-xs">Label</Label>
              <Input
                id="linkLabel"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. eBay Store"
                maxLength={50}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="linkUrl" className="text-xs">URL</Label>
              <Input
                id="linkUrl"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={!newLabel.trim() || !newUrl.trim() || addLink.isPending}>
            {addLink.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
            Add Link
          </Button>
        </form>
      )}
    </div>
  );
}
