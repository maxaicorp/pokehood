import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Palette, Check } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Green-family top-bar presets (preview pass — these recolour only the header).
const THEMES = [
  { id: "topbar-green", label: "Green", swatch: "#1FA85C" },
  { id: "topbar-green-holo", label: "Green Holo", swatch: "linear-gradient(110deg,#0f7a43,#2ee6a6,#16c0b0,#6ad587)" },
  { id: "topbar-green-gradient", label: "Green Gradient", swatch: "linear-gradient(135deg,#0f7a43,#38c97f)" },
  { id: "topbar-lime", label: "Lime", swatch: "#84CC16" },
  { id: "topbar-mint", label: "Mint", swatch: "#6AD587" },
  { id: "topbar-rainbow", label: "Rainbow Edge", swatch: "linear-gradient(90deg,#ff5d5d,#ffae34,#ffe753,#4ade80,#38bdf8,#a78bfa)" },
] as const;

/** Header theme picker. Lives on the navy top bar, so the trigger is light. */
export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []); // avoid SSR/first-paint mismatch
  const current = mounted ? theme : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Change theme"
          className="w-9 h-9 rounded-full flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity"
        >
          <Palette className="w-5 h-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {THEMES.map((t) => (
          <DropdownMenuItem key={t.id} onClick={() => setTheme(t.id)} className="gap-2">
            <span className="w-3.5 h-3.5 rounded-full ring-1 ring-border" style={{ background: t.swatch }} />
            <span className="flex-1">{t.label}</span>
            {current === t.id && <Check className="w-4 h-4 opacity-70" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
