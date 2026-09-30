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

// State-count chips: they filter the grid AND are the colour legend (each dot is
// the tile's stripe colour, each label its status text). They WRAP onto a second
// line on a narrow phone — a sideways-scrolling chip row hides the last state.
const CHIP_ORDER: readonly TableStatus[] = ["Occupied", "Available", "Reserved"];
const CHIP_BASE =
  "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";

export function FloorStatusChips({ counts, value, onChange }: FloorStatusChipsProps) {
  return (
    <div role="group" aria-label="Filter tables by status" className="flex flex-wrap gap-2">
      <button
        type="button"
        aria-pressed={value === "all"}
        onClick={() => onChange("all")}
        className={cn(
          CHIP_BASE,
          value === "all"
            ? "border-brand-primary bg-brand-primary font-semibold text-white"
            : "border-brand-rule bg-brand-slip text-brand-ink hover:bg-brand-wash",
        )}
      >
        All <span className="font-semibold tabular-nums">{counts.all}</span>
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
            className={cn(
              CHIP_BASE,
              selected
                ? "border-brand-primary bg-brand-primary-soft font-semibold text-brand-ink"
                : "border-brand-rule bg-brand-slip text-brand-ink hover:bg-brand-wash",
            )}
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dotClass)} aria-hidden />
            {meta.label} <span className="font-semibold tabular-nums">{counts[status]}</span>
          </button>
        );
      })}
    </div>
  );
}
