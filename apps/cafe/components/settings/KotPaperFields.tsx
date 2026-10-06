"use client";

import { Controller } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { PRINT_FONT_SIZES } from "@/lib/constants";
import { SettingsGroup } from "@/components/settings/SettingsFields";
import { PaperWidthPicker } from "@/components/settings/PaperWidthPicker";
import { PrintSizeChoice } from "@/components/settings/PrintSizeChoice";

interface KotPaperFieldsProps {
  control: Control<SettingsInput>;
  // False while a ticket design is being edited: the design carries its own base size (Font and text size), so
  // this legacy size would be a second, silent control. Its value stays untouched in the form.
  showTextSize?: boolean;
}

// Paper and text size for the kitchen ticket: two paper tiles and three text
// size buttons, no drop-downs. The twin of BillPaperFields.
export function KotPaperFields({ control, showTextSize = true }: KotPaperFieldsProps) {
  return (
    <SettingsGroup
      stacked
      title={showTextSize ? "Paper and text size" : "Paper"}
      description="Pick the paper in the kitchen printer, or the ticket prints cut off."
    >
      <Controller
        control={control}
        name="kotPaperWidth"
        render={({ field }) => (
          <PaperWidthPicker legend="Paper width" value={field.value} onChange={field.onChange} />
        )}
      />
      {showTextSize && (
        <Controller
          control={control}
          name="kotFontSize"
          render={({ field }) => (
            <PrintSizeChoice
              legend="Text size"
              options={PRINT_FONT_SIZES}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      )}
    </SettingsGroup>
  );
}
