import { cn } from "@/lib/utils";
import { PUB_PRESS_CLASS } from "@/components/public/public-ui";

// Extracted from PublicMenu.tsx (SLICE 8) so that file stays under the
// repo's ~300-line file budget after this slice's edits — behavior unchanged.
// S4 — restyled to a solid active fill (rather than a bordered-active look)
// so the category rail reads as one deliberate control, not a bare tab list.
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
        "min-h-11 shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
        PUB_PRESS_CLASS,
        active ? "bg-primary text-primary-foreground font-semibold" : "bg-muted text-foreground",
      )}
    >
      {label}
    </button>
  );
}
