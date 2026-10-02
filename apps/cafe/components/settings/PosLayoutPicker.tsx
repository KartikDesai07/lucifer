"use client";

import { useId } from "react";

import { POS_LAYOUTS } from "@/lib/constants";
import { cn } from "@/lib/utils";

type PosLayout = (typeof POS_LAYOUTS)[number];

// Plain-English copy for the POS_LAYOUTS enum — never render the raw
// camelCase value.
const POS_LAYOUT_COPY: Record<PosLayout, { label: string; description: string }> = {
  normal: { label: "Normal", description: "All items in one grid." },
  byCategory: {
    label: "By category",
    description: "Items grouped under each category's name, in the order set on the Categories screen.",
  },
};

const SKETCH_CLASS =
  "h-[4.5rem] overflow-hidden rounded-md border border-brand-rule bg-brand-paper p-2";
const CELL_CLASS = "h-2.5 rounded-[2px] bg-brand-rule";
const HEADING_BAR_CLASS = "h-1.5 w-8 rounded-sm bg-brand-muted/40";

// Normal: one grid of twelve cells.
const NORMAL_CELLS = Array.from({ length: 12 }, (_, i) => i);
// By category: a heading bar over a row of cells, twice.
const FIRST_ROW_CELLS = [0, 1, 2];
const SECOND_ROW_CELLS = [0, 1, 2, 3];

function LayoutSketch({ layout }: { layout: PosLayout }) {
  if (layout === "normal") {
    return (
      <div aria-hidden="true" className={SKETCH_CLASS}>
        <div className="grid grid-cols-4 gap-1">
          {NORMAL_CELLS.map((i) => (
            <div key={i} className={CELL_CLASS} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div aria-hidden="true" className={SKETCH_CLASS}>
      <div className="space-y-1">
        <div className={HEADING_BAR_CLASS} />
        <div className="grid grid-cols-4 gap-1">
          {FIRST_ROW_CELLS.map((i) => (
            <div key={i} className={CELL_CLASS} />
          ))}
        </div>
        <div className={HEADING_BAR_CLASS} />
        <div className="grid grid-cols-4 gap-1">
          {SECOND_ROW_CELLS.map((i) => (
            <div key={i} className={CELL_CLASS} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Two picture tiles instead of a drop-down: each tile is a <label> around a
// visually hidden native radio, so arrow keys and screen readers work as for
// any radio group.
export function PosLayoutPicker({
  value,
  onChange,
}: {
  value: PosLayout;
  onChange: (value: PosLayout) => void;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="sr-only">New order screen layout</legend>
      <div className="grid grid-cols-2 gap-3">
        {POS_LAYOUTS.map((option) => {
          const selected = value === option;
          const copy = POS_LAYOUT_COPY[option];
          return (
            <label
              key={option}
              className={cn(
                "flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-accent",
                selected
                  ? "border-brand-primary bg-brand-primary-soft"
                  : "border-brand-rule bg-brand-slip hover:bg-brand-wash",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
              />
              <LayoutSketch layout={option} />
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                    selected ? "border-brand-primary" : "border-brand-field",
                  )}
                >
                  {selected && <span className="h-2 w-2 rounded-full bg-brand-primary" />}
                </span>
                <span className="text-[13px] font-medium text-brand-ink">{copy.label}</span>
              </span>
              <span className="text-xs text-brand-muted">{copy.description}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
