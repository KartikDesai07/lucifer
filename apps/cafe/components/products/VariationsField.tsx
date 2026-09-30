"use client";

import type { Control, FieldErrors } from "react-hook-form";
import { Controller } from "react-hook-form";
import type { z } from "zod";

import type { createProductSchema } from "@/schemas";
import { Switch } from "@/components/ui/switch";
import { FormField } from "@/components/shared/FormField";
import { VariationInput } from "@/components/products/VariationInput";
import { variationsErrorMessage } from "@/lib/variation-errors";

// The form's (looser) INPUT type — several fields carry zod defaults, so the
// form holds z.input, not the transformed z.output CreateProductInput. Must
// match ProductFormSheet's own useForm<ProductFormValues, ...> generic.
type ProductFormValues = z.input<typeof createProductSchema>;

interface VariationsFieldProps {
  control: Control<ProductFormValues>;
  errors: FieldErrors<ProductFormValues>;
}

// The "Has variations" switch + row editor, pulled out of ProductFormSheet.tsx
// (already at its ~300-line budget) verbatim — no behaviour change.
export function VariationsField({ control, errors }: VariationsFieldProps) {
  return (
    <Controller
      control={control}
      name="variations"
      render={({ field }) => (
        <>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Has variations</p>
              <p className="text-xs text-muted-foreground">
                Sell this item in named sizes (Small/Medium/Large…), each at
                its own price.
              </p>
            </div>
            <Switch
              aria-label="Has variations"
              checked={Array.isArray(field.value)}
              onCheckedChange={(checked) =>
                // Off → undefined, NOT [] — the schema is omit-empty. On →
                // seed one empty row so the operator has somewhere to type.
                field.onChange(checked ? [{ name: "", price: 0 }] : undefined)
              }
            />
          </div>
          {Array.isArray(field.value) && (
            <FormField
              label="Variations"
              // Not just `.message`: a blank row and the duplicate-name refine
              // both land as ROW errors, so reading only the list-level message
              // left Save doing nothing with nothing on screen.
              error={variationsErrorMessage(errors.variations)}
            >
              <VariationInput value={field.value} onChange={field.onChange} />
            </FormField>
          )}
        </>
      )}
    />
  );
}
