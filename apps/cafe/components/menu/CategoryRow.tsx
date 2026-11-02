"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { ChefHat, ChevronDown, ChevronUp, Flame, GripVertical, IceCreamCone, Trash2, Wine } from "lucide-react";

import { PencilIcon, PrinterIcon } from "@/components/menu/menu-icons";
import {
  CATEGORY_ARROW_CLASS,
  CATEGORY_ARROWS_CLASS,
  CATEGORY_DELETE_BLOCKED_CLASS,
  CATEGORY_DELETE_CLASS,
  CATEGORY_DOT_CLASS,
  CATEGORY_EDIT_CLASS,
  CATEGORY_GRIP_CLASS,
  CATEGORY_META_CLASS,
  CATEGORY_NAME_CLASS,
  CATEGORY_NAME_LINK_CLASS,
  CATEGORY_NO_KOT_CHIP_CLASS,
  CATEGORY_ROW_CLASS,
  CATEGORY_STATION_CHIP_CLASS,
} from "@/lib/menu-categories-layout";
import { categoryMetaText } from "@/lib/menu-view";
import { cn } from "@/lib/utils";
import { menuItemsHref } from "@/lib/menu-sections";
import { KITCHEN_NO_KOT_TAG } from "@/lib/kitchen-lines";
import type { Category } from "@/types";
import type { CategoryItemCounts } from "@/lib/category-arrange";

interface CategoryRowProps {
  category: Category;
  index: number;
  total: number;
  counts: CategoryItemCounts | undefined;
  /** The category's sold-out items in the active list (the meta's "· n sold out"). */
  soldOut: number;
  /** The POS hue by position (the rail's dot). */
  hue: string;
  /** The station chip's name: the category's station, or the default station's when it has none. */
  stationName: string;
  /** Below 720px: no chips, the meta carries "No KOT". */
  phone: boolean;
  disabled: boolean; // a save is pending — dragging AND the arrows pause
  onMove: (delta: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}

// The HTML's four station glyphs (values 11: chef hat, glass, dessert, flame), chosen by the station's name; any other name
// gets the chef hat.
function stationIcon(name: string): ComponentType<{ size?: number; "aria-hidden"?: boolean }> {
  if (/bar|drink|beverage/i.test(name)) return Wine;
  if (/dessert|sweet|ice/i.test(name)) return IceCreamCone;
  if (/tandoor|grill|fire|oven/i.test(name)) return Flame;
  return ChefHat;
}

// One row of the Categories arrangement list (values 11). `useSortable` supplies the drag wiring; `touch-action: none`
// sits ONLY on the grip handle below so the rest of the row (and the page) keeps scrolling normally on a phone (dnd-kit's
// documented drag-handle pattern) — the row itself carries no touch-action.
export function CategoryRow({ category, index, total, counts, soldOut, hue, stationName, phone, disabled, onMove, onEdit, onDelete }: CategoryRowProps) {
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

  const active = counts?.active ?? 0;
  const archived = counts?.archived ?? 0;
  const noKot = category.noKot === true;
  const meta = categoryMetaText({ items: active, soldOut, archived, noKot, phone });
  const holdsItems = active + archived > 0;
  const Station = stationIcon(stationName);

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-ui="category-row"
      className={cn(CATEGORY_ROW_CLASS, isDragging && "relative z-10 shadow-md")}
    >
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
        className={`touch-none ${CATEGORY_GRIP_CLASS}`}
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>

      {/* Up/down — the single-pointer alternative to drag (WCAG 2.5.7), the HTML's 28x22 pair.
          aria-disabled + a guard (not `disabled`) while a save is pending or at the end of the list,
          so a keyboard user's focus stays on the button they just pressed
          instead of jumping to <body> (R23). */}
      <span className={CATEGORY_ARROWS_CLASS}>
        <button
          type="button"
          aria-disabled={index === 0 || disabled}
          onClick={() => {
            if (index === 0 || disabled) return;
            onMove(-1);
          }}
          aria-label={`Move ${category.name} up`}
          title="Move up"
          className={CATEGORY_ARROW_CLASS}
        >
          <ChevronUp size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-disabled={index === total - 1 || disabled}
          onClick={() => {
            if (index === total - 1 || disabled) return;
            onMove(1);
          }}
          aria-label={`Move ${category.name} down`}
          title="Move down"
          className={CATEGORY_ARROW_CLASS}
        >
          <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </span>

      <span aria-hidden="true" className={CATEGORY_DOT_CLASS} style={{ backgroundColor: hue }} />

      {/* The name block opens the category in Items (today's count-link destination). Spans, not a <p>: no block inside a link. */}
      <Link href={menuItemsHref({ categoryId: category._id })} prefetch={false} className={CATEGORY_NAME_LINK_CLASS}>
        <span className={CATEGORY_NAME_CLASS}>{category.name}</span>
        <span className={CATEGORY_META_CLASS}>{meta}</span>
      </Link>

      <span data-ui="category-station" title="Kitchen station" className={CATEGORY_STATION_CHIP_CLASS}>
        <Station size={14} aria-hidden={true} />
        {stationName}
      </span>
      {noKot && (
        <span data-ui="category-no-kot" title="KOT is off for this category" className={CATEGORY_NO_KOT_CHIP_CLASS}>
          <PrinterIcon size={13} />
          {KITCHEN_NO_KOT_TAG}
        </span>
      )}

      <button type="button" title="Edit category" aria-label={`Edit ${category.name}`} onClick={onEdit} className={CATEGORY_EDIT_CLASS}>
        <PencilIcon size={16} />
      </button>
      <button
        type="button"
        data-ui="category-delete"
        title={holdsItems ? "Move or archive its items first" : "Delete category"}
        aria-label={`Delete ${category.name}`}
        onClick={onDelete}
        className={holdsItems ? CATEGORY_DELETE_BLOCKED_CLASS : CATEGORY_DELETE_CLASS}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </li>
  );
}
