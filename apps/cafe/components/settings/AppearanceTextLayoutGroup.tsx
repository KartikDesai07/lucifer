"use client";

import { useId } from "react";
import { Controller } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import {
  FONT_PAIR_KEYS,
  CORNER_RADII,
  DENSITIES,
  LOGO_PLACEMENTS,
  DEFAULT_APPEARANCE,
} from "@pos/shared/appearance";
import type { FontPairKey } from "@pos/shared/appearance";
import { FONT_PAIR_FAMILIES } from "@/lib/public-fonts";
import { cn } from "@/lib/utils";
import { BRAND_LABEL_CLASS } from "@/components/brand/brand-classes";
import { HINT_CLASS, SectionLink, SettingsGroup } from "@/components/settings/SettingsFields";
import { PrintSizeChoice } from "@/components/settings/PrintSizeChoice";
import {
  FONT_PAIR_LABELS,
  CORNER_RADIUS_LABELS,
  DENSITY_LABELS,
  LOGO_PLACEMENT_LABELS,
} from "@/components/settings/appearance-fields-utils";

// One tile per font pair, each name written in its own display font so the
// owner sees the typeface, not a description of it. Radio semantics, like
// PrintSizeChoice: a <label> around a visually hidden native radio.
function FontTiles({ value, onChange }: { value: FontPairKey; onChange: (key: FontPairKey) => void }) {
  const name = useId();
  const hintId = useId();
  return (
    <fieldset className="min-w-0 space-y-1.5" aria-describedby={hintId}>
      <legend className={cn("mb-1.5", BRAND_LABEL_CLASS)}>Font</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        {FONT_PAIR_KEYS.map((key) => {
          const selected = value === key;
          return (
            <label
              key={key}
              className={cn(
                "flex min-h-14 min-w-0 cursor-pointer flex-col justify-center rounded-md border px-3 py-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-accent",
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
              <span
                style={{ fontFamily: FONT_PAIR_FAMILIES[key].display }}
                className="break-words text-base leading-tight text-brand-ink"
              >
                {FONT_PAIR_LABELS[key].name}
              </span>
              <span className="text-xs text-brand-muted">{FONT_PAIR_LABELS[key].fonts}</span>
            </label>
          );
        })}
      </div>
      <p id={hintId} className={HINT_CLASS}>
        Each name is written in its font. The preview shows it on your menu.
      </p>
    </fieldset>
  );
}

// How the words, corners and spacing of the menu look, plus where the logo sits.
export function AppearanceTextLayoutGroup({ control }: { control: Control<SettingsInput> }) {
  return (
    <SettingsGroup
      stacked
      title="Text and layout"
      description="How the words, corners and spacing of your menu look."
    >
      <Controller
        control={control}
        name="appearance.fontPairKey"
        render={({ field }) => (
          <FontTiles value={field.value ?? DEFAULT_APPEARANCE.fontPairKey} onChange={field.onChange} />
        )}
      />
      <Controller
        control={control}
        name="appearance.cornerRadius"
        render={({ field }) => (
          <PrintSizeChoice
            legend="Corners"
            options={CORNER_RADII}
            value={field.value ?? DEFAULT_APPEARANCE.cornerRadius}
            onChange={field.onChange}
            labelOf={(v) => CORNER_RADIUS_LABELS[v]}
            hint="How round the buttons and dish cards are."
          />
        )}
      />
      <Controller
        control={control}
        name="appearance.density"
        render={({ field }) => (
          <PrintSizeChoice
            legend="Spacing"
            options={DENSITIES}
            value={field.value ?? DEFAULT_APPEARANCE.density}
            onChange={field.onChange}
            labelOf={(v) => DENSITY_LABELS[v]}
            hint="Compact fits more dishes on one screen. Roomy leaves more space around each dish."
          />
        )}
      />
      <Controller
        control={control}
        name="appearance.logoPlacement"
        render={({ field }) => (
          <PrintSizeChoice
            legend="Logo on the menu"
            options={LOGO_PLACEMENTS}
            value={field.value ?? DEFAULT_APPEARANCE.logoPlacement}
            onChange={field.onChange}
            labelOf={(v) => LOGO_PLACEMENT_LABELS[v]}
            hint={
              <>
                Where your logo sits at the top of the menu. Your logo is set in{" "}
                <SectionLink slug="business">Business details</SectionLink>.
              </>
            }
          />
        )}
      />
    </SettingsGroup>
  );
}
