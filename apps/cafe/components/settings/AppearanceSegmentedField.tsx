"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// CR2.4 S5 — the role="tablist"/Button segmented-control idiom
// SettingsForm.tsx already uses for its own tab bar (:142-173), generalized
// over one closed enum at a time. AppearanceFields uses one instance each for
// cornerRadius/density/logoPlacement.
export function AppearanceSegmentedField<T extends string>({
  label,
  options,
  value,
  onChange,
  labels,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div role="tablist" aria-label={label} className="inline-flex gap-1 rounded-lg border p-1">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            role="tab"
            aria-selected={value === option}
            variant={value === option ? "default" : "ghost"}
            size="sm"
            onClick={() => onChange(option)}
          >
            {labels[option]}
          </Button>
        ))}
      </div>
    </div>
  );
}
