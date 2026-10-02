"use client";

import { Controller } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { PRINT_FONT_SIZES } from "@/lib/constants";
import { SettingsGroup } from "@/components/settings/SettingsFields";
import { PaperWidthPicker } from "@/components/settings/PaperWidthPicker";
import { PrintSizeChoice } from "@/components/settings/PrintSizeChoice";

// Paper and text size for the customer's bill: two paper tiles and three text
// size buttons, no drop-downs.
export function BillPaperFields({ control }: { control: Control<SettingsInput> }) {
  return (
    <SettingsGroup
      stacked
      title="Paper and text size"
      description="Pick the paper in your printer, or the bill prints cut off."
    >
      <Controller
        control={control}
        name="billPaperWidth"
        render={({ field }) => (
          <PaperWidthPicker legend="Paper width" value={field.value} onChange={field.onChange} />
        )}
      />
      <Controller
        control={control}
        name="billFontSize"
        render={({ field }) => (
          <PrintSizeChoice
            legend="Text size"
            options={PRINT_FONT_SIZES}
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />
    </SettingsGroup>
  );
}
