export type AnalyticsThemeId = "dark-pro" | "clean-collector" | "minimal-mono" | "retro-pokemon";

export interface AnalyticsTheme {
  id: AnalyticsThemeId;
  name: string;
  description: string;
  // Card/container styles
  cardBg: string;
  cardBorder: string;
  // Chart colors
  chartPrimary: string;
  chartGradientFrom: string;
  chartGradientTo: string;
  chartColors: string[];
  // Grid / axis
  gridColor: string;
  axisColor: string;
  // Tooltip
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  // Stat icon bg
  statIconBg: string;
  statIconColor: string;
  // Text overrides
  headingClass: string;
  valueClass: string;
  // Time filter active
  filterActiveBg: string;
  filterActiveText: string;
}

export const ANALYTICS_THEMES: Record<AnalyticsThemeId, AnalyticsTheme> = {
  "dark-pro": {
    id: "dark-pro",
    name: "Dark Pro",
    description: "Bloomberg terminal meets modern SaaS",
    cardBg: "bg-[hsl(222,47%,9%)]",
    cardBorder: "border-[hsl(222,20%,18%)]",
    chartPrimary: "hsl(160 90% 50%)",
    chartGradientFrom: "hsl(160 90% 50%)",
    chartGradientTo: "hsl(160 90% 50%)",
    chartColors: [
      "hsl(160 90% 50%)", "hsl(190 90% 55%)", "hsl(220 90% 60%)",
      "hsl(280 80% 60%)", "hsl(330 80% 55%)", "hsl(40 90% 55%)",
      "hsl(120 70% 45%)", "hsl(0 80% 55%)",
    ],
    gridColor: "hsl(222 20% 18%)",
    axisColor: "hsl(222 10% 40%)",
    tooltipBg: "hsl(222 47% 6%)",
    tooltipBorder: "hsl(222 20% 22%)",
    tooltipText: "hsl(0 0% 95%)",
    statIconBg: "bg-[hsl(160,90%,50%)]/15",
    statIconColor: "text-[hsl(160,90%,50%)]",
    headingClass: "font-mono tracking-tight text-[hsl(0,0%,80%)]",
    valueClass: "font-mono font-bold text-[hsl(160,90%,50%)]",
    filterActiveBg: "bg-[hsl(160,90%,50%)]",
    filterActiveText: "text-[hsl(222,47%,6%)]",
  },
  "clean-collector": {
    id: "clean-collector",
    name: "Card Collector",
    description: "Warm accents with rainbow borders",
    cardBg: "bg-card",
    cardBorder: "border-border/50",
    chartPrimary: "hsl(25 95% 55%)",
    chartGradientFrom: "hsl(25 95% 55%)",
    chartGradientTo: "hsl(25 95% 55%)",
    chartColors: [
      "hsl(25 95% 55%)", "hsl(355 80% 60%)", "hsl(170 70% 45%)",
      "hsl(45 95% 55%)", "hsl(210 80% 55%)", "hsl(290 70% 55%)",
      "hsl(140 70% 45%)", "hsl(0 80% 55%)",
    ],
    gridColor: "hsl(0 0% 88%)",
    axisColor: "hsl(0 0% 55%)",
    tooltipBg: "hsl(0 0% 100%)",
    tooltipBorder: "hsl(0 0% 88%)",
    tooltipText: "hsl(0 0% 10%)",
    statIconBg: "bg-[hsl(25,95%,55%)]/15",
    statIconColor: "text-[hsl(25,95%,55%)]",
    headingClass: "font-display font-bold text-foreground",
    valueClass: "font-display font-bold text-foreground",
    filterActiveBg: "bg-[hsl(25,95%,55%)]",
    filterActiveText: "text-white",
  },
  "minimal-mono": {
    id: "minimal-mono",
    name: "Minimal Mono",
    description: "Ultra-clean with electric blue accent",
    cardBg: "bg-card",
    cardBorder: "border-border/30",
    chartPrimary: "hsl(217 91% 60%)",
    chartGradientFrom: "hsl(217 91% 60%)",
    chartGradientTo: "hsl(217 91% 60%)",
    chartColors: [
      "hsl(217 91% 60%)", "hsl(217 70% 75%)", "hsl(217 50% 45%)",
      "hsl(0 0% 40%)", "hsl(0 0% 60%)", "hsl(0 0% 75%)",
      "hsl(217 40% 55%)", "hsl(0 0% 30%)",
    ],
    gridColor: "hsl(0 0% 90%)",
    axisColor: "hsl(0 0% 55%)",
    tooltipBg: "hsl(0 0% 100%)",
    tooltipBorder: "hsl(0 0% 90%)",
    tooltipText: "hsl(0 0% 10%)",
    statIconBg: "bg-[hsl(217,91%,60%)]/10",
    statIconColor: "text-[hsl(217,91%,60%)]",
    headingClass: "font-body font-semibold tracking-tight text-foreground",
    valueClass: "font-body font-bold text-foreground",
    filterActiveBg: "bg-[hsl(217,91%,60%)]",
    filterActiveText: "text-white",
  },
  "retro-pokemon": {
    id: "retro-pokemon",
    name: "Retro Pokémon",
    description: "Classic Pokémon vibes, bold & nostalgic",
    cardBg: "bg-[hsl(45,100%,97%)]",
    cardBorder: "border-[hsl(45,60%,80%)]",
    chartPrimary: "hsl(355 85% 52%)",
    chartGradientFrom: "hsl(355 85% 52%)",
    chartGradientTo: "hsl(355 85% 52%)",
    chartColors: [
      "hsl(355 85% 52%)", "hsl(217 90% 55%)", "hsl(50 95% 50%)",
      "hsl(145 70% 40%)", "hsl(270 65% 55%)", "hsl(25 90% 55%)",
      "hsl(190 80% 45%)", "hsl(330 75% 55%)",
    ],
    gridColor: "hsl(45 40% 85%)",
    axisColor: "hsl(45 20% 50%)",
    tooltipBg: "hsl(45 100% 97%)",
    tooltipBorder: "hsl(45 60% 80%)",
    tooltipText: "hsl(0 0% 10%)",
    statIconBg: "bg-[hsl(355,85%,52%)]/15",
    statIconColor: "text-[hsl(355,85%,52%)]",
    headingClass: "font-display font-black uppercase tracking-wide text-[hsl(355,85%,52%)]",
    valueClass: "font-display font-black text-[hsl(0,0%,15%)]",
    filterActiveBg: "bg-[hsl(355,85%,52%)]",
    filterActiveText: "text-white",
  },
};

const STORAGE_KEY = "analytics-theme";

export function getAnalyticsTheme(): AnalyticsThemeId {
  if (typeof window === "undefined") return "minimal-mono";
  return (localStorage.getItem(STORAGE_KEY) as AnalyticsThemeId) || "minimal-mono";
}

export function setAnalyticsTheme(id: AnalyticsThemeId) {
  localStorage.setItem(STORAGE_KEY, id);
}
