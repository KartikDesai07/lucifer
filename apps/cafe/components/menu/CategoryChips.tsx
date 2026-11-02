"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { categoryHueMap } from "@/lib/pos-categories";
import { MENU_CHIPS_CLASS, MENU_CHIP_CLASS, MENU_CHIP_OFF_CLASS, MENU_CHIP_ON_CLASS } from "@/lib/menu-layout";
import type { Category } from "@/types";

interface CategoryChipsProps {
  categories: Category[];
  allCount: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

// The phone's category chips (values 4.5; design 6.3), below 720px: 32px pills, "All {n}" then every category with its 7px
// hue dot, the chosen one --ink. Always drawn (the HTML's strip collapses to nothing behind a long list, values 23.3: not
// copied), flex-none so it never shrinks in the list column; scrolls sideways inside itself. A pick centres its chip.
export function CategoryChips({ categories, allCount, selectedId, onSelect }: CategoryChipsProps) {
  const hues = useMemo(() => categoryHueMap(categories), [categories]);
  const pick = (id: string | null, el: HTMLElement) => {
    onSelect(id);
    el.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
  };
  return (
    <div data-ui="menu-chips" className={MENU_CHIPS_CLASS}>
      <button
        type="button"
        data-ui="menu-chip"
        aria-pressed={selectedId === null}
        onClick={(e) => pick(null, e.currentTarget)}
        className={cn(MENU_CHIP_CLASS, selectedId === null ? MENU_CHIP_ON_CLASS : MENU_CHIP_OFF_CLASS)}
      >
        All {allCount}
      </button>
      {categories.map((c) => (
        <button
          key={c._id}
          type="button"
          data-ui="menu-chip"
          aria-pressed={selectedId === c._id}
          onClick={(e) => pick(c._id, e.currentTarget)}
          className={cn(MENU_CHIP_CLASS, selectedId === c._id ? MENU_CHIP_ON_CLASS : MENU_CHIP_OFF_CLASS)}
        >
          <span className="size-[7px] flex-none rounded-[50%]" style={{ background: hues.get(c._id) }} />
          {c.name}
        </button>
      ))}
    </div>
  );
}
