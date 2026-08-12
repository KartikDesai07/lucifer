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
  const names = [ALL_CATEGORIES, ...categories.map((c) => c.name)];

  return (
    <nav
      aria-label="Product categories"
      className="flex w-28 shrink-0 flex-col gap-1 overflow-y-auto pr-1 md:w-40"
    >
      {names.map((name) => (
        <Button
          key={name}
          variant={selected === name ? "default" : "ghost"}
          size="sm"
          className="justify-start"
          onClick={() => onSelect(name)}
        >
          <span className="truncate">{name}</span>
        </Button>
      ))}
    </nav>
  );
}
