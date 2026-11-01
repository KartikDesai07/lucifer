// The item editor's price modes (U5 Task 3; owner Q9; design 6.9). Pure: no React, no fetching; client-safe.
//
// "Single price / Sizes" is the HTML's name for today's "Has variations" switch: Sizes = `variations` is an array, Single
// = it is absent (never []: the schema is omit-empty). In Sizes mode the base-price box is hidden, so:
//  - a NEW sized item sends price 0 (the sizes carry the prices);
//  - an EDIT sends the form's price as it is (the stored one, unless the owner typed another in Single mode first);
//  - a base-price problem nobody can see never blocks Save (valuesForValidation);
//  - Sizes -> Single shows the stored price again (the form never dropped it).
import type { z } from "zod";

import type { createProductSchema } from "@/schemas";
import { MAX_VARIATIONS } from "@/lib/constants";
import type { ProductVariation } from "@/types";

/** The form holds the schema's (looser) INPUT type, several fields carry zod defaults; submit receives the transformed output. */
export type ProductFormValues = z.input<typeof createProductSchema>;

export type PriceMode = "single" | "sizes";

/** What the save sends as `price`. */
export function priceForSave(values: { hasVariations: boolean; price: number }, isNew: boolean): number {
  if (values.hasVariations && isNew) return 0;
  return values.price;
}

/** The form's values as the schema should judge them: in Sizes mode an empty or garbled (NaN) hidden base price reads as 0,
 *  so an error on a box nobody sees can never stop Save. Single mode is judged as typed. */
export function valuesForValidation<T extends { price?: unknown; variations?: unknown }>(values: T): T {
  if (!Array.isArray(values.variations)) return values;
  if (typeof values.price === "number" && Number.isFinite(values.price)) return values;
  return { ...values, price: 0 };
}

/** The mode switch's next form state. To Sizes: today's seed (one empty row), and an empty base price falls back to the
 *  stored one so the hidden box is never the cause of an invisible error. To Single: the sizes go (absent, never []) and
 *  the stored price shows again. */
export function switchPriceMode(
  current: { price: number; variations: ProductVariation[] | undefined },
  to: PriceMode,
  storedPrice: number,
): { price: number; variations: ProductVariation[] | undefined } {
  const price = Number.isFinite(current.price) ? current.price : storedPrice;
  if (to === "sizes") return { price, variations: current.variations ?? [{ name: "", price: 0 }] };
  return { price, variations: undefined };
}

/** "Add size": one more empty row, never past today's cap. */
export function addSizeRow(rows: ProductVariation[]): ProductVariation[] {
  if (rows.length >= MAX_VARIATIONS) return rows;
  return [...rows, { name: "", price: 0 }];
}
