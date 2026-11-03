// Priced add-ons (owner, 2026-11-02): an ADDED modifier can carry an amount
// (Cheese Burst +₹100). The one price rule every pricer adds — the POS cart,
// the diner's cart, the QR request pricer, the accept re-price and the staff
// menu re-check — plus the server's snapshot of what a line was charged and
// the bill's "+ Cheese Burst ₹100" line. Pure and client-safe. Kept out of
// modifiers.ts because it needs `inr` from ./utils, which re-exports that file.
//
// Owner decisions: D1 the bill prints the amount beside each add-on (the KOT
// keeps orderItemModifierLines, names only); D2 the item's own % discount
// applies to the item price only, the add-on is charged in full; D3 no amounts
// on an item whose add-ons come ticked; D4 whole rupees only.
//
// Every lookup is an array `find`/`includes`, never a keyed object, so an
// add-on literally named "constructor" resolves by membership alone.

import { VARIATION_PRICE_MAX } from "./constants";
import { ADDED_MODIFIER_PREFIX, orderItemModifierLines } from "./modifiers";
import type { ProductModifierPrice } from "./types";
import { inr } from "./utils";

/** The product fields the price rule reads. */
export interface AddOnProduct {
  modifiers?: readonly string[];
  modifiersPreselected?: boolean;
  modifierPrices?: readonly ProductModifierPrice[];
}

/** The amounts this line's picked add-ons are charged per unit: priced picks
 *  only (an amount counts only while its name is one of the item's add-ons),
 *  each once, sorted by name. Empty on an item whose add-ons come ticked (D3)
 *  and on every item without amounts. The server stamps this onto the written
 *  line (omit-empty: the caller drops an empty list). */
export function lineModifierPrices(
  product: AddOnProduct,
  picked: readonly string[],
): ProductModifierPrice[] {
  if (product.modifiersPreselected === true) return [];
  const prices = product.modifierPrices ?? [];
  if (prices.length === 0) return [];
  const known = product.modifiers ?? [];
  const stamp: ProductModifierPrice[] = [];
  for (const name of picked) {
    if (!known.includes(name) || stamp.some((p) => p.name === name)) continue;
    const priced = prices.find((p) => p.name === name);
    if (priced) stamp.push({ name, price: priced.price });
  }
  // Code-unit order, never localeCompare: the server, every browser and the
  // bill's line key must agree byte for byte.
  return stamp.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** What the picked add-ons add to ONE unit (D2: added after the item's own
 *  discount, never discounted). Always the sum of lineModifierPrices. */
export function addOnTotal(product: AddOnProduct, picked: readonly string[]): number {
  return lineModifierPrices(product, picked).reduce((sum, p) => sum + p.price, 0);
}

/** True when a line names one add-on more than once — refused by both order
 *  schemas (it would print "+ X, X" and could charge X twice). */
export function hasRepeatedModifier(modifiers: readonly string[]): boolean {
  return new Set(modifiers).size !== modifiers.length;
}

export const REPEATED_MODIFIER_MESSAGE = "The same add-on is picked twice on one item";
export const ADD_ON_PRICES_TICKED_ERROR =
  "Add-on amounts cannot be set while the item's add-ons come ticked — turn that off, or clear the amounts";
export const ADD_ON_PRICE_WHOLE_ERROR = (name: string) =>
  `The amount for "${name}" must be whole rupees, from 1 to ${VARIATION_PRICE_MAX}`;
export const ADD_ON_PRICE_REPEATED_ERROR = (name: string) => `"${name}" has more than one amount`;
export const ADD_ON_PRICE_UNKNOWN_ERROR = (name: string) =>
  `"${name}" has an amount but is not one of this item's add-ons`;

/** The product write rule (D3, D4), judged on the RESULTING document — the
 *  create body, or the stored item merged with a PUT body — so a bare
 *  `{ modifiersPreselected: true }` on an item with amounts is refused too.
 *  `null` amounts mean "cleared" (the PUT sentinel). Returns the first
 *  rejection message, or null. */
export function productAddOnsError(doc: {
  modifiers?: readonly string[];
  modifiersPreselected?: boolean | null;
  modifierPrices?: readonly ProductModifierPrice[] | null;
}): string | null {
  const prices = doc.modifierPrices ?? [];
  if (prices.length === 0) return null;
  if (doc.modifiersPreselected === true) return ADD_ON_PRICES_TICKED_ERROR;
  const known = doc.modifiers ?? [];
  for (const [i, { name, price }] of prices.entries()) {
    if (!Number.isInteger(price) || price < 1 || price > VARIATION_PRICE_MAX) {
      return ADD_ON_PRICE_WHOLE_ERROR(name);
    }
    if (prices.findIndex((p) => p.name === name) !== i) return ADD_ON_PRICE_REPEATED_ERROR(name);
    if (!known.includes(name)) return ADD_ON_PRICE_UNKNOWN_ERROR(name);
  }
  return null;
}

/** The BILL's modifier lines (D1): orderItemModifierLines with the charged
 *  amount after each priced add-on — "+ Cheese Burst ₹100, Jalapeno". The
 *  amount is per unit (the line amount is already unit x qty). A line with no
 *  snapshot prints exactly what orderItemModifierLines prints. Kitchen paper
 *  (KOT, kitchen screen, void slip) never calls this. */
export function billModifierLines(item: {
  modifiers?: readonly string[];
  removedModifiers?: readonly string[];
  modifierPrices?: readonly ProductModifierPrice[];
}): string[] {
  const lines = orderItemModifierLines(item);
  const prices = item.modifierPrices ?? [];
  const added = item.modifiers ?? [];
  if (prices.length === 0 || added.length === 0) return lines;
  const priced = added.map((name) => {
    const match = prices.find((p) => p.name === name);
    return match ? `${name} ${inr(match.price)}` : name;
  });
  // The additions line is always the last one orderItemModifierLines returns.
  return [...lines.slice(0, -1), `${ADDED_MODIFIER_PREFIX} ${priced.join(", ")}`];
}
