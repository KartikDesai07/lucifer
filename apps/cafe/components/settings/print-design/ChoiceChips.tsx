"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";
import { BRAND_LABEL_CLASS } from "@/components/brand/brand-classes";
import { HINT_CLASS } from "@/components/settings/SettingsFields";

interface ChoiceChipsProps<T extends string> {
  legend: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labelOf: (value: T) => string;
  /** Options shown but not selectable (the hint says why). */
  disabledOptions?: readonly T[];
  hint?: string;
}

// A wrapping row of 44px choices for the editor's Sheet. A single choice is radio semantics (a visually hidden
// native radio inside each label), so arrow keys and screen readers work as in PrintSizeChoice; unlike it, the
// chips WRAP instead of sharing one line, so five sizes still fit a 360px phone.
export function ChoiceChips<T extends string>({
  legend,
  options,
  value,
  onChange,
  labelOf,
  disabledOptions = [],
  hint,
}: ChoiceChipsProps<T>) {
  const name = useId();
  const hintId = useId();
  return (
    <fieldset className="min-w-0 space-y-1.5" aria-describedby={hint ? hintId : undefined}>
      <legend className={cn("mb-1.5", BRAND_LABEL_CLASS)}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value === option;
          const disabled = disabledOptions.includes(option);
          return (
            <label
              key={option}
              className={cn(
                "flex min-h-11 min-w-0 items-center justify-center rounded-md border px-3 py-1 text-center text-sm font-medium text-brand-ink transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-accent",
                disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
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
                disabled={disabled}
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
