import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getCollectionByUserId, getTotalValue } from "@/lib/collection-store";
import { formatPrice } from "@/lib/pokemon-api";
import { getPlatformIcon } from "@/lib/platform-icons";
import QRCodeModal from "@/components/QRCodeModal";
import CardImage from "@/components/CardImage";
import { Button } from "@/components/ui/button";
import { ExternalLink, Wallet, Loader2, Lock, Mail, Share } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { motion } from "framer-motion";
import SEO from "@/components/SEO";

const CARDS_PER_PAGE = 20;

export default function Profile() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [qrOpen, setQrOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(CARDS_PER_PAGE);
  const loaderRef = useRef<HTMLDivElement>(null);
  const profileUrl = `${window.location.origin}/u/${slug || "demo"}`;

  // Fetch profile by slug
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["public-profile", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!slug,
  });

  // Fetch links for this user
  const { data: links = [] } = useQuery({
    queryKey: ["public-links", profile?.user_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_links")
        .select("*")
        .eq("user_id", profile!.user_id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!profile?.user_id,
  });

  // Fetch collection for this user
  const { data: collection = [] } = useQuery({
    queryKey: ["public-collection", profile?.user_id],
    queryFn: () => getCollectionByUserId(profile!.user_id),
    enabled: !!profile?.user_id,
  });

  const totalValue = getTotalValue(collection);
  const hasMore = visibleCount < collection.length;

  // Track profile view on mount (once per session)
  useEffect(() => {
    if (!profile?.user_id) return;
    // Once-per-day cap (localStorage, date-keyed). sessionStorage counted a new
    // view for every fresh tab, inflating analytics for shared profiles.
    const today = new Date().toISOString().split("T")[0];
    const key = `viewed_${profile.user_id}_${today}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      // localStorage unavailable (private mode etc.) — just record the view.
    }
    // Fire-and-forget insert
    supabase.from("profile_views").insert({ profile_user_id: profile.user_id })
      .then(({ error }) => { if (error) console.warn("Failed to record profile view:", error.message); });
  }, [profile?.user_id]);

  // Track link clicks
  const handleLinkClick = (link: any) => {
    supabase.from("link_clicks").insert({
      link_id: link.id,
      link_user_id: link.user_id,
    }).then(({ error }) => { if (error) console.warn("Failed to record link click:", error.message); });
  };

  // Infinite scroll observer
  useEffect(() => {
    const node = loaderRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          setVisibleCount((prev) => Math.min(prev + CARDS_PER_PAGE, collection.length));
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, collection.length]);

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground text-lg">Profile not found</p>
        <Button variant="outline" asChild>
          <Link to="/">Go Home</Link>
        </Button>
      </div>
    );
  }

  // Privacy gate: an unpublished profile must not expose its collection,
  // links, or value to anyone but its owner. (The DB-level enforcement lives
  // in migration 20260511000000_privacy_respecting_rls.sql; this is the
  // client-side gate so the leak is closed the moment the frontend deploys,
  // and so a private profile is never rendered/indexed for the public.)
  const isOwner = !!user && user.id === profile.user_id;
  if (!profile.is_published && !isOwner) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4 text-center">
        <SEO
          title="Private profile — Collectiblez"
          description="This Collectiblez profile is private."
          path={`/u/${slug}`}
          noindex
        />
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted border border-border">
          <Lock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Private Profile</span>
        </div>
        <p className="text-muted-foreground text-sm max-w-xs">This collection isn't public. The owner can make it visible from their dashboard.</p>
        <Button variant="outline" asChild>
          <Link to="/">Go Home</Link>
        </Button>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={profile ? `${profile.display_name || slug} on Collectiblez` : "Profile — Collectiblez"}
        description={profile?.bio?.slice(0, 160) || `View ${profile?.display_name || slug}'s public Pokémon TCG collection on Collectiblez.`}
        path={`/u/${slug}`}
        image={profile?.avatar_url}
        noindex={!profile.is_published}
      />
      {/* Ambient glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[400px] sm:w-[600px] h-[300px] sm:h-[400px] bg-primary/8 rounded-full blur-[150px] pointer-events-none" />

      <div className="relative z-10 mx-auto max-w-lg sm:max-w-2xl py-6 sm:py-8 px-4 sm:px-6">
        {/* Header: QR on left, Mail on right */}
        <div className="flex justify-between items-center mb-6">
          {/* Share button */}
          <motion.button
            className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-card border border-border/50 text-foreground hover:border-primary/30 transition-colors shadow-sm"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: "spring", stiffness: 260, damping: 20 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setQrOpen(true)}
            title="Share Profile"
          >
            <Share className="w-5 h-5" />
          </motion.button>
          <div className="flex gap-3">
            {/* Contact button - show when cards are for sale and links exist */}
            {collection.some(c => c.forSale) && links.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <motion.button
                    className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-card border border-border/50 text-foreground hover:border-primary/30 transition-colors shadow-sm"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.4, type: "spring", stiffness: 260, damping: 20 }}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    title="Contact seller"
                  >
                    <Mail className="w-5 h-5" />
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary animate-ping" />
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary" />
                  </motion.button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-3">
                  <p className="text-xs font-semibold text-foreground mb-2">Contact Seller</p>
                  <div className="space-y-1.5">
                    {links.map((link) => (
                      <a
                        key={link.id}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-muted transition-colors text-sm text-foreground"
                      >
                        {getPlatformIcon(link.label + " " + link.url, "w-4 h-4")}
                        <span className="flex-1 truncate">{link.label}</span>
                        <ExternalLink className="w-3 h-3 text-muted-foreground" />
                      </a>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>

        {/* Profile header */}
        <motion.div className="text-center mb-6 sm:mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary/20 border-2 border-primary mx-auto mb-3 sm:mb-4 flex items-center justify-center overflow-hidden">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt={profile.display_name || ""} className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl sm:text-3xl font-display font-bold text-primary">
                {(profile.display_name || slug || "?")[0].toUpperCase()}
              </span>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">{profile.display_name || slug}</h1>
          {profile.bio && (
            <p className="text-muted-foreground mt-1 text-sm sm:text-base px-4">{profile.bio}</p>
          )}
        </motion.div>

        {/* Private badge */}
        {!profile.is_published && (
          <motion.div
            className="flex justify-center mb-6 sm:mb-8"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted border border-border">
              <Lock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Private Profile</span>
            </div>
          </motion.div>
        )}

        {/* Value badge */}
        {collection.length > 0 && (
          <motion.div className="flex justify-center mb-6 sm:mb-8" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}>
            <div className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-full bg-card border border-border/50 glow-primary">
              <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
              <span className="text-xs sm:text-sm text-muted-foreground">Collection Value</span>
              <span className="text-lg sm:text-xl font-display font-bold text-foreground">{formatPrice(totalValue)}</span>
            </div>
          </motion.div>
        )}

        {/* Links */}
        {links.length > 0 && (
          <motion.div className="space-y-2.5 sm:space-y-3 mb-8 sm:mb-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
            {links.map((link, i) => (
              <motion.a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleLinkClick(link)}
                className="flex items-center justify-between p-3.5 sm:p-4 rounded-xl bg-card border border-border/50 hover:border-primary/30 transition-colors group card-shine"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.08 }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg sm:text-xl">{getPlatformIcon(link.label + " " + link.url, "w-5 h-5")}</span>
                  <span className="font-semibold text-foreground text-sm sm:text-base">{link.label}</span>
                </div>
                <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </motion.a>
            ))}
          </motion.div>
        )}

        <div>
          <h2 className="font-display font-bold text-base sm:text-lg text-foreground mb-3 sm:mb-4">
            Collection ({collection.length} cards)
          </h2>
          {collection.length > 0 ? (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-3">
                {collection.slice(0, visibleCount).map((card, i) => (
                  <motion.div
                    key={card.id}
                    className="relative rounded-xl overflow-hidden border border-border/50"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(i, CARDS_PER_PAGE) * 0.04 }}
                    whileHover={{ scale: 1.05, zIndex: 10 }}
                  >
                    <CardImage src={card.imageSmall} alt={card.name} className="w-full" loading="lazy" />
                    {card.forSale && (
                      <span className="absolute top-1.5 left-1.5 z-10 w-3 h-3 rounded-full bg-green-500 border-2 border-background shadow-sm" title="For Sale" />
                    )}
                  </motion.div>
                ))}
              </div>
              {hasMore && (
                <div ref={loaderRef} className="flex justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 rounded-xl bg-card border border-border/50">
              <p className="text-muted-foreground">No cards in this collection yet.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-10 sm:mt-12 text-center">
          <p className="text-xs text-muted-foreground">
            Powered by <span className="font-display font-semibold text-foreground">Collectiblez</span>
          </p>
        </div>
      </div>

      <QRCodeModal open={qrOpen} onOpenChange={setQrOpen} url={profileUrl} />
    </div>
  );
}
