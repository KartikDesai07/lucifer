import { productAddOnsError } from "@pos/shared/modifier-prices";
import type { ProductModifierPrice } from "@pos/shared/types";
import { Product } from "@/models/Product";

// Priced add-ons (owner, 2026-11-02) — the PUT half of the product write rule.
// productAddOnsError judges the RESULTING product document, and a PUT body is
// partial: a bare `{ modifiersPreselected: true }` on an item that has amounts,
// or a `modifiers` edit that drops an add-on which has an amount, only breaks the
// rule once merged with the stored doc. So when the body touches any of the three
// keys the stored values are read once and merged (a key present in the body
// wins; `modifierPrices: null` = cleared, the PUT sentinel). A body with none of
// them reads nothing — a price/name/available edit costs no extra query. The
// route 404s a missing item itself, so a missing doc is simply "no objection".

/** The three product fields the rule reads. */
export interface AddOnFields {
  modifiers?: readonly string[];
  modifiersPreselected?: boolean | null;
  modifierPrices?: readonly ProductModifierPrice[] | null;
}

/** The stored doc's add-on fields, or null when there is no such product. */
export type AddOnReader = (id: string) => Promise<AddOnFields | null>;

const ADD_ON_KEYS = ["modifiers", "modifiersPreselected", "modifierPrices"] as const;

const readStoredAddOns: AddOnReader = (id) =>
  Product.findById(id).select("modifiers modifiersPreselected modifierPrices").lean<AddOnFields | null>();

export async function productUpdateAddOnsError(
  id: string,
  body: AddOnFields,
  read: AddOnReader = readStoredAddOns,
): Promise<string | null> {
  // Object.hasOwn, not `in`: a prototype key cannot pose as a present field.
  if (!ADD_ON_KEYS.some((k) => Object.hasOwn(body, k))) return null;
  const stored = await read(id);
  if (!stored) return null;
  const pick = <K extends (typeof ADD_ON_KEYS)[number]>(key: K): AddOnFields[K] =>
    Object.hasOwn(body, key) && body[key] !== undefined ? body[key] : stored[key];
  return productAddOnsError({
    modifiers: pick("modifiers"),
    modifiersPreselected: pick("modifiersPreselected"),
    modifierPrices: pick("modifierPrices"),
  });
}
