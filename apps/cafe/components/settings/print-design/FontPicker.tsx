"use client";

import { useId } from "react";

import { printFontFaceOf, printFontStack } from "@pos/shared/print-fonts";
import type { PrintFontKey } from "@pos/shared/print-template";
import { cn } from "@/lib/utils";
import { BRAND_LABEL_CLASS } from "@/components/brand/brand-classes";
import { BASE_FONT_CHOICES } from "@/lib/print-design-editor";
import { FONT_LABEL, FONT_SAMPLE_TEXT } from "@/lib/print-design-labels";

interface FontPickerProps {
  value: PrintFontKey;
  onChange: (font: PrintFontKey) => void;
}

// The bill's base face. Each option shows "Masala chai ₹40" in its own face, so the choice is seen before it is
// made. A face the editor no longer offers (a stored slab) still shows, selected, so the saved choice is never hidden.
export function FontPicker({ value, onChange }: FontPickerProps) {
  const name = useId();
  const options = BASE_FONT_CHOICES.includes(value) ? BASE_FONT_CHOICES : [...BASE_FONT_CHOICES, value];
  return (
    <fieldset className="min-w-0 space-y-1.5">
      <legend className={cn("mb-1.5", BRAND_LABEL_CLASS)}>Font</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((key) => {
          const selected = value === key;
          const face = printFontFaceOf(key);
          return (
            <label
              key={key}
              className={cn(
                "flex min-h-11 min-w-0 cursor-pointer flex-col justify-center rounded-md border px-3 py-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-accent",
                selected
                  ? "border-brand-primary bg-brand-primary-soft"
                  : "border-brand-rule bg-brand-slip hover:bg-brand-wash",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={key}
                checked={selected}
                onChange={() => onChange(key)}
              />
              <span className="text-xs text-brand-muted">{FONT_LABEL[key]}</span>
              <span
                className={cn("break-words text-base text-brand-ink", face === null && "font-mono")}
                style={face === null ? undefined : { fontFamily: printFontStack(face, false) }}
              >
                {FONT_SAMPLE_TEXT}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
