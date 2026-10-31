"use client";

import { KITCHEN_FILTERS, type KitchenFilter } from "@/lib/kitchen-header";
import {
  KITCHEN_FILTER_TAB_CLASS,
  KITCHEN_FILTER_TAB_OFF_CLASS,
  KITCHEN_FILTER_TAB_ON_CLASS,
  KITCHEN_FILTER_TRACK_CLASS,
} from "@/lib/kitchen-layout";
import { cn } from "@/lib/utils";

interface KitchenTypeFilterProps {
  /** The tab chosen (the page's state; the page shows All below 720px whatever this says). */
  value: KitchenFilter;
  onChange: (filter: KitchenFilter) => void;
}

// The Kitchen header's type filter (U4 Task 2; owner Q2, design 6.1, values 2.1): the HTML's segmented control with our
// words, All · Tables · Walk-In, the chosen tab on the white chip. Client-side only: no request. Not drawn below 720px
// (the track's max-tab:hidden, the HTML's kdTypes). A group of toggle buttons, as U3's pills (the HTML has no roles).
export function KitchenTypeFilter({ value, onChange }: KitchenTypeFilterProps) {
  return (
    <div role="group" aria-label="Filter orders by type" data-ui="kitchen-type-filter" className={KITCHEN_FILTER_TRACK_CLASS}>
      {KITCHEN_FILTERS.map(({ key, label }) => {
        const on = key === value;
        return (
          <button
            key={key}
            type="button"
            data-ui="kitchen-type-tab"
            aria-pressed={on}
            onClick={() => onChange(key)}
            className={cn(KITCHEN_FILTER_TAB_CLASS, on ? KITCHEN_FILTER_TAB_ON_CLASS : KITCHEN_FILTER_TAB_OFF_CLASS)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
