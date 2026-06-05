import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Palette, Check } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Top-bar colour presets (preview pass — these recolour only the header).
const THEMES = [
  { id: "topbar-navy", label: "Navy", swatch: "#1B264F" },
  { id: "topbar-blue", label: "Blue", swatch: "#2667FF" },
  { id: "topbar-purple", label: "Purple", swatch: "#7C3AED" },
  { id: "topbar-red", label: "Red", swatch: "#E23636" },
  { id: "topbar-green", label: "Green", swatch: "#1FA85C" },
  { id: "topbar-yellow", label: "Yellow", swatch: "#FACC15" },
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
          className="w-9 h-9 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors"
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
