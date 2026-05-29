import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CollectionCard } from "@/lib/collection-store";
import { formatPrice } from "@/lib/pokemon-api";
import { STRIPE_CONFIG } from "@/lib/stripe-config";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Crown, Eye, MousePointerClick, Wallet, TrendingUp, Loader2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, subDays } from "date-fns";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  AnalyticsThemeId, ANALYTICS_THEMES, getAnalyticsTheme, setAnalyticsTheme, AnalyticsTheme,
} from "@/lib/analytics-themes";

type TimeRange = "7d" | "30d" | "90d" | "all";
const TIME_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
];

function TimeFilter({ value, onChange, theme }: { value: TimeRange; onChange: (v: TimeRange) => void; theme: AnalyticsTheme }) {
  return (
    <div className="flex gap-1">
      {TIME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
            value === opt.value
              ? `${theme.filterActiveBg} ${theme.filterActiveText}`
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ThemeSelector({ current, onChange }: { current: AnalyticsThemeId; onChange: (id: AnalyticsThemeId) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => setOpen(!open)}>
        <Palette className="w-3.5 h-3.5" /> Theme
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-xl bg-card border border-border shadow-lg p-2 space-y-1">
            {(Object.keys(ANALYTICS_THEMES) as AnalyticsThemeId[]).map((id) => {
              const t = ANALYTICS_THEMES[id];
              return (
                <button
                  key={id}
                  onClick={() => { onChange(id); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    current === id ? "bg-primary/10 text-foreground" : "hover:bg-muted text-muted-foreground"
                  }`}
                >
                  <span className="font-medium text-foreground">{t.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{t.description}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function getDayCutoff(range: TimeRange): Date | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return subDays(new Date(), days);
}

function getDayCount(range: TimeRange): number {
  return range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 365;
}

interface Props {
  collection: CollectionCard[];
}

export default function AnalyticsDashboard({ collection }: Props) {
  const { user, isPro } = useAuth();
  const [themeId, setThemeId] = useState<AnalyticsThemeId>(getAnalyticsTheme);
  const theme = ANALYTICS_THEMES[themeId];

  const handleThemeChange = (id: AnalyticsThemeId) => {
    setThemeId(id);
    setAnalyticsTheme(id);
  };

  const [valueRange, setValueRange] = useState<TimeRange>("all");
  const [viewsRange, setViewsRange] = useState<TimeRange>("30d");
  const [clicksRange, setClicksRange] = useState<TimeRange>("30d");
  const [rarityRange, setRarityRange] = useState<TimeRange>("all");

  const { data: allProfileViews = [], isLoading: viewsLoading } = useQuery({
    queryKey: ["profile-views-all", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profile_views")
        .select("viewed_at")
        .eq("profile_user_id", user!.id)
        .order("viewed_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && isPro,
  });

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

  const { data: allLinkClicks = [] } = useQuery({
    queryKey: ["link-clicks-all", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("link_clicks")
        .select("link_id, clicked_at")
        .eq("link_user_id", user!.id)
        .order("clicked_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && isPro,
  });

  // Filter helpers
  const filteredCollection = useMemo(() => {
    const cutoff = getDayCutoff(valueRange);
    if (!cutoff) return collection;
    const cutoffMs = cutoff.getTime();
    return collection.filter(c => new Date(c.addedAt).getTime() >= cutoffMs);
  }, [collection, valueRange]);

  const filteredViews = useMemo(() => {
    const cutoff = getDayCutoff(viewsRange);
    if (!cutoff) return allProfileViews;
    const cutoffIso = cutoff.toISOString();
    return allProfileViews.filter((v: any) => v.viewed_at >= cutoffIso);
  }, [allProfileViews, viewsRange]);

  const filteredClicks = useMemo(() => {
    const cutoff = getDayCutoff(clicksRange);
    if (!cutoff) return allLinkClicks;
    const cutoffIso = cutoff.toISOString();
    return allLinkClicks.filter((c: any) => c.clicked_at >= cutoffIso);
  }, [allLinkClicks, clicksRange]);

  const filteredRarityCollection = useMemo(() => {
    const cutoff = getDayCutoff(rarityRange);
    if (!cutoff) return collection;
    const cutoffMs = cutoff.getTime();
    return collection.filter(c => new Date(c.addedAt).getTime() >= cutoffMs);
  }, [collection, rarityRange]);

  // Derived chart data
  const valueHistory = useMemo(() => {
    if (filteredCollection.length === 0) return [];
    const sorted = [...filteredCollection].sort((a, b) =>
      new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
    );
    const byDay: Record<string, number> = {};
    sorted.forEach(card => {
      const day = card.addedAt.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + (card.manualPrice ?? card.marketPrice ?? 0) * card.quantity;
    });
    let running = 0;
    const points = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, val]) => {
        running += val;
        return { date: format(new Date(date + "T12:00:00"), "MMM d"), value: parseFloat(running.toFixed(2)) };
      });
    if (points.length === 1) {
      points.unshift({ date: "Start", value: 0 });
    }
    return points;
  }, [filteredCollection]);

  const viewsByDay = useMemo(() => {
    const dayCount = getDayCount(viewsRange);
    const counts: Record<string, number> = {};
    filteredViews.forEach((v: any) => {
      const day = v.viewed_at.slice(0, 10);
      counts[day] = (counts[day] || 0) + 1;
    });
    return Array.from({ length: dayCount }, (_, i) => {
      const d = subDays(new Date(), dayCount - 1 - i);
      const key = format(d, "yyyy-MM-dd");
      return { date: format(d, "MMM d"), views: counts[key] || 0 };
    });
  }, [filteredViews, viewsRange]);

  const rarityData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredRarityCollection.forEach(card => {
      const r = card.rarity || "Unknown";
      counts[r] = (counts[r] || 0) + card.quantity;
    });
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));
  }, [filteredRarityCollection]);

  const linkClickCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredClicks.forEach((c: any) => { counts[c.link_id] = (counts[c.link_id] || 0) + 1; });
    return links.map((link: any) => ({ ...link, clicks: counts[link.id] || 0 }))
      .sort((a: any, b: any) => b.clicks - a.clicks);
  }, [links, filteredClicks]);

  const topCards = useMemo(() => {
    return [...collection]
      .sort((a, b) => {
        const bv = (b.manualPrice ?? b.marketPrice ?? 0) * b.quantity;
        const av = (a.manualPrice ?? a.marketPrice ?? 0) * a.quantity;
        return bv - av;
      })
      .slice(0, 10);
  }, [collection]);

  // Stats
  const totalValue = collection.reduce((s, c) => s + (c.manualPrice ?? c.marketPrice ?? 0) * c.quantity, 0);
  const cardCount = collection.reduce((s, c) => s + c.quantity, 0);
  const avgCardValue = cardCount > 0 ? totalValue / cardCount : 0;
  const forSaleValue = collection.filter(c => c.forSale).reduce((s, c) => s + (c.salePrice ?? c.marketPrice ?? 0) * c.quantity, 0);
  const totalViews = filteredViews.length;
  const totalClicks = filteredClicks.length;

  const handleUpgrade = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { priceId: STRIPE_CONFIG.pro.price_id },
      });
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

  const viewsRangeLabel = viewsRange === "all" ? "" : ` (${viewsRange})`;
  const clicksRangeLabel = clicksRange === "all" ? "" : ` (${clicksRange})`;

  const tooltipStyle = {
    background: theme.tooltipBg,
    border: `1px solid ${theme.tooltipBorder}`,
    borderRadius: "8px",
    fontSize: "12px",
    color: theme.tooltipText,
  };

  return (
    <div className="space-y-6">
      {/* Theme selector */}
      <div className="flex justify-end">
        <ThemeSelector current={themeId} onChange={handleThemeChange} />
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: Eye, label: `Profile Views${viewsRangeLabel}`, value: totalViews.toLocaleString() },
          { icon: MousePointerClick, label: `Link Clicks${clicksRangeLabel}`, value: totalClicks.toLocaleString() },
          { icon: Wallet, label: "Avg Card Value", value: formatPrice(avgCardValue) },
          { icon: TrendingUp, label: "Listed For Sale", value: formatPrice(forSaleValue) },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            className={`p-4 rounded-xl ${theme.cardBg} border ${theme.cardBorder} space-y-2`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
          >
            <div className={`w-8 h-8 rounded-lg ${theme.statIconBg} flex items-center justify-center`}>
              <stat.icon className={`w-4 h-4 ${theme.statIconColor}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className={`text-xl font-bold ${theme.valueClass}`}>{stat.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Portfolio value over time */}
      <motion.div
        className={`p-5 rounded-xl ${theme.cardBg} border ${theme.cardBorder} space-y-3`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
      >
        <div className="flex items-center justify-between">
          <h3 className={`text-sm ${theme.headingClass}`}>Portfolio Value Over Time</h3>
          <TimeFilter value={valueRange} onChange={setValueRange} theme={theme} />
        </div>
        {valueHistory.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={valueHistory}>
              <defs>
                <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={theme.chartPrimary} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={theme.chartPrimary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} strokeOpacity={0.5} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: theme.axisColor }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: theme.axisColor }} tickFormatter={(v) => `$${v}`} axisLine={false} tickLine={false} width={50} />
              <Tooltip formatter={(v: number) => [formatPrice(v), "Portfolio Value"]} contentStyle={tooltipStyle} labelStyle={{ color: theme.tooltipText }} />
              <Area type="monotone" dataKey="value" stroke={theme.chartPrimary} fill="url(#valueGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No cards added in this period</p>
          </div>
        )}
      </motion.div>

      {/* Profile views + Rarity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          className={`p-5 rounded-xl ${theme.cardBg} border ${theme.cardBorder} space-y-3`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center justify-between">
            <h3 className={`text-sm ${theme.headingClass}`}>Profile Views</h3>
            <TimeFilter value={viewsRange} onChange={setViewsRange} theme={theme} />
          </div>
          {totalViews === 0 ? (
            <div className="h-[180px] flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No views yet — share your profile!</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={viewsByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.gridColor} strokeOpacity={0.5} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: theme.axisColor }}
                  interval={Math.max(0, Math.floor(viewsByDay.length / 6) - 1)}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 10, fill: theme.axisColor }} allowDecimals={false} axisLine={false} tickLine={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: theme.tooltipText }} />
                <Bar dataKey="views" fill={theme.chartPrimary} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div
          className={`p-5 rounded-xl ${theme.cardBg} border ${theme.cardBorder} space-y-3`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          <div className="flex items-center justify-between">
            <h3 className={`text-sm ${theme.headingClass}`}>Rarity Breakdown</h3>
            <TimeFilter value={rarityRange} onChange={setRarityRange} theme={theme} />
          </div>
          {rarityData.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No cards in this period</p>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie data={rarityData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {rarityData.map((_, i) => (
                      <Cell key={i} fill={theme.chartColors[i % theme.chartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: theme.tooltipText }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5 max-h-[180px] overflow-y-auto">
                {rarityData.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: theme.chartColors[i % theme.chartColors.length] }} />
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
        <motion.div
          className={`p-5 rounded-xl ${theme.cardBg} border ${theme.cardBorder} space-y-3`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <div className="flex items-center justify-between">
            <h3 className={`text-sm ${theme.headingClass}`}>Link Clicks</h3>
            <TimeFilter value={clicksRange} onChange={setClicksRange} theme={theme} />
          </div>
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
                          background: theme.chartPrimary,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>

        <motion.div
          className={`p-5 rounded-xl ${theme.cardBg} border ${theme.cardBorder} space-y-3`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
        >
          <h3 className={`text-sm ${theme.headingClass}`}>Top Cards by Value</h3>
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
                    <span className={`text-xs font-bold shrink-0 ${theme.valueClass}`}>{formatPrice(val)}</span>
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
