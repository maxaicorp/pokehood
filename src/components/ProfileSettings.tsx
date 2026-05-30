import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Camera, Loader2, Check, Crown } from "lucide-react";
import { toast } from "sonner";

interface ProfileData {
  id: string;
  user_id: string;
  display_name: string | null;
  bio: string | null;
  slug: string | null;
  avatar_url: string | null;
  is_published: boolean;
}

export default function ProfileSettings() {
  const { user, isPro, limits } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: profile, isLoading } = useQuery({
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

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [slug, setSlug] = useState("");
  const [isPublished, setIsPublished] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Sync form state when profile loads
  if (profile && !initialized) {
    setDisplayName(profile.display_name || "");
    setBio(profile.bio || "");
    setSlug(profile.slug || "");
    setIsPublished(profile.is_published);
    setInitialized(true);
  }

  const updateProfile = useMutation({
    mutationFn: async (updates: Partial<ProfileData>) => {
      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Profile updated!");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to update profile");
    },
  });

  const handleSave = () => {
    updateProfile.mutate({
      display_name: displayName.trim() || null,
      bio: bio.trim() || null,
      slug: slug.trim() || null,
      is_published: isPublished,
    });
  };

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
          const sx = (img.width - min) / 2;
          const sy = (img.height - min) / 2;
          ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
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


  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const profileUrl = `${window.location.origin}/u/${slug || profile?.slug || ""}`;

  return (
    <div className="max-w-2xl space-y-8">
      {/* Avatar */}
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
            {uploading ? (
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            ) : (
              <Camera className="w-5 h-5 text-white" />
            )}
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
        <Input
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your display name"
          maxLength={50}
        />
      </div>

      {/* Bio */}
      <div className="space-y-2">
        <Label htmlFor="bio">Bio</Label>
        <Textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Tell other collectors about yourself..."
          maxLength={200}
          className="resize-none"
          rows={3}
        />
        <p className="text-xs text-muted-foreground">{bio.length}/200</p>
      </div>

      {/* Slug */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="slug">Profile URL</Label>
          {!isPro && !limits.customSlug && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold">
              <Crown className="w-3 h-3" /> PRO
            </span>
          )}
        </div>
        <div className="flex items-center gap-0 rounded-md border border-input overflow-hidden">
          <span className="px-3 py-2 text-sm text-muted-foreground bg-muted border-r border-input whitespace-nowrap">
            collectiblez.app/u/
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
        {!isPro && !limits.customSlug && (
          <p className="text-xs text-muted-foreground">Upgrade to Pro to choose a custom username.</p>
        )}
      </div>

      {/* Published toggle */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-card border border-border/50">
        <div>
          <p className="font-semibold text-foreground text-sm">Public Profile</p>
          <p className="text-xs text-muted-foreground">Allow others to view your profile at {profileUrl}</p>
        </div>
        <button
          onClick={() => setIsPublished(!isPublished)}
          className={`relative w-11 h-6 rounded-full transition-colors ${isPublished ? "bg-primary" : "bg-muted"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${isPublished ? "translate-x-5" : ""}`}
          />
        </button>
      </div>

      {/* Save */}
      <Button onClick={handleSave} disabled={updateProfile.isPending} className="w-full sm:w-auto">
        {updateProfile.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
        ) : (
          <Check className="w-4 h-4 mr-2" />
        )}
        Save Changes
      </Button>
    </div>
  );
}
