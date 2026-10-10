"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { GripVertical, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NoKotTag } from "@/components/menu/NoKotTag";
import { cn } from "@/lib/utils";
import { menuItemsHref } from "@/lib/menu-sections";
import type { Category } from "@/types";
import type { CategoryItemCounts } from "@/lib/category-arrange";

interface CategoryRowProps {
  category: Category;
  index: number;
  total: number;
  counts: CategoryItemCounts | undefined;
  disabled: boolean; // a save is pending — dragging AND the arrows pause
  onMove: (delta: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}

// One row of the Categories arrangement list. `useSortable` supplies the drag
// wiring; `touch-action: none` sits ONLY on the grip handle below so the rest
// of the row (and the page) keeps scrolling normally on a phone (dnd-kit's
// documented drag-handle pattern) — the row itself carries no touch-action.
export function CategoryRow({ category, index, total, counts, disabled, onMove, onEdit, onDelete }: CategoryRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: category._id,
    disabled,
  });

  // Own translate3d string (no @dnd-kit/utilities import — R24/D4): the same
  // shape CSS.Transform.toString produces for a pure translation (no scale).
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition: transition ?? undefined,
  };

  const archived = counts?.archived ?? 0;
  const countLabel = `${counts?.active ?? 0} item${counts?.active === 1 ? "" : "s"}${archived > 0 ? ` · ${archived} archived` : ""}`;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center justify-between gap-2 bg-background p-3",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          // aria-disabled, not `disabled` (R23): useSortable({ disabled }) above
          // already stops a drag while a save is pending, and a real `disabled`
          // would drop a keyboard user's focus to <body> right after a drop.
          aria-disabled={disabled}
          aria-label={`Drag to reorder ${category.name}`}
          className="touch-none rounded p-1.5 text-muted-foreground hover:text-foreground aria-disabled:opacity-30"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Up/down — the single-pointer alternative to drag (WCAG 2.5.7).
            aria-disabled + a guard (not `disabled`) while a save is pending,
            so a keyboard user's focus stays on the button they just pressed
            instead of jumping to <body> (R23). */}
        {/* Stacked on phones (44px targets, name keeps its width); side by side from md. */}
        <div className="flex flex-col md:flex-row">
          <button
            type="button"
            aria-disabled={index === 0 || disabled}
            onClick={() => {
              if (index === 0 || disabled) return;
              onMove(-1);
            }}
            aria-label={`Move ${category.name} up`}
            className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground aria-disabled:opacity-30 md:h-9 md:w-9"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-disabled={index === total - 1 || disabled}
            onClick={() => {
              if (index === total - 1 || disabled) return;
              onMove(1);
            }}
            aria-label={`Move ${category.name} down`}
            className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground aria-disabled:opacity-30 md:h-9 md:w-9"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-w-0">
          {/* A <div>, not a <p>: the No KOT tag is a Badge, which renders a <div> (invalid inside a <p>). */}
          <div className="flex items-center gap-1.5 font-medium">
            <span className="truncate">{category.name}</span>
            <NoKotTag skips={category.noKot === true} />
          </div>
          <Link
            href={menuItemsHref({ categoryId: category._id })}
            prefetch={false}
            className="text-xs text-muted-foreground hover:underline"
          >
            {countLabel}
          </Link>
        </div>
      </div>

      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Rename ${category.name}`}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete} aria-label={`Delete ${category.name}`}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </li>
  );
}
