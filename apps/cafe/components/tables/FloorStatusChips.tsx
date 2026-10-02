"use client";

import { cn } from "@/lib/utils";
import type { TableStatus } from "@/lib/constants";
import type { FloorFilter } from "@/lib/floor-tiles";
import { TABLE_STATUS_META } from "@/lib/table-status";

interface FloorStatusChipsProps {
  counts: Record<FloorFilter, number>;
  value: FloorFilter;
  onChange: (next: FloorFilter) => void;
}

// State-count filters: they filter the grid AND are the colour legend (each
// swatch is the status colour, each label its status text). They WRAP onto a
// second line on a narrow phone — a sideways-scrolling row hides the last state.
// One selected style for every filter, All included.
const CHIP_ORDER: readonly TableStatus[] = ["Occupied", "Available", "Reserved"];
const CHIP_BASE =
  "inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm text-brand-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";
const CHIP_IDLE = "border-brand-rule bg-brand-slip hover:bg-brand-wash";
const CHIP_SELECTED = "border-brand-primary bg-brand-primary-soft font-semibold";
const COUNT_CLASS = "tabular-nums text-brand-muted";

export function FloorStatusChips({ counts, value, onChange }: FloorStatusChipsProps) {
  return (
    <div role="group" aria-label="Filter tables by status" className="flex flex-wrap gap-2">
      <button
        type="button"
        aria-pressed={value === "all"}
        onClick={() => onChange("all")}
        className={cn(CHIP_BASE, value === "all" ? CHIP_SELECTED : CHIP_IDLE)}
      >
        All <span className={COUNT_CLASS}>{counts.all}</span>
      </button>
      {CHIP_ORDER.map((status) => {
        const meta = TABLE_STATUS_META[status];
        const selected = value === status;
        return (
          <button
            key={status}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(status)}
            className={cn(CHIP_BASE, selected ? CHIP_SELECTED : CHIP_IDLE)}
          >
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", meta.dotClass)} aria-hidden />
            {meta.label} <span className={COUNT_CLASS}>{counts[status]}</span>
          </button>
        );
      })}
    </div>
  );
}
