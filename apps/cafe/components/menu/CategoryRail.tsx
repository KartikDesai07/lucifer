"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { categoryHueMap } from "@/lib/pos-categories";
import {
  MENU_RAIL_CLASS,
  MENU_RAIL_COUNT_CLASS,
  MENU_RAIL_ROW_CLASS,
  MENU_RAIL_ROW_INNER_CLASS,
  MENU_RAIL_ROW_OFF_CLASS,
  MENU_RAIL_ROW_ON_CLASS,
  MENU_RAIL_SOLD_OUT_CLASS,
} from "@/lib/menu-layout";
import { GridIcon } from "@/components/menu/menu-icons";
import type { Category } from "@/types";

interface CategoryRailProps {
  categories: Category[];
  counts: Map<string, { items: number; soldOut: number }>;
  allCount: number;
  allSoldOut: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

interface RowProps {
  id: string | null;
  name: string;
  count: number;
  soldOut: number;
  hue: string | null;
  selected: boolean;
  onSelect: (id: string | null) => void;
}

function RailRow({ id, name, count, soldOut, hue, selected, onSelect }: RowProps) {
  return (
    <button
      type="button"
      data-ui="menu-rail-row"
      aria-pressed={selected}
      onClick={() => onSelect(id)}
      className={cn(MENU_RAIL_ROW_CLASS, selected ? MENU_RAIL_ROW_ON_CLASS : MENU_RAIL_ROW_OFF_CLASS)}
    >
      <span className={MENU_RAIL_ROW_INNER_CLASS}>
        <span className="flex size-4 flex-none items-center justify-center">
          {hue ? <span className="size-2 rounded-[50%]" style={{ background: hue }} /> : <GridIcon size={16} />}
        </span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {soldOut > 0 && (
          <span data-ui="menu-rail-soldout" title={`${soldOut} sold out`} className={MENU_RAIL_SOLD_OUT_CLASS}>
            {soldOut}
          </span>
        )}
        <span className={MENU_RAIL_COUNT_CLASS}>{count}</span>
      </span>
    </button>
  );
}

// The HTML's category rail (values 3; design 6.2), from a 1000px page: "All items" then OUR categories in their arranged
// order (no section heads: we have none), each a 36px row with its hue dot (the POS's categoryHueMap, so the dots match
// New Order's column), a sold-out chip and the count. A pick is the page's category filter (and clears the selection).
export function CategoryRail({ categories, counts, allCount, allSoldOut, selectedId, onSelect }: CategoryRailProps) {
  const hues = useMemo(() => categoryHueMap(categories), [categories]);
  return (
    <aside data-ui="menu-rail" aria-label="Categories" className={MENU_RAIL_CLASS}>
      <RailRow id={null} name="All items" count={allCount} soldOut={allSoldOut} hue={null} selected={selectedId === null} onSelect={onSelect} />
      {categories.map((c) => (
        <RailRow
          key={c._id}
          id={c._id}
          name={c.name}
          count={counts.get(c._id)?.items ?? 0}
          soldOut={counts.get(c._id)?.soldOut ?? 0}
          hue={hues.get(c._id) ?? null}
          selected={selectedId === c._id}
          onSelect={onSelect}
        />
      ))}
    </aside>
  );
}
