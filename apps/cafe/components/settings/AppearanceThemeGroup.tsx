"use client";

import { useId } from "react";
import { Controller } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { PRESET_IDS } from "@pos/shared/appearance";
import type { PresetId } from "@pos/shared/appearance";
import { APPEARANCE_PRESETS } from "@pos/shared/appearance-presets";
import { cn } from "@/lib/utils";
import {
  SETTINGS_MAIN_CARD_CLASS,
  SETTINGS_TILE_CLASS,
  SETTINGS_TILE_OFF_CLASS,
  SETTINGS_TILE_ON_CLASS,
} from "@/lib/settings-card-layout";
import { SettingsCard } from "@/components/settings/SettingsCard";

// The 3 swatch dots per theme tile — a fixed key order, never derived from
// Object.keys (whose order isn't a contract).
const SWATCH_KEYS = ["background", "card", "primary"] as const;

// A theme tile: the shared tile look, one 44px-high cell of the grid.
const THEME_TILE_CLASS = "min-h-11 min-w-0 justify-center";

// One tile per theme: a <label> around a visually hidden native radio, so arrow
// keys and screen readers work as for any radio group (the SettingsChoice idiom).
function ThemeTiles({ value, onChange }: { value: PresetId | undefined; onChange: (id: PresetId) => void }) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PRESET_IDS.map((id) => {
          const preset = APPEARANCE_PRESETS[id];
          const selected = value === id;
          return (
            <label
              key={id}
              className={cn(SETTINGS_TILE_CLASS, THEME_TILE_CLASS, selected ? SETTINGS_TILE_ON_CLASS : SETTINGS_TILE_OFF_CLASS)}
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
                    className="h-6 w-6 rounded-full border border-border"
                  />
                ))}
              </span>
              <span className="break-words text-[14px] font-semibold leading-tight text-foreground">{preset.label}</span>
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
    <SettingsCard title="Theme" sub="The colours of your menu." className={SETTINGS_MAIN_CARD_CLASS}>
      <Controller
        control={control}
        name="appearance.presetId"
        render={({ field }) => <ThemeTiles value={field.value} onChange={field.onChange} />}
      />
    </SettingsCard>
  );
}
