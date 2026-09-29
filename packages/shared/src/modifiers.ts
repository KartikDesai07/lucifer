// "Modifiers come ticked" — the display and server rules for a line's modifier
// CHANGES. Split out of utils.ts for its ~300-line budget; utils.ts re-exports
// all of it, so `@pos/shared/utils` still serves it beside orderItemLabel.
// Pure and client-safe.

// "Modifiers come ticked" (owner, 2026-09-29). Only the CHANGES print, and on
// every surface in the same words — the KOT, the kitchen screen, the bill, the
// cart, the order sheet, the diner's own screens and the void slip all render
// a line's modifiers through orderItemModifierLines, never by hand:
//     1 x Pizza
//        NO Mushroom, NO Onion
//        + Extra cheese
// Removals first (they are what the kitchen must not do), then additions. A
// line with neither prints nothing; an older line (additions only) prints the
// same "+ a, b" it always did.
export const REMOVED_MODIFIER_PREFIX = "NO";
export const ADDED_MODIFIER_PREFIX = "+";

export function orderItemModifierLines(item: {
  modifiers?: readonly string[];
  removedModifiers?: readonly string[];
}): string[] {
  const lines: string[] = [];
  const removed = item.removedModifiers ?? [];
  if (removed.length > 0) lines.push(removed.map((m) => `${REMOVED_MODIFIER_PREFIX} ${m}`).join(", "));
  const added = item.modifiers ?? [];
  if (added.length > 0) lines.push(`${ADDED_MODIFIER_PREFIX} ${added.join(", ")}`);
  return lines;
}

export const REMOVED_MODIFIERS_NOT_ALLOWED_ERROR = (name: string) =>
  `"${name}" does not have its modifiers ticked, so none can be removed`;
export const REMOVED_MODIFIER_UNKNOWN_ERROR = (name: string, modifier: string) =>
  `"${modifier}" is not a modifier of "${name}"`;
export const REMOVED_MODIFIER_ALSO_ADDED_ERROR = (name: string, modifier: string) =>
  `"${modifier}" cannot be both added to and removed from "${name}"`;
export const REMOVED_MODIFIER_REPEATED_ERROR = (name: string, modifier: string) =>
  `"${modifier}" is removed from "${name}" more than once`;

/** The server's check on a line's removals, against the product it names: a
 *  removal is allowed only on an item whose modifiers come ticked, must be one
 *  of that item's modifiers, and cannot also be an addition. Returns the first
 *  rejection message, or null. A line with no removals always passes — so every
 *  order placed before this feature (and every normal-mode line) is unaffected. */
export function removedModifiersError(
  product: { name: string; modifiers?: readonly string[]; modifiersPreselected?: boolean },
  line: { modifiers?: readonly string[]; removedModifiers?: readonly string[] },
): string | null {
  const removed = line.removedModifiers ?? [];
  if (removed.length === 0) return null;
  if (product.modifiersPreselected !== true) return REMOVED_MODIFIERS_NOT_ALLOWED_ERROR(product.name);
  const known = product.modifiers ?? [];
  const added = line.modifiers ?? [];
  for (const [i, modifier] of removed.entries()) {
    // Once each — a repeat would print "NO Mushroom, NO Mushroom".
    if (removed.indexOf(modifier) !== i) return REMOVED_MODIFIER_REPEATED_ERROR(product.name, modifier);
    // Exact compare — both sides are stored trimmed (the variations rule).
    if (!known.includes(modifier)) return REMOVED_MODIFIER_UNKNOWN_ERROR(product.name, modifier);
    if (added.includes(modifier)) return REMOVED_MODIFIER_ALSO_ADDED_ERROR(product.name, modifier);
  }
  return null;
}
