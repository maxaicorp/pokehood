import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCollectionByUserId, getTotalValue, CollectionCard } from "@/lib/collection-store";
import { formatPrice } from "@/lib/pokemon-api";
import QRCodeModal from "@/components/QRCodeModal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ExternalLink, Wallet, QrCode, Loader2, Lock } from "lucide-react";
import { motion } from "framer-motion";

const CARDS_PER_PAGE = 20;

export default function Profile() {
  const { slug } = useParams();
  const [qrOpen, setQrOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(CARDS_PER_PAGE);
  const loaderRef = useRef<HTMLDivElement>(null);
  const publishedDomain = "https://collectiblez.lovable.app";
  const profileUrl = `${publishedDomain}/u/${slug || "demo"}`;

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

  const linkIcons: Record<string, string> = {
    ebay: "🛒", tcgplayer: "🃏", discord: "💬", instagram: "📸",
    twitter: "🐦", youtube: "📺", twitch: "🎮", tiktok: "🎵",
  };

  const getIcon = (label: string) => {
    const key = Object.keys(linkIcons).find(k => label.toLowerCase().includes(k));
    return key ? linkIcons[key] : "🔗";
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Ambient glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[400px] sm:w-[600px] h-[300px] sm:h-[400px] bg-primary/8 rounded-full blur-[150px] pointer-events-none" />

      <div className="relative z-10 mx-auto max-w-md py-6 sm:py-8 px-4 sm:px-6">
        <Button variant="ghost" size="sm" className="mb-4 sm:mb-6" asChild>
          <Link to="/"><ArrowLeft className="w-4 h-4 mr-1" />Back</Link>
        </Button>

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
          <Button variant="outline" size="sm" className="mt-3 sm:mt-4 gap-2" onClick={() => setQrOpen(true)}>
            <QrCode className="w-4 h-4" /> Share via QR
          </Button>
        </motion.div>

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
                className="flex items-center justify-between p-3.5 sm:p-4 rounded-xl bg-card border border-border/50 hover:border-primary/30 transition-colors group card-shine"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.08 }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg sm:text-xl">{getIcon(link.label)}</span>
                  <span className="font-semibold text-foreground text-sm sm:text-base">{link.label}</span>
                </div>
                <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </motion.a>
            ))}
          </motion.div>
        )}

        {/* For-sale contact banner */}
        {collection.some(c => c.forSale) && links.length > 0 && (
          <motion.div
            className="mb-6 sm:mb-8 p-4 rounded-xl bg-green-500/10 border border-green-500/30"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-sm font-semibold text-foreground">Cards For Sale</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Interested in buying? Reach out via:
            </p>
            <div className="flex flex-wrap gap-2">
              {links.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border/50 hover:border-green-500/50 transition-colors text-xs font-medium text-foreground"
                >
                  <span>{getIcon(link.label)}</span>
                  {link.label}
                  <ExternalLink className="w-3 h-3 text-muted-foreground" />
                </a>
              ))}
            </div>
          </motion.div>
        )}

        {/* Card gallery */}
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
                    <img src={card.imageSmall} alt={card.name} className="w-full" loading="lazy" />
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
            Powered by <span className="font-display font-semibold text-foreground">PokeVault</span>
          </p>
        </div>
      </div>

      <QRCodeModal open={qrOpen} onOpenChange={setQrOpen} url={profileUrl} />
    </div>
  );
}
