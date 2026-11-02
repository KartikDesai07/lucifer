import { lineModifierPrices, type AddOnProduct } from "@pos/shared/modifier-prices";
import type { ProductModifierPrice } from "@pos/shared/types";

// "Modifiers come ticked" (UI batch 1 F, 2026-09-29) — the pure open-reset and
// confirm rules shared by ModifierModal (POS) and PublicItemSheet (diner),
// pulled out so this logic is unit-testable without mounting either React
// component. See packages/shared/src/modifiers.ts for the display formatter
// and the server-side removals rule this feeds.
//
// Reverse mode only applies when the product's flag is on AND it has at
// least one modifier — a flagged product with an empty modifier list has
// nothing to preselect, so it behaves exactly like normal mode.
export function modifiersPreselectedFor(product: {
  modifiersPreselected?: boolean;
  modifiers: readonly string[];
}): boolean {
  return product.modifiersPreselected === true && product.modifiers.length > 0;
}

// What the picker's checkbox list should start ticked with, given the open
// product. Reverse mode starts every modifier ticked (the customer keeps
// everything unless they untick); normal mode starts with none ticked.
export function initialSelected(product: {
  modifiersPreselected?: boolean;
  modifiers: readonly string[];
}): string[] {
  return modifiersPreselectedFor(product) ? [...product.modifiers] : [];
}

export interface PickModifierResult {
  modifiers: string[];
  removedModifiers?: string[];
}

// Confirm-time split of the ticked/unticked state into what the line actually
// carries. Normal mode: `modifiers` is exactly what's ticked (today's
// behaviour, unchanged) and no removals ever ride along. Reverse mode: kept
// defaults print nothing, so `modifiers` is always empty and the UNticked
// ones become `removedModifiers` — omitted entirely when nothing was
// unticked (omit-empty, matching the shared schema's contract).
export function pickModifierResult(
  product: { modifiersPreselected?: boolean; modifiers: readonly string[] },
  selected: readonly string[],
): PickModifierResult {
  if (!modifiersPreselectedFor(product)) {
    return { modifiers: [...selected] };
  }
  // Once each, even if the item's list names a modifier twice (a CSV import
  // does not dedupe): the server refuses a repeated removal.
  const removed = [...new Set(product.modifiers.filter((m) => !selected.includes(m)))];
  return removed.length > 0 ? { modifiers: [], removedModifiers: removed } : { modifiers: [] };
}

// Priced add-ons (owner 2026-11-02, D1-D4). The line price the POS cart and
// the item modal quote = the item's own price after its % discount + what the
// picked add-ons add (D2: the add-on is never discounted). It is the SAME rule
// the server re-checks a line with (lib/public-pricing.ts derivedLinePrice:
// effectiveUnitPrice + addOnTotal), so a priced line never 409s "Price
// changed". Ticked mode (D3) adds nothing: addOnTotal is 0 there.
export interface PricedLineParts {
  price: number;
  /** The picked add-ons' amounts, display only (the server re-stamps them). Omitted when none is priced. */
  modifierPrices?: ProductModifierPrice[];
}

/** `itemPrice` (the base/variation price AFTER the item's own discount) plus the picked add-ons. */
export function withAddOns(
  itemPrice: number,
  product: AddOnProduct,
  picked: readonly string[],
): PricedLineParts {
  const stamp = lineModifierPrices(product, picked);
  if (stamp.length === 0) return { price: itemPrice };
  return { price: itemPrice + stamp.reduce((sum, p) => sum + p.price, 0), modifierPrices: stamp };
}

/** The amount shown on one add-on's row ("+₹100"), or undefined when it is free — and always undefined on an item whose
 *  add-ons come ticked (D3: the ticked mode means "included in the price"). */
export function addOnAmount(product: AddOnProduct, name: string): number | undefined {
  return lineModifierPrices(product, [name])[0]?.price;
}
