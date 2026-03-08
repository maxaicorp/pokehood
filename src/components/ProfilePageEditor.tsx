import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getCollection, getTotalValue, checkSlugAvailability, CollectionCard } from "@/lib/collection-store";
import { formatPrice } from "@/lib/pokemon-api";
import PhoneMockup from "@/components/PhoneMockup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Camera, Loader2, Check, Crown, Plus, Trash2, GripVertical,
  ExternalLink, Wallet, QrCode, Share2
} from "lucide-react";
import QRCodeModal from "@/components/QRCodeModal";
import { toast } from "sonner";
import { motion, AnimatePresence, Reorder } from "framer-motion";

interface ProfileData {
  id: string;
  user_id: string;
  display_name: string | null;
  bio: string | null;
  slug: string | null;
  avatar_url: string | null;
  is_published: boolean;
}

interface UserLink {
  id: string;
  label: string;
  url: string;
  sort_order: number;
  user_id: string;
}

export default function ProfilePageEditor() {
  const { user, isPro, limits } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Profile data
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["my-profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data as ProfileData;
    },
    enabled: !!user,
  });

  // Links data
  const { data: links = [], isLoading: linksLoading } = useQuery({
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

  // Collection for preview
  const { data: collection = [] } = useQuery({
    queryKey: ["my-collection", user?.id],
    queryFn: () => getCollection(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [slug, setSlug] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");

  if (profile && !initialized) {
    setDisplayName(profile.display_name || "");
    setBio(profile.bio || "");
    setSlug(profile.slug || "");
    setIsPublished(profile.is_published);
    setInitialized(true);
  }

  const totalValue = getTotalValue(collection);
  const atLinkLimit = !isPro && links.length >= limits.maxLinks;

  // Debounced slug availability check
  useEffect(() => {
    if (!slug || slug === profile?.slug || !user) {
      setSlugStatus("idle");
      return;
    }
    if (slug.length < 3) {
      setSlugStatus("idle");
      return;
    }
    setSlugStatus("checking");
    const timer = setTimeout(async () => {
      const available = await checkSlugAvailability(slug, user.id);
      setSlugStatus(available ? "available" : "taken");
    }, 500);
    return () => clearTimeout(timer);
  }, [slug, profile?.slug, user]);

  // Mutations
  const updateProfile = useMutation({
    mutationFn: async (updates: Partial<ProfileData>) => {
      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: (err: any) => {
      setSaveStatus("idle");
      toast.error(err.message || "Failed to update profile");
    },
  });

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-links"] }),
  });

  const doSave = useCallback(() => {
    if (slugStatus === "taken" || !initialized) return;
    updateProfile.mutate({
      display_name: displayName.trim() || null,
      bio: bio.trim() || null,
      slug: slug.trim() || null,
      is_published: isPublished,
    });
  }, [displayName, bio, slug, isPublished, slugStatus, initialized]);

  // Auto-save with debounce
  useEffect(() => {
    if (!initialized || !profile) return;
    // Don't save if nothing changed
    if (
      displayName === (profile.display_name || "") &&
      bio === (profile.bio || "") &&
      slug === (profile.slug || "") &&
      isPublished === profile.is_published
    ) return;
    if (slugStatus === "checking" || slugStatus === "taken") return;
    const timer = setTimeout(doSave, 1200);
    return () => clearTimeout(timer);
  }, [displayName, bio, slug, isPublished, doSave, initialized, profile, slugStatus]);

  const publishedDomain = "https://collectiblez.lovable.app";
  const profileUrl = `${publishedDomain}/u/${slug || profile?.slug || ""}`;

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    let objectUrl = "";
    try {
      const canvas = document.createElement("canvas");
      const img = new Image();
      objectUrl = URL.createObjectURL(file);
      await new Promise<void>((resolve) => {
        img.onload = () => {
          const size = 256;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d")!;
          const min = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size);
          resolve();
        };
        img.src = objectUrl;
      });
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/webp", 0.8)
      );
      const filePath = `${user.id}/avatar.webp`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, blob, { upsert: true, contentType: "image/webp" });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath);
      await supabase
        .from("profiles")
        .update({ avatar_url: `${urlData.publicUrl}?t=${Date.now()}` })
        .eq("user_id", user.id);
      queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Avatar updated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to upload avatar");
    }
    setUploading(false);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };

  const handleReorder = (newOrder: UserLink[]) => {
    queryClient.setQueryData(["my-links", user?.id], newOrder);
    updateOrder.mutate(newOrder);
  };

  const handleAddLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim() || !newUrl.trim()) return;
    addLink.mutate();
  };

  const linkIcons: Record<string, string> = {
    ebay: "🛒", tcgplayer: "🃏", discord: "💬", instagram: "📸",
    twitter: "🐦", youtube: "📺", twitch: "🎮", tiktok: "🎵",
  };
  const getIcon = (label: string) => {
    const key = Object.keys(linkIcons).find(k => label.toLowerCase().includes(k));
    return key ? linkIcons[key] : "🔗";
  };

  if (profileLoading || linksLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex gap-8 items-start">
      {/* Editor panel */}
      <div className="flex-1 min-w-0 space-y-8">
        {/* Avatar + Name */}
        <div className="flex items-center gap-5">
          <div className="relative group">
            <Avatar className="w-20 h-20 border-2 border-border">
              <AvatarImage src={profile?.avatar_url || undefined} />
              <AvatarFallback className="text-2xl font-display font-bold bg-primary/10 text-primary">
                {(displayName || "?")[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              disabled={uploading}
            >
              {uploading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          </div>
          <div>
            <p className="font-display font-bold text-foreground text-lg">{displayName || "Set your name"}</p>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        {/* Display Name */}
        <div className="space-y-2">
          <Label htmlFor="displayName">Display Name</Label>
          <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your display name" maxLength={50} />
        </div>

        {/* Bio */}
        <div className="space-y-2">
          <Label htmlFor="bio">Bio</Label>
          <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell other collectors about yourself..." maxLength={200} className="resize-none" rows={3} />
          <p className="text-xs text-muted-foreground">{bio.length}/200</p>
        </div>

        {/* Slug */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="slug">Profile URL</Label>
            {!isPro && !limits.customSlug && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-[10px] font-semibold">
                <Crown className="w-3 h-3" /> PRO
              </span>
            )}
          </div>
          <div className="flex items-center gap-0 rounded-md border border-input overflow-hidden">
            <span className="px-3 py-2 text-sm text-muted-foreground bg-muted border-r border-input whitespace-nowrap">
              pokevault.app/u/
            </span>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ""))}
              placeholder="your-username"
              className="border-0 rounded-none focus-visible:ring-0"
              disabled={!isPro && !limits.customSlug}
              maxLength={30}
            />
          </div>
          {slugStatus === "checking" && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Checking availability…
            </p>
          )}
          {slugStatus === "available" && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <Check className="w-3 h-3" /> Available!
            </p>
          )}
          {slugStatus === "taken" && (
            <p className="text-xs text-destructive">That slug is already taken.</p>
          )}
        </div>

        {/* Published toggle */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-card border border-border/50">
          <div>
            <p className="font-semibold text-foreground text-sm">Public Profile</p>
            <p className="text-xs text-muted-foreground">Allow others to view your profile</p>
          </div>
          <button
            onClick={() => setIsPublished(!isPublished)}
            className={`relative w-11 h-6 rounded-full transition-colors ${isPublished ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${isPublished ? "translate-x-5" : ""}`} />
          </button>
        </div>

        {/* Save profile */}
        <Button onClick={handleSave} disabled={updateProfile.isPending}>
          {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
          Save Changes
        </Button>

        {/* Divider */}
        <div className="border-t border-border" />

        {/* Links section */}
        <div>
          <h3 className="font-display font-bold text-foreground text-base mb-1">Your Links</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Add links to selling platforms, social media, etc.
            {!isPro && <span className="text-accent-foreground"> Free: {links.length}/{limits.maxLinks} links.</span>}
          </p>

          {links.length > 0 && (
            <Reorder.Group axis="y" values={links} onReorder={handleReorder} className="space-y-2 mb-4">
              <AnimatePresence>
                {links.map((link) => (
                  <Reorder.Item key={link.id} value={link} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 group">
                    <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground text-sm truncate">{link.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{link.url}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={() => deleteLink.mutate(link.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </Reorder.Item>
                ))}
              </AnimatePresence>
            </Reorder.Group>
          )}

          {atLinkLimit ? (
            <div className="p-4 rounded-xl border border-border bg-muted/50 flex items-center gap-3">
              <Crown className="w-5 h-5 text-primary shrink-0" />
              <p className="text-sm text-foreground">
                Free tier limit of {limits.maxLinks} links reached. <span className="font-semibold">Upgrade to Pro</span> for unlimited.
              </p>
            </div>
          ) : (
            <form onSubmit={handleAddLink} className="space-y-3 p-4 rounded-xl bg-card border border-border/50">
              <p className="font-semibold text-foreground text-sm">Add New Link</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="linkLabel" className="text-xs">Label</Label>
                  <Input id="linkLabel" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. eBay Store" maxLength={50} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="linkUrl" className="text-xs">URL</Label>
                  <Input id="linkUrl" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://..." />
                </div>
              </div>
              <Button type="submit" size="sm" disabled={!newLabel.trim() || !newUrl.trim() || addLink.isPending}>
                {addLink.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                Add Link
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* Live Preview — hidden on mobile */}
      <div className="hidden lg:block sticky top-24 shrink-0">
        <p className="text-xs text-muted-foreground text-center mb-3 font-medium">Live Preview</p>
        <PhoneMockup>
          <div className="h-full overflow-y-auto bg-background text-foreground px-4 pt-12 pb-6">
            {/* Avatar */}
            <div className="text-center mb-4">
              <div className="w-14 h-14 rounded-full bg-primary/20 border-2 border-primary mx-auto mb-2 flex items-center justify-center overflow-hidden">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl font-display font-bold text-primary">
                    {(displayName || "?")[0].toUpperCase()}
                  </span>
                )}
              </div>
              <p className="font-display font-bold text-foreground text-sm">{displayName || "Your Name"}</p>
              {bio && <p className="text-muted-foreground text-[10px] mt-0.5 px-2 leading-tight">{bio}</p>}
            </div>

            {/* Value badge */}
            {collection.length > 0 && (
              <div className="flex justify-center mb-3">
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border/50 text-[10px]">
                  <Wallet className="w-3 h-3 text-primary" />
                  <span className="text-muted-foreground">Value</span>
                  <span className="font-display font-bold text-foreground">{formatPrice(totalValue)}</span>
                </div>
              </div>
            )}

            {/* Links */}
            {links.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {links.map((link) => (
                  <div key={link.id} className="flex items-center justify-between p-2 rounded-lg bg-card border border-border/50 text-[10px]">
                    <div className="flex items-center gap-1.5">
                      <span>{getIcon(link.label)}</span>
                      <span className="font-semibold text-foreground">{link.label}</span>
                    </div>
                    <ExternalLink className="w-2.5 h-2.5 text-muted-foreground" />
                  </div>
                ))}
              </div>
            )}

            {/* Cards preview */}
            {collection.length > 0 && (
              <div>
                <p className="font-display font-bold text-[10px] text-foreground mb-1.5">
                  Collection ({collection.length})
                </p>
                <div className="grid grid-cols-3 gap-1">
                  {collection.slice(0, 6).map((card) => (
                    <div key={card.id} className="rounded-md overflow-hidden border border-border/50">
                      <img src={card.imageSmall} alt={card.name} className="w-full" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <p className="text-center text-[8px] text-muted-foreground mt-4">
              Powered by <span className="font-display font-semibold text-foreground">PokeVault</span>
            </p>
          </div>
        </PhoneMockup>
      </div>
    </div>
  );
}
