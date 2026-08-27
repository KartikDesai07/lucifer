import { cn } from "@/lib/utils";

// Extracted from PublicMenu.tsx (SLICE 8) so that file stays under the
// repo's ~300-line file budget after this slice's edits — behavior unchanged.
interface CategoryPillProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

export function CategoryPill({ label, active, onClick }: CategoryPillProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}
