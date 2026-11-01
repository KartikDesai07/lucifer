"use client";

import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ProductSort, ProductSortKey } from "@/lib/products-sort";
import {
  MENU_CATEGORY_CELL_HIDE_CLASS,
  MENU_HEAD_CLASS,
  MENU_HEAD_SORT_CLASS,
  MENU_HEAD_SORT_ON_CLASS,
  MENU_ROW_GRID_CLASS,
  MENU_ROW_GRID_NO_CATEGORY_CLASS,
} from "@/lib/menu-list-layout";
import { MenuCheck } from "@/components/menu/MenuCheck";
import { PackageIcon, QrIcon } from "@/components/menu/menu-icons";

interface ItemsTableHeadProps {
  /** Every listed row is ticked ("on"), some ("some") or none ("off"): the select-all box (values 5.1). */
  allState: "off" | "on" | "some";
  onToggleAll: () => void;
  /** A category is picked: the Category column is gone (values 5.1). */
  categoryPicked: boolean;
  sort: ProductSort;
  onSortChange: (key: ProductSortKey) => void;
}

function SortCell({
  label,
  sortKey,
  sort,
  onSortChange,
  icon,
  className,
  justify,
}: {
  label: string;
  sortKey: ProductSortKey;
  sort: ProductSort;
  onSortChange: (key: ProductSortKey) => void;
  icon?: React.ReactNode;
  className?: string;
  justify?: "end" | "center";
}) {
  const active = sort.key === sortKey;
  const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("min-w-0", className ?? "flex", justify === "end" && "justify-end", justify === "center" && "justify-center")}
    >
      <button type="button" onClick={() => onSortChange(sortKey)} className={cn(MENU_HEAD_SORT_CLASS, active && MENU_HEAD_SORT_ON_CLASS)}>
        {icon}
        {label}
        {active && <Arrow size={12} aria-hidden="true" />}
      </button>
    </div>
  );
}

/** The table's sticky head (values 5.1): select-all, the four sort buttons "Item" / "Category" / "Price" / "Stock" (ours:
 *  today's keys), "QR", and the empty Edit column. */
export function ItemsTableHead({ allState, onToggleAll, categoryPicked, sort, onSortChange }: ItemsTableHeadProps) {
  return (
    <div role="row" data-ui="menu-table-head" className={cn(MENU_HEAD_CLASS, categoryPicked ? MENU_ROW_GRID_NO_CATEGORY_CLASS : MENU_ROW_GRID_CLASS)}>
      <div role="columnheader" aria-label="Select all" className="flex">
        <MenuCheck state={allState} label="Select all" onToggle={onToggleAll} />
      </div>
      <SortCell label="Item" sortKey="name" sort={sort} onSortChange={onSortChange} />
      {!categoryPicked && <SortCell label="Category" sortKey="category" sort={sort} onSortChange={onSortChange} className={MENU_CATEGORY_CELL_HIDE_CLASS} />}
      <SortCell label="Price" sortKey="price" sort={sort} onSortChange={onSortChange} justify="end" />
      <SortCell label="Stock" sortKey="available" sort={sort} onSortChange={onSortChange} justify="center" icon={<PackageIcon size={14} />} />
      <div role="columnheader" className="flex items-center justify-center gap-[5px]">
        <QrIcon size={14} />
        QR
      </div>
      <div role="columnheader" aria-hidden="true" />
    </div>
  );
}
