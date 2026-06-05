import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { STRIPE_CONFIG } from "@/lib/stripe-config";
import QRCodeModal from "@/components/QRCodeModal";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Crown, LogOut, ExternalLink, QrCode, LayoutGrid, TrendingUp, Layers, Compass, Blocks, Gamepad2, BarChart3, Shield, Heart } from "lucide-react";
import GlobalSearch from "@/components/GlobalSearch";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { toast } from "sonner";
import { useState } from "react";

interface AppHeaderProps {
  activePage: "dashboard" | "explore" | "market" | "sets" | "onchain" | "games";
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
      <header className="sticky top-0 z-50">
        <div className="bg-[hsl(var(--header))] text-[hsl(var(--header-foreground))] backdrop-blur-xl border-b border-white/10">
        <div className="container flex items-center justify-between h-14 sm:h-16 px-4 sm:px-8">
          <div className="flex items-center gap-2 sm:gap-3">
            <Link to="/" className="flex items-center gap-2 h-8">
              <img src="/logo.png" alt="Collectiblez" className="w-8 h-8 object-contain" />
              <span className="font-display font-bold text-base tracking-wide uppercase">Collectiblez</span>
            </Link>
            <div className="hidden sm:flex items-center gap-0">
              <Link to="/dashboard" className={`px-4 py-1.5 text-sm font-medium transition-colors ${activePage === "dashboard" ? "text-white" : "text-white/55 hover:text-white"}`}>Dashboard</Link>
              <Link to="/explore" className={`px-4 py-1.5 text-sm font-medium transition-colors ${activePage === "explore" ? "text-white" : "text-white/55 hover:text-white"}`}>Explore</Link>
              <Link to="/sets" className={`px-4 py-1.5 text-sm font-medium transition-colors ${activePage === "sets" ? "text-white" : "text-white/55 hover:text-white"}`}>Sets</Link>
              <Link to="/onchain/activity" className={`px-4 py-1.5 text-sm font-medium transition-colors ${activePage === "onchain" ? "text-white" : "text-white/55 hover:text-white"}`}>Onchain</Link>
              <Link to="/games" className={`px-4 py-1.5 text-sm font-medium transition-colors ${activePage === "games" ? "text-white" : "text-white/55 hover:text-white"}`}>Games</Link>
              {/* Giveaway hidden from public nav for now — system needs more
                  review before exposure. Admins still manage it at /admin/giveaways. */}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <GlobalSearch />
            <ThemeSwitcher />
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
              <Link to="/auth" className="px-4 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                Sign In
              </Link>
            )}
          </div>
        </div>
        </div>
        {children}
      </header>

      <QRCodeModal open={qrOpen} onOpenChange={setQrOpen} url={profileUrl} title="Share Your Profile" />
    </>
  );
}
