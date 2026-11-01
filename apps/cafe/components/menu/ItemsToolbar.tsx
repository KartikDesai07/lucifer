"use client";

import { useId, useRef, useState } from "react";
import { ListChecks, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import type { MenuStatusFilter, MenuStatusCounts } from "@/lib/menu-items";
import { MENU_FILTER_LABELS, type MenuCategoryCounts } from "@/lib/menu-view";
import {
  MENU_CATEGORY_SELECT_CLASS,
  MENU_FILTER_BADGE_CLASS,
  MENU_FILTER_SELECT_CLASS,
  MENU_ICON_BUTTON_CLASS,
  MENU_ICON_BUTTON_ON_CLASS,
  MENU_IMPORT_CLASS,
  MENU_SEARCH_CLASS,
  MENU_SEARCH_CLEAR_CLASS,
  MENU_SEARCH_INPUT_CLASS,
  MENU_TOOLBAR_CLASS,
  MENU_TOOLBAR_START_CLASS,
  MENU_TOOLBAR_WRAP_CLASS,
} from "@/lib/menu-layout";
import { CategoryChips } from "@/components/menu/CategoryChips";
import { FunnelIcon, MagnifierIcon } from "@/components/menu/menu-icons";
import { MenuSelect } from "@/components/menu/MenuSelect";
import type { Category } from "@/types";

const ALL_CATEGORIES = "__all__";

// The status filter's order (values 4.4). "Archived" is admin-only, as today (staff never reach it), and carries NO count
// (its list is a separate lazy query: a number that comes and goes with the cache would mislead, design 6.3).
const FILTER_ORDER: MenuStatusFilter[] = ["all", "in-stock", "out-of-stock", "hidden", "archived"];

function countOf(filter: MenuStatusFilter, c: MenuStatusCounts): number | null {
  if (filter === "all") return c.all;
  if (filter === "in-stock") return c.inStock;
  if (filter === "out-of-stock") return c.outOfStock;
  if (filter === "hidden") return c.hidden;
  return null;
}

interface ItemsToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  categoryId: string | null;
  onCategoryChange: (id: string | null) => void;
  categories: Category[];
  categoryCounts: MenuCategoryCounts;
  status: MenuStatusFilter;
  onStatusChange: (status: MenuStatusFilter) => void;
  counts: MenuStatusCounts;
  isArchived: boolean;
  isAdmin: boolean;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  onImport: () => void;
}

