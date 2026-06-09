import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Check, Sparkles, Sun } from "lucide-react";
import { useTheme } from "next-themes";

const THEME_OPTIONS = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Sparkles },
] as const;

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeTheme = mounted ? theme : "light";
  const activeOption = useMemo(
    () => THEME_OPTIONS.find((option) => option.id === activeTheme) ?? THEME_OPTIONS[0],
    [activeTheme],
  );
  const ActiveIcon = activeOption.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full text-[hsl(var(--header-foreground))] hover:bg-[hsl(var(--header-foreground)_/_0.1)] hover:text-[hsl(var(--header-foreground))]"
          title={`Theme: ${activeOption.label}`}
        >
          <ActiveIcon className="h-4 w-4" />
          <span className="sr-only">Change theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {THEME_OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          const selected = activeOption.id === option.id;

          return (
            <DropdownMenuItem
              key={option.id}
              onClick={() => setTheme(option.id)}
              className="flex cursor-pointer items-center gap-2"
            >
              <OptionIcon className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">{option.label}</span>
              {selected && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
