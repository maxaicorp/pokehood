import { CSSProperties, useMemo, useState } from "react";
import Market from "@/pages/Market";

type ThemePreset = {
  id: string;
  name: string;
  font: string;
  note: string;
  tokens: Record<string, string>;
};

const presets: ThemePreset[] = [
  {
    id: "current-soft",
    name: "Current Soft",
    font: '"Space Grotesk", system-ui, sans-serif',
    note: "Closest to today, less sci-fi, easier to read.",
    tokens: {
      "--background": "222 38% 7%",
      "--foreground": "210 25% 96%",
      "--card": "222 31% 10%",
      "--card-foreground": "210 25% 96%",
      "--popover": "222 31% 10%",
      "--popover-foreground": "210 25% 96%",
      "--primary": "160 72% 47%",
      "--primary-foreground": "165 60% 8%",
      "--secondary": "220 24% 15%",
      "--secondary-foreground": "210 18% 88%",
      "--muted": "220 24% 15%",
      "--muted-foreground": "216 13% 62%",
      "--accent": "216 72% 55%",
      "--accent-foreground": "210 25% 98%",
      "--border": "220 19% 20%",
      "--input": "220 19% 20%",
      "--ring": "160 72% 47%",
      "--surface-elevated": "222 28% 12%",
    },
  },
  {
    id: "card-shop",
    name: "Card Shop",
    font: '"Space Grotesk", Inter, system-ui, sans-serif',
    note: "Clean hobby-store palette: cream, ink, green, red.",
    tokens: {
      "--background": "44 30% 96%",
      "--foreground": "214 24% 16%",
      "--card": "0 0% 100%",
      "--card-foreground": "214 24% 16%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "214 24% 16%",
      "--primary": "151 48% 32%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "42 22% 90%",
      "--secondary-foreground": "214 22% 22%",
      "--muted": "42 22% 91%",
      "--muted-foreground": "214 11% 45%",
      "--accent": "5 70% 55%",
      "--accent-foreground": "0 0% 100%",
      "--border": "39 18% 83%",
      "--input": "39 18% 83%",
      "--ring": "151 48% 32%",
      "--surface-elevated": "0 0% 100%",
    },
  },
  {
    id: "mint-ledger",
    name: "Mint Ledger",
    font: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
    note: "Portfolio-first, trustworthy, crisp financial feel.",
    tokens: {
      "--background": "204 33% 97%",
      "--foreground": "212 34% 13%",
      "--card": "0 0% 100%",
      "--card-foreground": "212 34% 13%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "212 34% 13%",
      "--primary": "174 70% 28%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "202 27% 91%",
      "--secondary-foreground": "212 28% 21%",
      "--muted": "202 27% 92%",
      "--muted-foreground": "211 12% 45%",
      "--accent": "218 67% 48%",
      "--accent-foreground": "0 0% 100%",
      "--border": "202 20% 84%",
      "--input": "202 20% 84%",
      "--ring": "174 70% 28%",
      "--surface-elevated": "0 0% 100%",
    },
  },
  {
    id: "black-label",
    name: "Black Label",
    font: '"Space Grotesk", system-ui, sans-serif',
    note: "Premium dark collector case without neon overload.",
    tokens: {
      "--background": "225 18% 5%",
      "--foreground": "42 28% 94%",
      "--card": "225 15% 9%",
      "--card-foreground": "42 28% 94%",
      "--popover": "225 15% 9%",
      "--popover-foreground": "42 28% 94%",
      "--primary": "43 83% 62%",
      "--primary-foreground": "225 18% 7%",
      "--secondary": "225 12% 14%",
      "--secondary-foreground": "42 20% 86%",
      "--muted": "225 12% 14%",
      "--muted-foreground": "220 8% 61%",
      "--accent": "356 69% 58%",
      "--accent-foreground": "0 0% 100%",
      "--border": "225 10% 20%",
      "--input": "225 10% 20%",
      "--ring": "43 83% 62%",
      "--surface-elevated": "225 14% 12%",
    },
  },
  {
    id: "electric-blue",
    name: "Electric Blue",
    font: '"Space Grotesk", system-ui, sans-serif',
    note: "Modern market-data look, punchy but still product-focused.",
    tokens: {
      "--background": "220 42% 8%",
      "--foreground": "210 35% 97%",
      "--card": "220 36% 11%",
      "--card-foreground": "210 35% 97%",
      "--popover": "220 36% 11%",
      "--popover-foreground": "210 35% 97%",
      "--primary": "211 100% 62%",
      "--primary-foreground": "222 45% 8%",
      "--secondary": "220 27% 16%",
      "--secondary-foreground": "210 25% 88%",
      "--muted": "220 27% 16%",
      "--muted-foreground": "217 13% 63%",
      "--accent": "152 80% 50%",
      "--accent-foreground": "160 55% 8%",
      "--border": "220 20% 22%",
      "--input": "220 20% 22%",
      "--ring": "211 100% 62%",
      "--surface-elevated": "220 32% 13%",
    },
  },
];

const sharedTokens: Record<string, string> = {
  "--destructive": "0 74% 56%",
  "--destructive-foreground": "0 0% 100%",
  "--radius": "0.55rem",
  "--sidebar-background": "var(--background)",
  "--sidebar-foreground": "var(--foreground)",
  "--sidebar-primary": "var(--primary)",
  "--sidebar-primary-foreground": "var(--primary-foreground)",
  "--sidebar-accent": "var(--accent)",
  "--sidebar-accent-foreground": "var(--accent-foreground)",
  "--sidebar-border": "var(--border)",
  "--sidebar-ring": "var(--ring)",
  "--rainbow-1": "0 74% 56%",
  "--rainbow-2": "32 90% 55%",
  "--rainbow-3": "43 83% 62%",
  "--rainbow-4": "151 66% 45%",
  "--rainbow-5": "211 100% 62%",
  "--rainbow-6": "258 72% 64%",
  "--rainbow-7": "333 72% 58%",
};

export default function BrandLab() {
  const [activeId, setActiveId] = useState(presets[0].id);
  const preset = useMemo(
    () => presets.find((item) => item.id === activeId) ?? presets[0],
    [activeId],
  );

  const style = {
    ...sharedTokens,
    ...preset.tokens,
    "--brand-font": preset.font,
  } as CSSProperties;

  return (
    <div data-brand-lab style={style}>
      <style>
        {`
          [data-brand-lab],
          [data-brand-lab] * {
            font-family: var(--brand-font) !important;
            letter-spacing: 0 !important;
          }

          [data-brand-lab] .font-display,
          [data-brand-lab] .font-body {
            font-family: var(--brand-font) !important;
          }
        `}
      </style>

      <Market />

      <aside className="fixed right-3 top-[72px] z-[80] w-[min(340px,calc(100vw-1.5rem))] rounded-lg border border-border bg-background/95 p-3 shadow-xl backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-muted-foreground">Brand Lab</p>
            <p className="text-sm font-bold text-foreground">{preset.name}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{preset.note}</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2">
          {presets.map((item) => {
            const selected = item.id === activeId;
            return (
              <button
                key={item.id}
                onClick={() => setActiveId(item.id)}
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-left transition ${
                  selected ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="text-xs font-bold">{item.name}</span>
                <span className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded-full border border-border" style={{ background: `hsl(${item.tokens["--background"]})` }} />
                  <span className="h-3 w-3 rounded-full" style={{ background: `hsl(${item.tokens["--primary"]})` }} />
                  <span className="h-3 w-3 rounded-full" style={{ background: `hsl(${item.tokens["--accent"]})` }} />
                </span>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
