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
