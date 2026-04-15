import { List, LayoutGrid } from "lucide-react";

export type ViewMode = "list" | "grid";

interface ViewToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export default function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center rounded-lg border border-border/50 overflow-hidden">
      <button
        onClick={() => onChange("list")}
        className={`p-1.5 transition-colors ${
          value === "list"
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:text-foreground"
        }`}
        aria-label="List view"
      >
        <List className="w-4 h-4" />
      </button>
      <button
        onClick={() => onChange("grid")}
        className={`p-1.5 transition-colors ${
          value === "grid"
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:text-foreground"
        }`}
        aria-label="Grid view"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
    </div>
  );
}
