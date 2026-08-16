"use client";

import { Button } from "@/components/ui/button";
import type { Category } from "@/types";

export const ALL_CATEGORIES = "All";

interface CategorySidebarProps {
  categories: Category[];
  selected: string;
  onSelect: (name: string) => void;
}

// Vertical category rail. "All" is always first; the active entry uses the
// primary (accent) fill. Names only — no icons (plan §4.3).
export function CategorySidebar({
  categories,
  selected,
  onSelect,
}: CategorySidebarProps) {
  return (
    <nav
      aria-label="Product categories"
      className="flex w-28 shrink-0 flex-col gap-1 pr-1 md:w-44"
    >
      <CategoryButton
        name={ALL_CATEGORIES}
        selected={selected === ALL_CATEGORIES}
        onSelect={onSelect}
      />
      {/* Only the cafe's own categories scroll — "All" stays pinned, so the
          reset back to the full menu is one tap away however long the list. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {categories.map((c) => (
          <CategoryButton
            key={c._id}
            name={c.name}
            selected={selected === c.name}
            onSelect={onSelect}
          />
        ))}
      </div>
    </nav>
  );
}

function CategoryButton({
  name,
  selected,
  onSelect,
}: {
  name: string;
  selected: boolean;
  onSelect: (name: string) => void;
}) {
  return (
    <Button
      variant={selected ? "default" : "ghost"}
      size="sm"
      // shrink-0: without it a long menu squashes every button below its own
      // text height inside the flex column instead of scrolling.
      className="w-full shrink-0 justify-start"
      onClick={() => onSelect(name)}
      // Names are operator-typed and can outrun the rail (CR1.1 opened the
      // enum to free text) — truncated ones stay readable on hover.
      title={name}
      aria-current={selected ? "true" : undefined}
    >
      <span className="truncate">{name}</span>
    </Button>
  );
}
