"use client";

import { useId } from "react";

import { PAPER_WIDTHS } from "@/lib/constants";
import type { PaperWidth } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { BRAND_LABEL_CLASS } from "@/components/brand/brand-classes";

// Plain-English copy for the PAPER_WIDTHS enum — never render the raw value.
const PAPER_WIDTH_COPY: Record<PaperWidth, { label: string; description: string }> = {
  "58mm": { label: "58 mm", description: "Small printers" },
  "80mm": { label: "80 mm", description: "Standard printers" },
};

// The paper strip in each tile: the 58 mm roll is visibly narrower.
const STRIP_WIDTH_CLASS: Record<PaperWidth, string> = {
  "58mm": "w-12",
  "80mm": "w-16",
};
const SKETCH_CLASS =
  "flex h-[4.5rem] justify-center overflow-hidden rounded-md border border-brand-rule bg-brand-paper px-2 pt-2";
const STRIP_CLASS = "h-full space-y-1 border border-b-0 border-brand-rule bg-brand-slip p-1.5";
const LINE_CLASS = "h-1 rounded-sm bg-brand-rule";
// A few lines of different lengths, like a printed bill.
const STRIP_LINE_WIDTHS = ["w-full", "w-3/4", "w-full", "w-1/2"];

function PaperSketch({ width }: { width: PaperWidth }) {
  return (
    <div aria-hidden="true" className={SKETCH_CLASS}>
      <div className={cn(STRIP_CLASS, STRIP_WIDTH_CLASS[width])}>
        {STRIP_LINE_WIDTHS.map((lineWidth, i) => (
          <div key={i} className={cn(LINE_CLASS, lineWidth)} />
        ))}
      </div>
    </div>
  );
}

// Two picture tiles instead of a drop-down (PosLayoutPicker's idiom): each
// tile is a <label> around a visually hidden native radio, so arrow keys and
// screen readers work as for any radio group. Free of bill field names so the
// Kitchen ticket page can reuse it.
export function PaperWidthPicker({
  value,
  onChange,
  legend,
}: {
  value: PaperWidth;
  onChange: (value: PaperWidth) => void;
  legend: string;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-1.5">
      <legend className={cn("mb-1.5", BRAND_LABEL_CLASS)}>{legend}</legend>
      <div className="grid grid-cols-2 gap-3">
        {PAPER_WIDTHS.map((option) => {
          const selected = value === option;
          const copy = PAPER_WIDTH_COPY[option];
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
                aria-labelledby={`${name}-${option}-label`}
                aria-describedby={`${name}-${option}-description`}
              />
              <PaperSketch width={option} />
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
                <span id={`${name}-${option}-label`} className="text-[13px] font-medium text-brand-ink">
                  {copy.label}
                </span>
              </span>
              <span id={`${name}-${option}-description`} className="text-xs text-brand-muted">
                {copy.description}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
