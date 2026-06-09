import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { STRIPE_CONFIG } from "@/lib/stripe-config";
import QRCodeModal from "@/components/QRCodeModal";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Crown, LogOut, ExternalLink, QrCode, LayoutGrid, TrendingUp, Layers, Compass, Blocks, Gamepad2, BarChart3, Shield, Heart } from "lucide-react";
import GlobalSearch from "@/components/GlobalSearch";
import ThemeToggle from "@/components/ThemeToggle";
import { toast } from "sonner";
import { useState } from "react";

interface AppHeaderProps {
  activePage: "dashboard" | "explore" | "market" | "sets" | "heatmap" | "onchain" | "games" | "vault";
  children?: React.ReactNode;
}

export default function AppHeader({ activePage, children }: AppHeaderProps) {
  const { user, isPro, isAdmin, signOut } = useAuth();
  const [qrOpen, setQrOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["my-profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const profileUrl = `${window.location.origin}/u/${profile?.slug || ""}`;

  const handleUpgrade = async () => {
    setCheckoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { priceId: STRIPE_CONFIG.pro.price_id },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to start checkout");
    }
    setCheckoutLoading(false);
  };

  return (
    <>
      {/* Mobile bottom nav */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-xl border-t border-border/50 flex pb-[env(safe-area-inset-bottom)]">
        {([
          { to: "/", page: "market", Icon: TrendingUp, label: "Market" },
          { to: "/onchain/activity", page: "onchain", Icon: Blocks, label: "Onchain" },
          { to: "/explore", page: "explore", Icon: Compass, label: "Explore" },
          { to: "/sets", page: "sets", Icon: Layers, label: "Sets" },
          { to: "/games", page: "games", Icon: Gamepad2, label: "Games" },
        ] as const).map(({ to, page, Icon, label }) => {
          const active = activePage === page;
          return (
            <Link
              key={page}
              to={to}
              className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}
            >
              <span className={`flex items-center justify-center rounded-full px-4 py-1 transition-colors ${active ? "bg-primary/10" : ""}`}>
                <Icon className="w-[22px] h-[22px]" strokeWidth={active ? 2.5 : 2} />
              </span>
              <span className={`text-[10px] ${active ? "font-semibold" : "font-medium"}`}>{label}</span>
            </Link>
          );
        })}
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 pt-3 sm:pt-4">
        {/* Same container + padding as page content (e.g. Market's
            `container px-4 sm:px-8`) so the pill aligns to the exact width below. */}
        <div className="container px-4 sm:px-8">
        <div className="app-header-pill backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between gap-3 px-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link to="/" className="flex items-center gap-2 h-8">
              <img src="/logo.png" alt="Collectiblez" className="w-8 h-8 object-contain" />
              <span className="hidden min-[380px]:inline font-display font-bold text-base tracking-wide uppercase">Collectiblez</span>
            </Link>
            <div className="hidden sm:flex items-center gap-0">
              <Link to="/dashboard" className={`px-4 py-1.5 text-sm font-medium transition-colors ${activePage === "dashboard" ? "opacity-100" : "opacity-60 hover:opacity-100"}`}>Dashboard</Link>
              <Link to="/explore" className={`px-4 py-1.5 text-sm font-medium transition-colors ${activePage === "explore" ? "opacity-100" : "opacity-60 hover:opacity-100"}`}>Explore</Link>
              <Link to="/sets" className={`px-4 py-1.5 text-sm font-medium transition-colors ${activePage === "sets" ? "opacity-100" : "opacity-60 hover:opacity-100"}`}>Sets</Link>
              <Link to="/onchain/activity" className={`px-4 py-1.5 text-sm font-medium transition-colors ${activePage === "onchain" ? "opacity-100" : "opacity-60 hover:opacity-100"}`}>Onchain</Link>
              <Link to="/games" className={`px-4 py-1.5 text-sm font-medium transition-colors ${activePage === "games" ? "opacity-100" : "opacity-60 hover:opacity-100"}`}>Games</Link>
              {/* Giveaway hidden from public nav for now — system needs more
                  review before exposure. Admins still manage it at /admin/giveaways. */}
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <GlobalSearch />
            <ThemeToggle />
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-9 h-9 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center overflow-hidden hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary/50">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-display font-bold text-primary">
                        {(profile?.display_name || user?.email || "?")[0].toUpperCase()}
                      </span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <div className="px-3 py-2">
                    <p className="text-sm font-semibold text-foreground truncate">{profile?.display_name || "My Account"}</p>
                    <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/dashboard">
                      <LayoutGrid className="w-4 h-4 mr-2" /> Dashboard
                    </Link>
                  </DropdownMenuItem>
                  {!isPro && (
                    <DropdownMenuItem onClick={handleUpgrade} disabled={checkoutLoading} className="text-amber-600 dark:text-amber-400">
                      <Crown className="w-4 h-4 mr-2" /> Upgrade to Pro
                    </DropdownMenuItem>
                  )}
                  {profile?.slug && (
                    <DropdownMenuItem asChild>
                      <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-4 h-4 mr-2" /> My Profile
                      </a>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setQrOpen(true)}>
                    <QrCode className="w-4 h-4 mr-2" /> Share QR Code
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/dashboard?tab=wishlists">
                      <Heart className="w-4 h-4 mr-2" /> My Wishlist
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/stats">
                      <BarChart3 className="w-4 h-4 mr-2" /> My Stats
                    </Link>
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem asChild>
                      <Link to="/admin">
                        <Shield className="w-4 h-4 mr-2" /> Admin
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut} className="text-destructive">
                    <LogOut className="w-4 h-4 mr-2" /> Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link to="/auth" className="shrink-0 whitespace-nowrap rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800 sm:px-4">
                Sign In
              </Link>
            )}
          </div>
        </div>
        </div>
        {/* Page-injected sub-nav (e.g. Dashboard tabs). Needs a solid bg +
            border so scrolling content doesn't bleed through the sticky header. */}
        {children && (
          <div className="mt-2 overflow-hidden rounded-2xl border border-border/70 bg-background/95 shadow-sm backdrop-blur-xl">{children}</div>
        )}
        </div>
      </header>

      <QRCodeModal open={qrOpen} onOpenChange={setQrOpen} url={profileUrl} title="Share Your Profile" />
    </>
  );
}