// The Items toolbar (values 4; design 6.3): the HTML's search box, then the category select (a page box under 1000px, from
// 720px; the rail takes over above, the chips below), the filter select (a FILTER, never tabs: the status control's pins
// moved with this) and our Import CSV where the HTML's Veg control sits. On a phone: the HTML's Filters button (the filter
// select in a wrap it opens), our Select button (today's select mode) and the Import icon beside the search, and the
// always-visible chips row under it. Every select is the kit's dropdown.
export function ItemsToolbar({
  search,
  onSearchChange,
  categoryId,
  onCategoryChange,
  categories,
  categoryCounts,
  status,
  onStatusChange,
  counts,
  isArchived,
  isAdmin,
  selectMode,
  onToggleSelectMode,
  onImport,
}: ItemsToolbarProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  // The clear ✕ unmounts itself once the search is empty, so it hands the focus back to the input (never body).
  const searchRef = useRef<HTMLInputElement>(null);
  // Staff never reach "Archived" (admin-only view, per the Items page's own status validation).
  const options = FILTER_ORDER.filter((f) => f !== "archived" || isAdmin);
  // N2 - no counts in the Archived view (they would be computed from the archived list, not the one the words describe).
  const labelCounts = isArchived ? null : counts;
  const filterActive = isArchived || status !== "all";
  const trimmed = search.trim() !== "";

  return (
    <>
      <div data-ui="menu-toolbar" className={MENU_TOOLBAR_CLASS}>
        <div className={MENU_TOOLBAR_START_CLASS}>
          <label data-ui="menu-search" className={MENU_SEARCH_CLASS}>
            <span className="flex flex-none text-subtle-foreground">
              <MagnifierIcon />
            </span>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search items"
              aria-label="Search items"
              autoComplete="off"
              className={MENU_SEARCH_INPUT_CLASS}
            />
            {trimmed && (
              <button type="button" data-ui="menu-search-clear" title="Clear search" aria-label="Clear search" onClick={() => { onSearchChange(""); searchRef.current?.focus(); }} className={MENU_SEARCH_CLEAR_CLASS}>
                ✕
              </button>
            )}
          </label>
          {/* The phone's buttons (values 4.5): Filters opens the wrap; the badge counts the active filters (the filter
              select; the category is not counted). */}
          <button
            type="button"
            data-ui="menu-filters"
            title="Filters"
            aria-label="Filters"
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
            onClick={() => setFiltersOpen((v) => !v)}
            className={cn(MENU_ICON_BUTTON_CLASS, "tab:hidden", (filtersOpen || filterActive) && "border-foreground", filtersOpen && "bg-surface-3")}
          >
            <FunnelIcon size={16} strokeWidth={1.9} />
            {filterActive && <span data-ui="menu-filters-badge" className={MENU_FILTER_BADGE_CLASS}>1</span>}
          </button>
          {/* A staff toggle too (G4): staff select rows to run the two stock bulk actions. Cards (below 816px) are
              where it is needed; the table has its own checkboxes, so the button hides exactly where the table shows (a page
              box of 740px, the 816px window less the 76px nav: ruling M5). */}
          <button
            type="button"
            data-ui="menu-select-mode"
            title="Select"
            aria-label="Select"
            aria-pressed={selectMode}
            onClick={onToggleSelectMode}
            className={cn(MENU_ICON_BUTTON_CLASS, "@[740px]/menu:hidden", selectMode && MENU_ICON_BUTTON_ON_CLASS)}
          >
            <ListChecks aria-hidden="true" className="size-4" strokeWidth={1.9} />
          </button>
          {isAdmin && (
            <button type="button" data-ui="menu-import-icon" title="Import CSV" aria-label="Import CSV" onClick={onImport} className={cn(MENU_ICON_BUTTON_CLASS, "tab:hidden")}>
              <Upload aria-hidden="true" className="size-4" strokeWidth={1.9} />
            </button>
          )}
        </div>

        <div id={filtersId} className={cn(filtersOpen ? "flex" : "hidden", MENU_TOOLBAR_WRAP_CLASS)}>
          <MenuSelect
            dataUi="menu-category-select"
            className={MENU_CATEGORY_SELECT_CLASS}
            icon="folder"
            ariaLabel="Category"
            value={categoryId ?? ALL_CATEGORIES}
            onValueChange={(v) => onCategoryChange(v === ALL_CATEGORIES ? null : v)}
            options={[
              { value: ALL_CATEGORIES, label: `All categories (${categoryCounts.all})` },
              ...categories.map((c) => ({ value: c._id, label: `${c.name} (${categoryCounts.byId.get(c._id)?.items ?? 0})` })),
            ]}
          />
          <MenuSelect
            dataUi="menu-filter-select"
            className={MENU_FILTER_SELECT_CLASS}
            icon="funnel"
            ariaLabel="Show"
            value={isArchived ? "archived" : status}
            onValueChange={(v) => onStatusChange(v as MenuStatusFilter)}
            options={options.map((f) => {
              const n = labelCounts ? countOf(f, labelCounts) : null;
              return { value: f, label: n === null ? MENU_FILTER_LABELS[f] : `${MENU_FILTER_LABELS[f]} (${n})` };
            })}
          />
          {isAdmin && (
            <button type="button" data-ui="menu-import" onClick={onImport} className={cn(MENU_IMPORT_CLASS, "max-tab:hidden")}>
              <Upload aria-hidden="true" className="size-[15px]" strokeWidth={1.8} />
              Import CSV
            </button>
          )}
        </div>
      </div>

      <CategoryChips categories={categories} allCount={categoryCounts.all} selectedId={categoryId} onSelect={onCategoryChange} />
    </>
  );
}
