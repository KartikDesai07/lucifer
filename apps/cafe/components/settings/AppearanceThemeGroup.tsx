"use client";

import { useId } from "react";
import { Controller } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { PRESET_IDS } from "@pos/shared/appearance";
import type { PresetId } from "@pos/shared/appearance";
import { APPEARANCE_PRESETS } from "@pos/shared/appearance-presets";
import { cn } from "@/lib/utils";
import { SettingsGroup } from "@/components/settings/SettingsFields";

// The 3 swatch dots per theme tile — a fixed key order, never derived from
// Object.keys (whose order isn't a contract).
const SWATCH_KEYS = ["background", "card", "primary"] as const;

// One tile per theme: a <label> around a visually hidden native radio, so arrow
// keys and screen readers work as for any radio group (the PrintSizeChoice idiom).
function ThemeTiles({ value, onChange }: { value: PresetId | undefined; onChange: (id: PresetId) => void }) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        {PRESET_IDS.map((id) => {
          const preset = APPEARANCE_PRESETS[id];
          const selected = value === id;
          return (
            <label
              key={id}
              className={cn(
                "flex min-h-11 min-w-0 cursor-pointer flex-col justify-center gap-2 rounded-md border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-accent",
                selected
                  ? "border-brand-primary bg-brand-primary-soft"
                  : "border-brand-rule bg-brand-slip hover:bg-brand-wash",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={id}
                checked={selected}
                onChange={() => onChange(id)}
              />
              <span className="flex gap-1.5">
                {SWATCH_KEYS.map((key) => (
                  <span
                    key={key}
                    aria-hidden
                    style={{ backgroundColor: preset.light[key] }}
                    className="h-6 w-6 rounded-full border border-brand-rule"
                  />
                ))}
              </span>
              <span className="break-words text-sm font-medium leading-tight text-brand-ink">{preset.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// The theme: the base palette diners see on the public menu.
export function AppearanceThemeGroup({ control }: { control: Control<SettingsInput> }) {
  return (
    <SettingsGroup stacked title="Theme" description="The colours of your menu.">
      <Controller
        control={control}
        name="appearance.presetId"
        render={({ field }) => <ThemeTiles value={field.value} onChange={field.onChange} />}
      />
    </SettingsGroup>
  );
}
