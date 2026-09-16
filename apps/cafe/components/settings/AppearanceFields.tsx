"use client";

import { Controller, useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import {
  PRESET_IDS,
  FONT_PAIR_KEYS,
  CORNER_RADII,
  DENSITIES,
  LOGO_PLACEMENTS,
  DEFAULT_APPEARANCE,
} from "@pos/shared/appearance";
import { APPEARANCE_PRESETS } from "@pos/shared/appearance-presets";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/settings/SettingsFields";
import { ImageUpload } from "@/components/shared/ImageUpload";
import { AppearancePreview } from "@/components/settings/AppearancePreview";
import { AppearanceAccentInput } from "@/components/settings/AppearanceAccentInput";
import { AppearanceSegmentedField } from "@/components/settings/AppearanceSegmentedField";
import {
  FONT_PAIR_LABELS,
  CORNER_RADIUS_LABELS,
  DENSITY_LABELS,
  LOGO_PLACEMENT_LABELS,
  accentSuggestionsFor,
} from "@/components/settings/appearance-fields-utils";

// The 3 swatch dots per preset thumbnail (S5) — a fixed key order, never
// derived from Object.keys (whose order isn't a contract).
const SWATCH_KEYS = ["background", "card", "primary"] as const;

interface AppearanceFieldsProps {
  control: Control<SettingsInput>;
}

// CR2.4 S5 — the Appearance tab: preset, accent, font pair, radius, density,
// logo placement, hero image, all Controller-driven on `appearance.*` (never
// register()/setValue() directly — a nested subdoc is saved as one whole unit,
// see settings.schema.ts's own comment on appearanceSchema). Owns the lg
// two-column grid: controls on the left, the live AppearancePreview on the
// right, sticky so it stays in view while the operator scrolls the controls.
export function AppearanceFields({ control }: AppearanceFieldsProps) {
  // Read-only elsewhere on this panel (the accent card's suggestions, the
  // preview's default swatch color) — always defined once appearance itself
  // is seeded (appearanceFormDefaults), the DEFAULT_APPEARANCE fallback only
  // covers the type-level `| undefined` from appearance being optional.
  const presetId = useWatch({ control, name: "appearance.presetId" }) ?? DEFAULT_APPEARANCE.presetId;

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Theme preset</CardTitle>
            <CardDescription>Sets the base palette diners see on the public menu.</CardDescription>
          </CardHeader>
          <CardContent>
            <Controller
              control={control}
              name="appearance.presetId"
              render={({ field }) => (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {PRESET_IDS.map((id) => {
                    const preset = APPEARANCE_PRESETS[id];
                    const selected = field.value === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => field.onChange(id)}
                        className={cn(
                          "flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors hover:bg-muted",
                          selected && "border-primary ring-1 ring-primary",
                        )}
                      >
                        <span className="flex gap-1">
                          {SWATCH_KEYS.map((key) => (
                            <span
                              key={key}
                              aria-hidden
                              style={{ backgroundColor: preset.light[key] }}
                              className="h-5 w-5 rounded-full border"
                            />
                          ))}
                        </span>
                        <span className="text-xs font-medium">{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Accent color</CardTitle>
            <CardDescription>Colors the call-to-action buttons across the public menu.</CardDescription>
          </CardHeader>
          <CardContent>
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
                  <div className="flex flex-wrap items-center gap-3">
                    {suggestions.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        aria-pressed={accentValue === hex}
                        aria-label={`Use accent ${hex}`}
                        onClick={() => field.onChange(hex)}
                        style={{ backgroundColor: hex }}
                        className={cn(
                          "h-8 w-8 shrink-0 rounded-full border-2",
                          accentValue === hex ? "border-foreground" : "border-transparent",
                        )}
                      />
                    ))}
                    <AppearanceAccentInput
                      value={accentValue}
                      presetAccent={preset.light.primary}
                      presetId={presetId}
                      onCommit={field.onChange}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={accentValue === ""}
                      onClick={() => field.onChange("")}
                    >
                      Use preset accent
                    </Button>
                  </div>
                );
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Typography &amp; layout</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Font pair">
              <Controller
                control={control}
                name="appearance.fontPairKey"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_PAIR_KEYS.map((key) => (
                        <SelectItem key={key} value={key}>
                          {FONT_PAIR_LABELS[key]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Controller
              control={control}
              name="appearance.cornerRadius"
              render={({ field }) => (
                <AppearanceSegmentedField
                  label="Corner radius"
                  options={CORNER_RADII}
                  value={field.value ?? DEFAULT_APPEARANCE.cornerRadius}
                  onChange={field.onChange}
                  labels={CORNER_RADIUS_LABELS}
                />
              )}
            />
            <Controller
              control={control}
              name="appearance.density"
              render={({ field }) => (
                <AppearanceSegmentedField
                  label="Density"
                  options={DENSITIES}
                  value={field.value ?? DEFAULT_APPEARANCE.density}
                  onChange={field.onChange}
                  labels={DENSITY_LABELS}
                />
              )}
            />
            <Controller
              control={control}
              name="appearance.logoPlacement"
              render={({ field }) => (
                <AppearanceSegmentedField
                  label="Logo placement"
                  options={LOGO_PLACEMENTS}
                  value={field.value ?? DEFAULT_APPEARANCE.logoPlacement}
                  onChange={field.onChange}
                  labels={LOGO_PLACEMENT_LABELS}
                />
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hero image</CardTitle>
            <CardDescription>A wide banner shown at the top of the public menu.</CardDescription>
          </CardHeader>
          <CardContent>
            <Controller
              control={control}
              name="appearance.heroImage"
              render={({ field }) => (
                <ImageUpload
                  slot="heroImage"
                  aspect="wide"
                  value={field.value ?? DEFAULT_APPEARANCE.heroImage}
                  onChange={field.onChange}
                  alt="Hero image"
                />
              )}
            />
          </CardContent>
        </Card>
      </div>

      <div className="lg:sticky lg:top-4">
        <AppearancePreview control={control} />
      </div>
    </div>
  );
}
