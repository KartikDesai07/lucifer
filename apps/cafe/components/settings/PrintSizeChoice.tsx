"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";
import { BRAND_LABEL_CLASS } from "@/components/brand/brand-classes";
import { HINT_CLASS } from "@/components/settings/SettingsFields";
import { capitalizePrintOption } from "@/components/settings/print-form-utils";

// A row of equal-width 44px choices (Small / Medium / Large) instead of a
// drop-down. A single choice is radio semantics: each button is a <label>
// around a visually hidden native radio, so arrow keys and screen readers work
// as for any radio group. Free of bill field names so the Kitchen ticket page
// can reuse it. An optional hint sits under the tiles and describes the group.
export function PrintSizeChoice<T extends string>({
  legend,
  options,
  value,
  onChange,
  labelOf = capitalizePrintOption,
  hint,
}: {
  legend: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labelOf?: (value: T) => string;
  hint?: React.ReactNode;
}) {
  const name = useId();
  const hintId = useId();
  return (
    <fieldset className="space-y-1.5" aria-describedby={hint ? hintId : undefined}>
      <legend className={cn("mb-1.5", BRAND_LABEL_CLASS)}>{legend}</legend>
      <div className="flex gap-2">
        {options.map((option) => {
          const selected = value === option;
          return (
            <label
              key={option}
              className={cn(
                "flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-medium text-brand-ink transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-accent",
                selected
                  ? "border-brand-primary bg-brand-primary-soft text-brand-ink"
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
              {labelOf(option)}
            </label>
          );
        })}
      </div>
      {hint && <p id={hintId} className={HINT_CLASS}>{hint}</p>}
    </fieldset>
  );
}
