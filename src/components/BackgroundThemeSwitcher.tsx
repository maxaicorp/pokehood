import { useState, useEffect, createContext, useContext } from "react";
import { Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const THEMES = [
  { id: "none", label: "None", emoji: "🚫" },
  { id: "noise", label: "Noise Grain", emoji: "📺" },
  { id: "radial-glow", label: "Radial Glow", emoji: "💡" },
  { id: "dot-grid", label: "Dot Grid", emoji: "⚬" },
  { id: "mesh-gradient", label: "Mesh Gradient", emoji: "🌈" },
  { id: "topographic", label: "Topographic", emoji: "🗺️" },
  { id: "aurora", label: "Aurora", emoji: "🌌" },
  { id: "holographic", label: "Holographic", emoji: "✨" },
  { id: "vignette", label: "Vignette", emoji: "🔲" },
] as const;

export type BgThemeId = (typeof THEMES)[number]["id"];

const BgThemeContext = createContext<BgThemeId>("none");
export const useBgTheme = () => useContext(BgThemeContext);

export function BgThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<BgThemeId>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("pokevault-bg-theme") as BgThemeId) || "none";
    }
    return "none";
  });

  useEffect(() => {
    localStorage.setItem("pokevault-bg-theme", theme);
  }, [theme]);

  return (
    <BgThemeContext.Provider value={theme}>
      {children}
      <BackgroundThemeSwitcher current={theme} onChange={setTheme} />
    </BgThemeContext.Provider>
  );
}

function BackgroundThemeSwitcher({
  current,
  onChange,
}: {
  current: BgThemeId;
  onChange: (id: BgThemeId) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-2">
      {open && (
        <div className="bg-card border border-border rounded-2xl shadow-xl p-3 w-56 animate-in slide-in-from-bottom-2 fade-in duration-200">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-semibold text-foreground">Background Theme</span>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-0.5">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => onChange(t.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-sm transition-colors",
                  current === t.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent text-foreground"
                )}
              >
                <span className="text-base">{t.emoji}</span>
                <span className="font-medium">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <Button
        size="icon"
        variant="outline"
        className="rounded-full w-11 h-11 shadow-lg border-border bg-card hover:bg-accent"
        onClick={() => setOpen((o) => !o)}
        title="Switch background theme"
      >
        <Palette className="w-5 h-5" />
      </Button>
    </div>
  );
}
