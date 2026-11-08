"use client";

import { ArrowDown } from "lucide-react";
import { Controller, useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { DEFAULT_APPEARANCE } from "@pos/shared/appearance";
import { APPEARANCE_PREVIEW_CLASS, SETTINGS_MAIN_CARD_CLASS, SETTINGS_PREVIEW_GRID_CLASS } from "@/lib/settings-card-layout";
import { SettingsCard } from "@/components/settings/SettingsCard";
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
// comment on appearanceSchema). One column of cards; from xl (1280px) the live
// menu preview is a sticky 340px column on the right, spanning the four form
// cards. Below xl the preview comes last, with a jump link at the top. The
// sticky column clears the 56px header (top-20) and the sticky save bar (11rem)
// and scrolls inside itself, so the whole preview is reachable.
export function AppearanceFields({ control }: AppearanceFieldsProps) {
  // Read-only here (the button colour group's suggestions and default swatch) —
  // always defined once appearance itself is seeded (appearanceFormDefaults),
  // the DEFAULT_APPEARANCE fallback only covers the type-level `| undefined`
  // from appearance being optional.
  const presetId = useWatch({ control, name: "appearance.presetId" }) ?? DEFAULT_APPEARANCE.presetId;

  return (
    <div className={SETTINGS_PREVIEW_GRID_CLASS}>
      <a
        href="#appearance-preview"
        className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13.5px] font-semibold text-primary xl:hidden"
      >
        <ArrowDown aria-hidden="true" className="h-4 w-4" />
        See the preview
      </a>
      <AppearanceThemeGroup control={control} />
      <AppearanceAccentGroup control={control} presetId={presetId} />
      <AppearanceTextLayoutGroup control={control} />
      <SettingsCard
        title="Banner picture"
        sub="A wide photo across the top of your menu. Leave it empty for no banner."
        className={SETTINGS_MAIN_CARD_CLASS}
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
      </SettingsCard>
      <SettingsCard
        id="appearance-preview"
        title="Preview"
        sub="What diners see on their phone after they scan your table QR code. It changes as you edit."
        className={APPEARANCE_PREVIEW_CLASS}
        bodyClassName="rounded-b-[12px] bg-surface-2 p-3"
      >
        <AppearancePreview control={control} />
      </SettingsCard>
    </div>
  );
}
