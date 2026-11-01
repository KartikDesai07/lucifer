"use client";

import type { FieldErrors } from "react-hook-form";

import { VariationInput } from "@/components/products/VariationInput";
import { variationsErrorMessage } from "@/lib/variation-errors";
import { MENU_EDITOR_ERROR_CLASS } from "@/lib/menu-editor-layout";
import type { ProductVariation } from "@/types";

interface VariationsFieldProps {
  value: ProductVariation[];
  onChange: (next: ProductVariation[]) => void;
  errors: FieldErrors<{ variations?: unknown }>;
}

// The Sizes half of the Price block (values 9.2 #3), pulled out of ProductFormSheet.tsx: the rows and, under them, the one
// message (the HTML paints no red on the rows). Not just `.message`: a blank row and the duplicate-name refine both land as
// ROW errors, so reading only the list-level message left Save doing nothing with nothing on screen.
export function VariationsField({ value, onChange, errors }: VariationsFieldProps) {
  const error = variationsErrorMessage(errors.variations);
  return (
    <>
      <VariationInput value={value} onChange={onChange} />
      {error && <p className={MENU_EDITOR_ERROR_CLASS}>{error}</p>}
    </>
  );
}
