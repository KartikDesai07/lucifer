"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  POS_DESKTOP_ONLY_CLASS,
  POS_MOBILE_ONLY_CLASS,
  POS_CHIP_ROW_CLASS,
  POS_CHIP_CLASS,
} from "@/lib/pos-layout";
import type { Category } from "@/types";

export const ALL_CATEGORIES = "All";

interface CategorySidebarProps {
  categories: Category[];
  selected: string;
  onSelect: (value: string) => void;
}

// Shared by both single-item renderers below. `value` is what gets compared/
// passed to onSelect (a category _id or the ALL_CATEGORIES sentinel); `label`
// is always the human-readable name shown on the control.
interface CategoryItemProps {
  value: string;
  label: string;
  selected: boolean;
  onSelect: (value: string) => void;
}

// Vertical category rail — the xl+ presentation (CategoryChips below takes
// over under xl). "All" is always first; active entry gets the primary fill.
export function CategorySidebar({ categories, selected, onSelect }: CategorySidebarProps) {
  return (
    <nav
      aria-label="Product categories"
      className={cn(POS_DESKTOP_ONLY_CLASS, "w-44 shrink-0 flex-col gap-1 pr-1")}
    >
      <CategoryButton
        value={ALL_CATEGORIES}
        label={ALL_CATEGORIES}
        selected={selected === ALL_CATEGORIES}
        onSelect={onSelect}
      />
      {/* Only the cafe's own categories scroll — "All" stays pinned. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {categories.map((c) => (
          <CategoryButton
            key={c._id}
            value={c._id}
            label={c.name}
            selected={selected === c._id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </nav>
  );
}

// Horizontal chip row — the below-xl presentation of the same list. Scrolls
// sideways instead of wrapping, so a long menu never eats grid space.
export function CategoryChips({ categories, selected, onSelect }: CategorySidebarProps) {
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Keep the selected category visible on the single-line strip: a chip that
    // scrolled off the edge would otherwise be "lost" after picking it from the
    // product grid's empty state or a resumed tab. block:"nearest" is load-
    // bearing — "start" would scroll the page/ancestors as well.
    navRef.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [selected]);

  return (
    // Plain buttons with aria-current (same contract as the rail) — not an
    // ARIA tablist, which would also promise arrow-key roving focus and panels.
    <nav
      ref={navRef}
      aria-label="Product categories"
      className={cn(POS_MOBILE_ONLY_CLASS, POS_CHIP_ROW_CLASS)}
    >
      <CategoryChip
        value={ALL_CATEGORIES}
        label={ALL_CATEGORIES}
        selected={selected === ALL_CATEGORIES}
        onSelect={onSelect}
      />
      {categories.map((c) => (
        <CategoryChip
          key={c._id}
          value={c._id}
          label={c.name}
          selected={selected === c._id}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

function CategoryChip({ value, label, selected, onSelect }: CategoryItemProps) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      title={label}
      onClick={() => onSelect(value)}
      className={cn(
        POS_CHIP_CLASS,
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:bg-muted",
      )}
    >
      {/* Operator-typed names (CR1.1) can't blow the row. */}
      <span className="max-w-[10rem] truncate">{label}</span>
    </button>
  );
}

function CategoryButton({ value, label, selected, onSelect }: CategoryItemProps) {
  return (
    <Button
      variant={selected ? "default" : "ghost"}
      size="sm"
      // shrink-0: without it a long menu squashes every button below its own
      // text height inside the flex column instead of scrolling.
      className="w-full shrink-0 justify-start"
      onClick={() => onSelect(value)}
      // Names are operator-typed (CR1.1) — truncated ones stay hover-readable.
      title={label}
      aria-current={selected ? "true" : undefined}
    >
      <span className="truncate">{label}</span>
    </Button>
  );
}
