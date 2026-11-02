"use client";

import { Controller, type Control, type FieldErrors, type UseFormGetValues, type UseFormRegister, type UseFormSetValue } from "react-hook-form";

import { VariationsField } from "@/components/products/VariationsField";
import { switchPriceMode, type PriceMode, type ProductFormValues } from "@/lib/product-form-values";
import {
  MENU_EDITOR_CELL_LEFT_CLASS,
  MENU_EDITOR_ERROR_CLASS,
  MENU_EDITOR_LABEL_CLASS,
  MENU_EDITOR_MODE_BUTTON_CLASS,
  MENU_EDITOR_MODE_OFF_CLASS,
  MENU_EDITOR_MODE_ON_CLASS,
  MENU_EDITOR_MODE_TRACK_CLASS,
  MENU_EDITOR_NUMBER_CLASS,
  MENU_EDITOR_PRICE_BOX_CLASS,
  MENU_EDITOR_PRICE_CLASS,
  MENU_EDITOR_PRICE_HEAD_CLASS,
} from "@/lib/menu-editor-layout";
import { cn } from "@/lib/utils";

interface PriceModeFieldProps {
  control: Control<ProductFormValues>;
  register: UseFormRegister<ProductFormValues>;
  errors: FieldErrors<ProductFormValues>;
  getValues: UseFormGetValues<ProductFormValues>;
  setValue: UseFormSetValue<ProductFormValues>;
  /** The item's stored price (0 for a new item): what a cleared base price falls back to when sizes switch on. */
  storedPrice: number;
}

const MODES: { mode: PriceMode; label: string }[] = [
  { mode: "single", label: "Single price" },
  { mode: "sizes", label: "Sizes" },
];

// The Price block (values 9.2 #3; owner Q9): the label and the HTML's Single price / Sizes switch (today's "Has variations" in
// the HTML's words), then the rupee box or the size rows. In Sizes mode the base-price box is not drawn: the form keeps its
// value (an edit sends the stored price, a new sized item 0: lib/product-form-values.ts) and a problem with it never blocks Save.
export function PriceModeField({ control, register, errors, getValues, setValue, storedPrice }: PriceModeFieldProps) {
  return (
    <Controller
      control={control}
      name="variations"
      render={({ field }) => {
        const sizes = Array.isArray(field.value);
        const pick = (mode: PriceMode) => {
          if ((mode === "sizes") === sizes) return;
          const next = switchPriceMode({ price: getValues("price"), variations: field.value }, mode, storedPrice);
          setValue("price", next.price);
          // Off is `undefined`, NOT [] — the schema is omit-empty; the save turns it into the explicit null.
          field.onChange(next.variations);
        };
        return (
          <div data-ui="item-price" className={MENU_EDITOR_PRICE_CLASS}>
            <div className={MENU_EDITOR_PRICE_HEAD_CLASS}>
              <span id="item-price-label" className={MENU_EDITOR_LABEL_CLASS}>
                Price
              </span>
              <div role="group" aria-label="Price mode" className={MENU_EDITOR_MODE_TRACK_CLASS}>
                {MODES.map(({ mode, label }) => {
                  const on = (mode === "sizes") === sizes;
                  return (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={on}
                      className={cn(MENU_EDITOR_MODE_BUTTON_CLASS, on ? MENU_EDITOR_MODE_ON_CLASS : MENU_EDITOR_MODE_OFF_CLASS)}
                      onClick={() => pick(mode)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {Array.isArray(field.value) ? (
              <VariationsField value={field.value} onChange={field.onChange} errors={errors} />
            ) : (
              <>
                <div className={MENU_EDITOR_PRICE_BOX_CLASS}>
                  <label htmlFor="item-price-input" className={MENU_EDITOR_CELL_LEFT_CLASS}>
                    ₹
                  </label>
                  <input
                    id="item-price-input"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    placeholder="0"
                    aria-label="Price (₹)"
                    aria-invalid={!!errors.price}
                    className={MENU_EDITOR_NUMBER_CLASS}
                    {...register("price", { valueAsNumber: true })}
                  />
                </div>
                {errors.price?.message && <p className={MENU_EDITOR_ERROR_CLASS}>{errors.price.message}</p>}
              </>
            )}
          </div>
        );
      }}
    />
  );
}
