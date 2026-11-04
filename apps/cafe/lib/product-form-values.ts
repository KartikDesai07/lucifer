// The item editor's price modes (U5 Task 3; owner Q9; design 6.9). Pure: no React, no fetching; client-safe.
//
// "Single price / Sizes" is the HTML's name for today's "Has variations" switch: Sizes = `variations` is an array, Single
// = it is absent (never []: the schema is omit-empty). In Sizes mode the base-price box is hidden, so:
//  - a NEW sized item sends price 0 (the sizes carry the prices);
//  - an EDIT sends the form's price as it is (the stored one, unless the owner typed another in Single mode first);
//  - a base-price problem nobody can see never blocks Save (valuesForValidation);
//  - Sizes -> Single shows the stored price again (the form never dropped it).
import type { z } from "zod";
import { VARIATION_PRICE_MAX } from "@pos/shared/constants";
import { productAddOnsError } from "@pos/shared/modifier-prices";
import { isProductIconKey } from "@pos/shared/product-icons";

import type { createProductSchema } from "@/schemas";
import { MAX_VARIATIONS } from "@/lib/constants";
import type { Product, ProductModifierPrice, ProductVariation } from "@/types";

/** The form holds the schema's (looser) INPUT type, several fields carry zod defaults; submit receives the transformed output. */
export type ProductFormValues = z.input<typeof createProductSchema>;

export type PriceMode = "single" | "sizes";

/** The editor's values for a stored item. The lists are fresh copies, so editing the form never touches the query cache. */
export function formValuesFromProduct(product: Product): ProductFormValues {
  return {
    name: product.name,
    categoryId: product.categoryId,
    price: product.price,
    variations: product.variations?.map((v) => ({ ...v })),
    discount: product.discount,
    // Legacy items (pre-`available`) read as available.
    available: product.available !== false,
    image: product.image,
    modifiers: Array.from(product.modifiers ?? []),
    modifiersPreselected: product.modifiersPreselected === true,
    modifierPrices: product.modifierPrices?.map((p) => ({ ...p })),
    publicVisible: product.publicVisible,
    // A stored key that predates a catalogue change reads as "none": saving would resend an icon the enum now rejects (400).
    icon: isProductIconKey(product.icon) ? product.icon : undefined,
    // The saved id as it is: a station list still loading never clears it on save.
    stationId: product.stationId,
    noKot: product.noKot,
  };
}

/** "Copy item": the same values under "<name> (copy)". Nothing server-side carries over (_id, timestamps, archived state);
 *  nothing is created until the form is saved. */
export function copyFormValues(product: Product): ProductFormValues {
  return { ...formValuesFromProduct(product), name: `${product.name} (copy)` };
}

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

// Priced add-ons (owner 2026-11-02, D3, D4): an optional whole-rupee amount per add-on. The form holds `modifierPrices`
// as the list of add-ons that HAVE an amount (empty box = free = not in the list); absent stays absent.

/** The amounts the save sends: only entries whose name is exactly one of the item's add-ons, each once (an add-on
 *  removed or renamed since its amount was typed drops it). */
export function modifierPricesForSave(values: {
  modifiers?: readonly string[];
  modifierPrices?: readonly ProductModifierPrice[];
}): ProductModifierPrice[] {
  const known = values.modifiers ?? [];
  const kept: ProductModifierPrice[] = [];
  for (const { name, price } of values.modifierPrices ?? []) {
    if (known.includes(name) && !kept.some((p) => p.name === name)) kept.push({ name, price });
  }
  return kept;
}

/** A create sends the list, or no key at all when no add-on has an amount. */
export function modifierPricesForCreate(values: Parameters<typeof modifierPricesForSave>[0]): ProductModifierPrice[] | undefined {
  const list = modifierPricesForSave(values);
  return list.length > 0 ? list : undefined;
}

/** An edit sends the list; `null` (the PUT's clear sentinel: undefined is dropped over JSON) when the item had amounts
 *  and now has none; nothing when it had none and has none. */
export function modifierPricesForEdit(
  values: Parameters<typeof modifierPricesForSave>[0],
  stored: readonly ProductModifierPrice[] | undefined,
): ProductModifierPrice[] | null | undefined {
  const list = modifierPricesForSave(values);
  if (list.length > 0) return list;
  return (stored?.length ?? 0) > 0 ? null : undefined;
}

/** The server's add-on rule (shared productAddOnsError) judged on what the save would send, so a refusal shows before the
 *  request. "Come ticked" counts only with at least one add-on (as modifiersPreselectedToSave). */
export function addOnsFormError(values: {
  modifiers?: readonly string[];
  modifiersPreselected?: boolean;
  modifierPrices?: readonly ProductModifierPrice[];
}): string | null {
  const modifiers = values.modifiers ?? [];
  return productAddOnsError({
    modifiers,
    modifiersPreselected: modifiers.length > 0 && values.modifiersPreselected === true,
    modifierPrices: modifierPricesForSave(values),
  });
}

/** The amount boxes hold at most as many digits as the largest amount the server accepts. */
const ADD_ON_AMOUNT_DIGITS_MAX = String(VARIATION_PRICE_MAX).length;

/** Sets (or, for an empty box, clears) one add-on's amount in the form's list. Whole rupees only (D4): the box keeps its
 *  digits and ignores anything else, so "12.5" or "abc" can never be typed. */
export function setAddOnAmount(
  prices: readonly ProductModifierPrice[],
  name: string,
  text: string,
): ProductModifierPrice[] {
  const rest = prices.filter((p) => p.name !== name);
  const digits = text.replace(/\D/g, "").slice(0, ADD_ON_AMOUNT_DIGITS_MAX);
  return digits === "" ? rest : [...rest, { name, price: Number(digits) }];
}
