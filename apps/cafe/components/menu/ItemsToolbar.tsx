"use client";

import { Search, ListChecks } from "lucide-react";

import type { MenuStatusFilter, MenuStatusCounts } from "@/lib/menu-items";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Category } from "@/types";

const ALL_CATEGORIES = "__all__";

interface StatusOption {
  value: MenuStatusFilter;
  // Labels take the counts only while the active view is showing — `counts`
  // is `null` in the Archived view (N2: those counts are computed from the
  // ARCHIVED list, so "Out of stock" always reads 0 there and tapping it
  // would jump to the active list with completely different numbers).
  label: (counts: MenuStatusCounts | null) => string;
}

// R17 — "Archived" carries NO count (its list is a separate lazy query, so
// there is no cheap number to show without an extra fetch for every view).
// M1 fidelity (G5/G6): ONE segmented control drives both the status filter
// AND the active/archived view switch — there is no separate view toggle.
const STATUS_OPTIONS: StatusOption[] = [
  { value: "all", label: (c) => (c ? `All ${c.all}` : "All") },
  { value: "out-of-stock", label: (c) => (c ? `Out of stock ${c.outOfStock}` : "Out of stock") },
  { value: "hidden", label: (c) => (c ? `Hidden from QR ${c.hidden}` : "Hidden from QR") },
  { value: "archived", label: () => "Archived" },
];

interface ItemsToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  categoryId: string | null;
  onCategoryChange: (id: string | null) => void;
  categories: Category[];
  status: MenuStatusFilter;
  onStatusChange: (status: MenuStatusFilter) => void;
  counts: MenuStatusCounts;
  isArchived: boolean;
  isAdmin: boolean;
  selectMode: boolean;
  onToggleSelectMode: () => void;
}

export function ItemsToolbar({
  search,
  onSearchChange,
  categoryId,
  onCategoryChange,
  categories,
  status,
  onStatusChange,
  counts,
  isArchived,
  isAdmin,
  selectMode,
  onToggleSelectMode,
}: ItemsToolbarProps) {
  // Staff never reach "Archived" (admin-only view, per the Items page's own
  // status validation) — filter it out of the control they see.
  const options = STATUS_OPTIONS.filter((o) => o.value !== "archived" || isAdmin);
  // N2 — no counts in the Archived view (they'd be computed from the
  // archived list, not the active one the labels describe).
  const labelCounts = isArchived ? null : counts;

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search items…"
            className="pl-8"
          />
        </div>

        {/* Category: a Select from lg up; below lg it becomes a scrolling chip
            row underneath (rendered separately below). */}
        <Select
          value={categoryId ?? ALL_CATEGORIES}
          onValueChange={(v) => onCategoryChange(v === ALL_CATEGORIES ? null : v)}
        >
          <SelectTrigger className="hidden lg:flex lg:w-44">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c._id} value={c._id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* A staff toggle too (G4) — staff select rows to run the two stock
            bulk actions; only admins get ⋯/Move/Archive once selected. */}
        <Button
          type="button"
          variant={selectMode ? "secondary" : "outline"}
          className="lg:hidden"
          onClick={onToggleSelectMode}
        >
          <ListChecks className="mr-2 h-4 w-4" />
          {selectMode ? "Done" : "Select"}
        </Button>
      </div>

      {/* Below lg: a category chip row, scrolling inside itself so it never
          widens the page — [contain:inline-size] on the scroll box AND
          min-w-0 on every flex ancestor (a scroll box alone doesn't cap the
          parent's min-content; measured 1024px page width with the sidebar
          either state before this fix). */}
      <div className="min-w-0 overflow-x-auto pb-1 [contain:inline-size] lg:hidden">
        <div className="flex w-max gap-1.5 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <CategoryChip
            label="All categories"
            active={categoryId === null}
            onClick={() => onCategoryChange(null)}
          />
          {categories.map((c) => (
            <CategoryChip
              key={c._id}
              label={c.name}
              active={categoryId === c._id}
              onClick={() => onCategoryChange(c._id)}
            />
          ))}
        </div>
      </div>

      {/* The ONE status/view segmented control (M1 fidelity, G5/G6): picking
          "Archived" switches the query view; any other value switches back to
          active + that status filter. Scrolls inside itself below lg. This is
          a FILTER, not a tab panel switch (N4) — role="group" + aria-pressed
          toggle buttons, the RangeBar.tsx precedent, not role="tablist"/"tab"
          (which carries a roving-tabindex/arrow-key/tabpanel contract this
          control never implements). */}
      <div role="group" aria-label="Status" className="min-w-0 overflow-x-auto [contain:inline-size]">
        <div className="flex w-max gap-1 rounded-lg border p-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={status === o.value}
              onClick={() => onStatusChange(o.value)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                status === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {o.label(labelCounts)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors",
        active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}
