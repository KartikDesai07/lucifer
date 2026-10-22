"use client";

import { useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { ALL_CATEGORIES, categoryRows, selectedCategoryName, type CategoryRow } from "@/lib/pos-categories";
import type { Category, Product } from "@/types";

export { ALL_CATEGORIES };

// The /pos categories (U1 Task 2; the owner's HTML Order screen, values 2.1-2.6 and 3.1 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.3): from 1100px the category column in the body grid's
// aside (CategorySidebar), below it the toolbar's "Category" button and its bottom sheet (CategorySheet). Both draw
// lib/pos-categories.ts's rows ("All items", then our categories with their counts and dots) and share one "Find
// category" text, kept by the page. A row is a plain button with aria-current, in a labelled nav (not an ARIA tablist,
// which would also promise arrow-key roving focus and panels).

/** What the page hands both presentations: the lists, the chosen category (ALL_CATEGORIES or an _id) and the shared
 *  find text. `categories` / `products` are undefined while they load. */
export interface CategoryPickerProps {
  categories: Category[] | undefined;
  products: Product[] | undefined;
  selected: string;
  onSelect: (value: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
}

const NO_CATEGORIES: Category[] = [];

// While the products load the rows carry no count (null), so no row reads "0" on the first paint (U1 final fix wave).
function useCategoryRows(categories: Category[] | undefined, products: Product[] | undefined, query: string): CategoryRow[] {
  return useMemo(() => categoryRows(categories ?? NO_CATEGORIES, products, query), [categories, products, query]);
}

// A row (values 2.1-2.2): 34px (44px on a phone), radius 6, 0 10px, 13.5px; the chosen one on --accent-t in --accent-i
// 600, the others --ink 400 with the HTML's intended --surface-2 hover (design 8: its runtime drops the hover); the 8px
// dot 9px from the name (none on "All items"); the count 12px, --accent-i on the chosen row, else --text-3.
const ROW_CLASS =
  "flex h-[34px] w-full items-center justify-between gap-2 rounded-[6px] px-2.5 text-left text-[13.5px] leading-[normal] max-tab:h-11";

interface CategoryRowButtonProps {
  value: string;
  name: string;
  count: number | null;
  hue: string | null;
  selected: boolean;
  onSelect: (value: string) => void;
}

function CategoryRowButton({ value, name, count, hue, selected, onSelect }: CategoryRowButtonProps) {
  return (
    <button
      type="button"
      data-ui="pos-cat-row"
      aria-current={selected ? "true" : undefined}
      // Names are operator-typed (CR1.1): a cut one stays readable on hover.
      title={name}
      onClick={() => onSelect(value)}
      className={cn(
        ROW_CLASS,
        selected ? "bg-accent font-semibold text-accent-foreground" : "bg-transparent font-normal text-ink hover:bg-surface-2",
        BRAND_PRESS_CLASS,
      )}
    >
      <span className="flex min-w-0 items-center gap-[9px]">
        {hue && <span aria-hidden="true" data-ui="pos-cat-dot" className="size-2 flex-none rounded-[50%]" style={{ background: hue }} />}
        <span className="truncate">{name}</span>
      </span>
      {count !== null && (
        <span data-ui="pos-cat-count" className={cn("text-[12px]", selected ? "text-accent-foreground" : "text-subtle-foreground")}>
          {count}
        </span>
      )}
    </button>
  );
}

/** The HTML's find box (values 2.1): 34px, 1px --border, radius 6, 0 10px on --bg, the 14px magnifier 8px from the
 *  field; 13px text (16px below 720px, ruling R36), no focus look. */
function CategoryFind({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label data-ui="pos-cat-find" className="flex h-[34px] items-center gap-2 rounded-[6px] border border-border bg-background px-2.5">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
        className="flex-none text-subtle-foreground"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        data-ui="pos-cat-find-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Find category"
        aria-label="Find category"
        autoComplete="off"
        enterKeyHint="search"
        className="min-w-0 flex-1 border-0 bg-transparent px-0.5 py-px text-[13px] leading-[normal] text-foreground outline-none placeholder:text-subtle-foreground max-tab:text-base"
      />
    </label>
  );
}

/** The category column (values 2.1, 2.4): "Categories" + "{n} total" over the find box, then the rows, which scroll on
 *  their own. The aside around it (POS_ASIDE_CLASS) is the body grid's 200px / 220px track from 1100px. Owner Q19: at
 *  1100-1279px the order bar runs under the column's foot, so the rows keep the menu column's 100px clear there, plus
 *  the safe-area inset the bar grows by (ruling P49; 100px at inset 0). */
export function CategorySidebar({ categories, products, selected, onSelect, query, onQueryChange }: CategoryPickerProps) {
  const rows = useCategoryRows(categories, products, query);
  return (
    <>
      <div data-ui="pos-cat-top" className="flex flex-none flex-col gap-2 px-3 pt-3.5 pb-1.5 leading-[normal]">
        <div data-ui="pos-cat-title" className="flex items-baseline justify-between px-1">
          <span className="text-[13px] font-semibold">Categories</span>
          <span className="text-[12px] text-muted-foreground">{(categories ?? NO_CATEGORIES).length} total</span>
        </div>
        <CategoryFind value={query} onChange={onQueryChange} />
      </div>
      <nav aria-label="Product categories" data-ui="pos-cat-list" className="min-h-0 flex-1 overflow-auto px-2 pb-4 max-xl:pb-[calc(100px+env(safe-area-inset-bottom))]">
        {rows.map((c) => (
          <CategoryRowButton
            key={c.key}
            value={c.key}
            name={c.name}
            count={c.count}
            hue={c.hue}
            selected={selected === c.key}
            onSelect={onSelect}
          />
        ))}
      </nav>
    </>
  );
}

// The sheet (values 2.6): over the --scrim at every width (z-index 20, above the phone's tab bar), the panel along the
// window's foot, full width, at most 82% of the screen's height, radius 14 14 0 0, no border or shadow; the HTML's
// fadeIn / sheetIn. Escape, a tap on the scrim, "Done" or a pick closes it. The window's foot at every width, so the
// list's 24px foot grows by the bottom safe-area inset (ruling P49; 24px at inset 0).
const SHEET_SCRIM_CLASS = "fixed inset-0 z-20 flex items-end bg-scrim motion-safe:animate-scrim-in";
const SHEET_PANEL_CLASS =
  "flex max-h-[82vh] w-full flex-col rounded-t-[14px] bg-card font-sans leading-[normal] text-foreground outline-none motion-safe:animate-sheet-in supports-[height:1dvh]:max-h-[82dvh]";

// The Category button (values 3.1): below 1100px, 10px under the search row, full width, 40px, 0 12px, 1px --border,
// radius 8, on --surface, 14px; "Category" in --text-2 8px from the chosen name (600), the 16px chevron in --text-2.
const CATEGORY_BUTTON_CLASS = cn(
  "mt-2.5 flex h-10 w-full items-center justify-between rounded-[8px] border border-border bg-card px-3 text-[14px] text-foreground desk:hidden",
  BRAND_PRESS_CLASS,
);

/** Below 1100px: the toolbar's "Category {name}" button and the bottom sheet it opens (values 2.6, 3.1). `disabled`:
 *  while the products load (U1 Task 3) the button shows but opens nothing, so no row reads a count of 0. */
export function CategorySheet({
  categories,
  products,
  selected,
  onSelect,
  query,
  onQueryChange,
  disabled = false,
}: CategoryPickerProps & { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const rows = useCategoryRows(categories, products, query);
  const pick = (value: string) => {
    onSelect(value);
    setOpen(false);
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button type="button" data-ui="pos-category-button" disabled={disabled} className={CATEGORY_BUTTON_CLASS}>
          <span className="flex min-w-0 gap-2">
            <span className="text-muted-foreground">Category</span>
            <span data-ui="pos-category-value" className="truncate font-semibold">
              {selectedCategoryName(categories, selected)}
            </span>
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="flex-none text-muted-foreground"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="pos-category-sheet" className={SHEET_SCRIM_CLASS}>
          <DialogPrimitive.Content data-ui="pos-category-panel" aria-describedby={undefined} className={SHEET_PANEL_CLASS}>
            <div data-ui="pos-category-head" className="flex flex-none flex-col gap-2.5 px-3.5 pt-3.5 pb-2">
              <div className="flex items-center justify-between">
                <DialogPrimitive.Title className="text-[16px] font-semibold">Categories</DialogPrimitive.Title>
                <DialogPrimitive.Close
                  data-ui="pos-category-done"
                  className={cn("bg-transparent px-1.5 py-px text-[15px] font-medium text-link", BRAND_PRESS_CLASS)}
                >
                  Done
                </DialogPrimitive.Close>
              </div>
              <CategoryFind value={query} onChange={onQueryChange} />
            </div>
            <nav aria-label="Product categories" data-ui="pos-category-list" className="min-h-0 flex-1 overflow-auto px-2 pb-[calc(24px+env(safe-area-inset-bottom))]">
              {rows.map((c) => (
                <CategoryRowButton
                  key={c.key}
                  value={c.key}
                  name={c.name}
                  count={c.count}
                  hue={c.hue}
                  selected={selected === c.key}
                  onSelect={pick}
                />
              ))}
            </nav>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
