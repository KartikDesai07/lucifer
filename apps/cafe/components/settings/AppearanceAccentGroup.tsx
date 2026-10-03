"use client";

import { Controller } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { DEFAULT_APPEARANCE } from "@pos/shared/appearance";
import type { PresetId } from "@pos/shared/appearance";
import { APPEARANCE_PRESETS } from "@pos/shared/appearance-presets";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SettingsGroup } from "@/components/settings/SettingsFields";
import { AppearanceAccentInput } from "@/components/settings/AppearanceAccentInput";
import { accentSuggestionsFor } from "@/components/settings/appearance-fields-utils";

// The colour of the Add buttons and other main buttons: a row of ready-made
// swatches that always pass the contrast check, then a colour picker of the
// owner's own, then a way back to the theme's colour.
export function AppearanceAccentGroup({
  control,
  presetId,
}: {
  control: Control<SettingsInput>;
  presetId: PresetId;
}) {
  return (
    <SettingsGroup
      stacked
      title="Button colour"
      description="The colour of the Add buttons and other main buttons on your menu."
    >
      <Controller
        control={control}
        name="appearance.accentOverride"
        render={({ field }) => {
          const preset = APPEARANCE_PRESETS[presetId];
          const suggestions = accentSuggestionsFor(presetId);
          // `appearance` is optional at the schema/type level (nested
          // subdoc, S2), so `field.value` types as `string | undefined`
          // even though appearanceFormDefaults always seeds it at
          // runtime — this local fallback is the type-level guard only.
          const accentValue = field.value ?? DEFAULT_APPEARANCE.accentOverride;
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                {suggestions.map((hex, index) => (
                  <button
                    key={hex}
                    type="button"
                    aria-pressed={accentValue === hex}
                    aria-label={`Suggested colour ${index + 1}`}
                    onClick={() => field.onChange(hex)}
                    style={{ backgroundColor: hex }}
                    className={cn(
                      "h-11 w-11 shrink-0 rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2",
                      accentValue === hex ? "border-foreground" : "border-transparent",
                    )}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <AppearanceAccentInput
                  value={accentValue}
                  presetAccent={preset.light.primary}
                  presetId={presetId}
                  onCommit={field.onChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 md:h-10"
                  disabled={accentValue === ""}
                  onClick={() => field.onChange("")}
                >
                  Use the theme&apos;s colour
                </Button>
              </div>
            </div>
          );
        }}
      />
    </SettingsGroup>
  );
}
