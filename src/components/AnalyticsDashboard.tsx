import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CollectionCard } from "@/lib/collection-store";
import { formatPrice } from "@/lib/pokemon-api";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Crown, Eye, MousePointerClick, Wallet, TrendingUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, subDays } from "date-fns";
import { motion } from "framer-motion";
import { toast } from "sonner";

const CHART_BLUE = "hsl(217 91% 60%)";
const CHART_COLORS = [
  "hsl(0 90% 65%)", "hsl(30 95% 55%)", "hsl(50 95% 55%)", "hsl(145 70% 45%)",
  "hsl(217 91% 60%)", "hsl(270 70% 60%)", "hsl(325 85% 55%)", "hsl(190 80% 50%)",
];

interface Props {
  collection: CollectionCard[];
}

export default function AnalyticsDashboard({ collection }: Props) {
  const { user, isPro } = useAuth();

  // Fetch profile views (last 30 days)
  const { data: profileViews = [], isLoading: viewsLoading } = useQuery({
    queryKey: ["profile-views", user?.id],
    queryFn: async () => {
      const since = subDays(new Date(), 30).toISOString();
      const { data, error } = await supabase
        .from("profile_views")
        .select("viewed_at")
        .eq("profile_user_id", user!.id)
        .gte("viewed_at", since);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && isPro,
  });

  // Fetch user links
  const { data: links = [] } = useQuery({
    queryKey: ["my-links-analytics", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_links")
        .select("*")
        .eq("user_id", user!.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && isPro,
  });

  // Fetch link clicks (last 30 days)
  const { data: linkClicks = [] } = useQuery({
    queryKey: ["link-clicks", user?.id],
    queryFn: async () => {
      const since = subDays(new Date(), 30).toISOString();
      const { data, error } = await supabase
        .from("link_clicks")
        .select("link_id, clicked_at")
        .eq("link_user_id", user!.id)
        .gte("clicked_at", since);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && isPro,
  });

  // ─── Derived data ───
  const valueHistory = useMemo(() => {
    if (collection.length === 0) return [];
    const sorted = [...collection].sort((a, b) =>
      new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
    );
    const byDay: Record<string, number> = {};
    sorted.forEach(card => {
      const day = card.addedAt.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + (card.manualPrice ?? card.marketPrice ?? 0) * card.quantity;
    });
    let running = 0;
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, val]) => {
        running += val;
        return { date: format(new Date(date + "T12:00:00"), "MMM d"), value: parseFloat(running.toFixed(2)) };
      });
  }, [collection]);

  const viewsByDay = useMemo(() => {
    const counts: Record<string, number> = {};
    profileViews.forEach((v: any) => {
      const day = v.viewed_at.slice(0, 10);
      counts[day] = (counts[day] || 0) + 1;
    });
    return Array.from({ length: 30 }, (_, i) => {
      const d = subDays(new Date(), 29 - i);
      const key = format(d, "yyyy-MM-dd");
      return { date: format(d, "MMM d"), views: counts[key] || 0 };
    });
  }, [profileViews]);

  const rarityData = useMemo(() => {
    const counts: Record<string, number> = {};
    collection.forEach(card => {
      const r = card.rarity || "Unknown";
      counts[r] = (counts[r] || 0) + card.quantity;
    });
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));
  }, [collection]);

  const linkClickCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    linkClicks.forEach((c: any) => { counts[c.link_id] = (counts[c.link_id] || 0) + 1; });
    return links.map((link: any) => ({ ...link, clicks: counts[link.id] || 0 }))
      .sort((a: any, b: any) => b.clicks - a.clicks);
  }, [links, linkClicks]);

  const topCards = useMemo(() => {
    return [...collection]
      .sort((a, b) => {
        const bv = (b.manualPrice ?? b.marketPrice ?? 0) * b.quantity;
        const av = (a.manualPrice ?? a.marketPrice ?? 0) * a.quantity;
        return bv - av;
      })
      .slice(0, 10);
  }, [collection]);

  const totalValue = collection.reduce((s, c) => s + (c.manualPrice ?? c.marketPrice ?? 0) * c.quantity, 0);
  const cardCount = collection.reduce((s, c) => s + c.quantity, 0);
  const avgCardValue = cardCount > 0 ? totalValue / cardCount : 0;
  const forSaleValue = collection.filter(c => c.forSale).reduce((s, c) => s + (c.salePrice ?? c.marketPrice ?? 0) * c.quantity, 0);
  const totalViews = profileViews.length;
  const totalClicks = linkClicks.length;

  const handleUpgrade = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout");
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch {
      toast.error("Failed to open checkout. Please try again.");
    }
  };

  // Pro gate
  if (!isPro) {
    return (
      <div className="flex flex-col items-center justify-center py-16 sm:py-20 gap-6 text-center">
        <motion.div 
          className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
        >
          <Crown className="w-10 h-10 text-primary" />
        </motion.div>
        <div className="max-w-sm space-y-2">
          <h2 className="font-display font-bold text-xl text-foreground">Pro Analytics</h2>
          <p className="text-muted-foreground text-sm">
            Unlock deep insights into your collection — track portfolio growth, monitor who's viewing your profile, and see which links get the most clicks.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left max-w-sm w-full">
          {[
            { icon: TrendingUp, label: "Portfolio value chart" },
            { icon: Eye, label: "Profile view tracking" },
            { icon: MousePointerClick, label: "Link click analytics" },
            { icon: Wallet, label: "Rarity & value breakdown" },
          ].map(({ icon: Icon, label }, i) => (
            <motion.div 
              key={label} 
              className="flex items-center gap-2.5 p-3 rounded-xl bg-card border border-border/50"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.08 }}
            >
              <Icon className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-medium text-foreground">{label}</span>
            </motion.div>
          ))}
        </div>
        <Button className="mt-2" onClick={handleUpgrade}>
          <Crown className="w-4 h-4 mr-2" />
          Upgrade to Pro
        </Button>
      </div>
    );
  }

  if (viewsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Pro analytics UI
  return (
    <div className="space-y-6">
      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: Eye, label: "Profile Views (30d)", value: totalViews.toLocaleString() },
          { icon: MousePointerClick, label: "Link Clicks (30d)", value: totalClicks.toLocaleString() },
          { icon: Wallet, label: "Avg Card Value", value: formatPrice(avgCardValue) },
          { icon: TrendingUp, label: "Listed For Sale", value: formatPrice(forSaleValue) },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            className="p-4 rounded-xl bg-card border border-border/50 space-y-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
          >
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <stat.icon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-xl font-display font-bold text-foreground">{stat.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Portfolio value over time */}
      {valueHistory.length > 1 && (
        <motion.div 
          className="p-5 rounded-xl bg-card border border-border/50 space-y-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <h3 className="font-display font-bold text-foreground text-sm">Portfolio Value Over Time</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={valueHistory}>
              <defs>
                <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_BLUE} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_BLUE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" strokeOpacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(0 0% 55%)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(0 0% 55%)" }} tickFormatter={(v) => `$${v}`} axisLine={false} tickLine={false} width={50} />
              <Tooltip 
                formatter={(v: number) => [formatPrice(v), "Portfolio Value"]} 
                contentStyle={{ background: "hsl(222 47% 9%)", border: "1px solid hsl(222 20% 18%)", borderRadius: "8px", fontSize: "12px" }}
                labelStyle={{ color: "hsl(0 0% 95%)" }}
              />
              <Area type="monotone" dataKey="value" stroke={CHART_BLUE} fill="url(#valueGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      {/* Profile views + Rarity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile views */}
        <motion.div 
          className="p-5 rounded-xl bg-card border border-border/50 space-y-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <h3 className="font-display font-bold text-foreground text-sm">Profile Views (Last 30 Days)</h3>
          {totalViews === 0 ? (
            <div className="h-[180px] flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No views yet — share your profile!</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={viewsByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" strokeOpacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(0 0% 55%)" }} interval={6} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(0 0% 55%)" }} allowDecimals={false} axisLine={false} tickLine={false} width={30} />
                <Tooltip 
                  contentStyle={{ background: "hsl(222 47% 9%)", border: "1px solid hsl(222 20% 18%)", borderRadius: "8px", fontSize: "12px" }}
                  labelStyle={{ color: "hsl(0 0% 95%)" }}
                />
                <Bar dataKey="views" fill={CHART_BLUE} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        {/* Rarity breakdown */}
        <motion.div 
          className="p-5 rounded-xl bg-card border border-border/50 space-y-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          <h3 className="font-display font-bold text-foreground text-sm">Rarity Breakdown</h3>
          {rarityData.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No cards in collection</p>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie data={rarityData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {rarityData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ background: "hsl(222 47% 9%)", border: "1px solid hsl(222 20% 18%)", borderRadius: "8px", fontSize: "12px" }}
                    labelStyle={{ color: "hsl(0 0% 95%)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5 max-h-[180px] overflow-y-auto">
                {rarityData.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span className="text-muted-foreground truncate flex-1">{item.name}</span>
                    <span className="font-semibold text-foreground">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Link analytics + Top cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Link analytics */}
        <motion.div 
          className="p-5 rounded-xl bg-card border border-border/50 space-y-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <h3 className="font-display font-bold text-foreground text-sm">Link Clicks (Last 30 Days)</h3>
          {linkClickCounts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No links added yet</p>
          ) : (
            <div className="space-y-3">
              {linkClickCounts.map((link: any) => {
                const maxClicks = Math.max(...linkClickCounts.map((l: any) => l.clicks), 1);
                return (
                  <div key={link.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-foreground font-medium truncate">{link.label}</span>
                      <span className="text-muted-foreground ml-2">{link.clicks} clicks</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max((link.clicks / maxClicks) * 100, link.clicks > 0 ? 5 : 0)}%`,
                          background: CHART_BLUE,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* Top valuable cards */}
        <motion.div 
          className="p-5 rounded-xl bg-card border border-border/50 space-y-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
        >
          <h3 className="font-display font-bold text-foreground text-sm">Top Cards by Value</h3>
          {topCards.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No cards in collection</p>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {topCards.map((card, i) => {
                const val = (card.manualPrice ?? card.marketPrice ?? 0) * card.quantity;
                return (
                  <div key={card.id} className="flex items-center gap-2.5">
                    <span className="text-xs text-muted-foreground w-4 shrink-0 text-right">#{i + 1}</span>
                    <img src={card.imageSmall} alt={card.name} className="w-7 h-10 object-contain rounded shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{card.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{card.setName}</p>
                    </div>
                    <span className="text-xs font-display font-bold text-foreground shrink-0">{formatPrice(val)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
