"use client";

import { ArrowDown } from "lucide-react";
import { Controller, useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { DEFAULT_APPEARANCE } from "@pos/shared/appearance";
import { SettingsGroup } from "@/components/settings/SettingsFields";
import { ImageUpload } from "@/components/shared/ImageUpload";
import { AppearancePreview } from "@/components/settings/AppearancePreview";
import { AppearanceThemeGroup } from "@/components/settings/AppearanceThemeGroup";
import { AppearanceAccentGroup } from "@/components/settings/AppearanceAccentGroup";
import { AppearanceTextLayoutGroup } from "@/components/settings/AppearanceTextLayoutGroup";

interface AppearanceFieldsProps {
  control: Control<SettingsInput>;
}

// The Appearance page: theme, button colour, text and layout, banner picture —
// all Controller-driven on `appearance.*` (never register()/setValue() directly:
// a nested subdoc is saved as one whole unit, see settings.schema.ts's own
// comment on appearanceSchema). Settings on the left, the live menu preview on
// the right, sticky on a computer. Below lg the preview stacks under the
// settings, with a jump link at the top. The sticky column clears the 56px
// header (top-20) and the sticky save bar (11rem) so the whole preview can
// scroll inside it.
export function AppearanceFields({ control }: AppearanceFieldsProps) {
  // Read-only here (the button colour group's suggestions and default swatch) —
  // always defined once appearance itself is seeded (appearanceFormDefaults),
  // the DEFAULT_APPEARANCE fallback only covers the type-level `| undefined`
  // from appearance being optional.
  const presetId = useWatch({ control, name: "appearance.presetId" }) ?? DEFAULT_APPEARANCE.presetId;

  return (
    <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-8 lg:space-y-0">
      <div className="space-y-6 lg:[&>section:first-of-type]:border-t-0 lg:[&>section:first-of-type]:pt-0">
        <a
          href="#appearance-preview"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-primary lg:hidden"
        >
          <ArrowDown aria-hidden="true" className="h-4 w-4" />
          See the preview
        </a>
        <AppearanceThemeGroup control={control} />
        <AppearanceAccentGroup control={control} presetId={presetId} />
        <AppearanceTextLayoutGroup control={control} />
        <SettingsGroup
          stacked
          title="Banner picture"
          description="A wide photo across the top of your menu. Leave it empty for no banner."
        >
          <Controller
            control={control}
            name="appearance.heroImage"
            render={({ field }) => (
              <ImageUpload
                slot="heroImage"
                aspect="wide"
                value={field.value ?? DEFAULT_APPEARANCE.heroImage}
                onChange={field.onChange}
                alt="Menu banner"
              />
            )}
          />
        </SettingsGroup>
      </div>
      <div className="border-t border-brand-rule pt-6 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto lg:border-t-0 lg:pt-0">
        <SettingsGroup
          stacked
          id="appearance-preview"
          title="Preview"
          description="What diners see on their phone after they scan your table QR code. It changes as you edit."
          panelClassName="bg-brand-wash p-3 sm:p-4"
        >
          <AppearancePreview control={control} />
        </SettingsGroup>
      </div>
    </div>
  );
}
