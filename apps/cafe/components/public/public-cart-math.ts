// Pure cart-math helpers extracted out of PublicOrderFlow.tsx (CR2.2b) so
// that component stays under this repo's ~350-line budget. Zero React here —
// every function is a plain (prev, ...) => next computation the component
// calls before any setState, never a flag mutated inside a setState updater.
import { effectiveUnitPrice, PUBLIC_ORDER_MAX_ITEMS, PUBLIC_ORDER_MAX_QTY } from "@pos/shared/public";
import { addOnTotal, lineModifierPrices } from "@pos/shared/modifier-prices";
import type { PublicAddToCartOpts } from "@/components/public/PublicItemSheet";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";
import type { CartLine } from "@/components/public/public-cart-store";

// ASCII record/unit separators, written as escapes (never literal control chars).
const REMOVED_KEY_SEP = "\u001e";
const REMOVED_KEY_ITEM_SEP = "\u001f";

// Two lines merge into one cart line only when product + variation +
// modifiers + instructions (+ removedModifiers) all match — mirrors
// hooks/use-cart.ts's lineKey. That hook is POS-only and reaches into
// @/types/@/models shapes this diner-facing surface may never import, so
// this is a small, deliberate re-implementation rather than a shared import.
// removedModifiers is appended ONLY when non-empty, so the key stays
// byte-identical to its pre-feature form for every line with no removals.
export function lineKey(
  productId: string,
  variation: string | undefined,
  modifiers: string[],
  instructions: string | undefined,
  removedModifiers?: string[],
): string {
  const key = [productId, variation ?? "", [...modifiers].sort().join(","), instructions ?? ""].join("|");
  // The removals follow a separator no diner can type (escapes, never literal
  // control chars): after the free-text instructions, a "|" would let a note
  // such as "less salt|Mushroom" read as a removal and merge two lines.
  if (!removedModifiers || removedModifiers.length === 0) return key;
  return key + REMOVED_KEY_SEP + [...removedModifiers].sort().join(REMOVED_KEY_ITEM_SEP);
}


// The diner's displayed unit price — the SAME rule as the server's
// derivedLinePrice (lib/public-pricing.ts): the item's own discount applies to
// the base/variation price only, then each picked add-on's amount is added in
// full (priced add-ons). `modifiers` are the line's picked add-ons.
export function resolveUnitPrice(
  product: PublicMenuProduct,
  variation: string | undefined,
  modifiers: readonly string[],
): number {
  const chosen = variation ? product.variations?.find((v) => v.name === variation) : undefined;
  return effectiveUnitPrice(chosen ? chosen.price : product.price, product.discount) + addOnTotal(product, modifiers);
}

// An add-on the item no longer offers is dropped, never re-sent: the server
// would refuse it, or charge the line without it.
function liveModifiers(product: PublicMenuProduct, modifiers: readonly string[]): string[] {
  return modifiers.filter((m) => product.modifiers.includes(m));
}

// The cart line's display-only amount snapshot (what each priced add-on adds
// per unit), omit-empty. Never sent: the submit builders copy field by field.
function modifierPricesField(product: PublicMenuProduct, modifiers: readonly string[]) {
  const stamp = lineModifierPrices(product, modifiers);
  return stamp.length > 0 ? { modifierPrices: stamp } : {};
}

// CR2.2 fix round (setState closure flags) — the reconcile effect's own pure
// computation, pulled out so it can run BEFORE any setCart call: React's
// eager, synchronous invocation of a functional setState updater is an
// implementation detail, not a contract this component may rely on, so a
// flag like `changed` must never be mutated INSIDE an updater and then read
// after the setCart(...) call returns.
export function reconcileCartWithMenu(
  prev: CartLine[],
  menuItems: PublicMenuProduct[],
): { next: CartLine[]; changed: boolean } {
  let changed = false;
  const next: CartLine[] = [];
  for (const line of prev) {
    const product = menuItems.find((p) => p.id === line.productId);
    if (!product || !product.available) {
      changed = true;
      continue;
    }
    const variationStillExists =
      !line.variation || product.variations?.some((v) => v.name === line.variation);
    if (!variationStillExists) {
      changed = true;
      continue;
    }
    const modifiers = liveModifiers(product, line.modifiers);
    const price = resolveUnitPrice(product, line.variation, modifiers);
    const { modifierPrices: oldStamp, ...rest } = line;
    const fresh = modifierPricesField(product, modifiers);
    const stampMoved = JSON.stringify(oldStamp ?? []) !== JSON.stringify(fresh.modifierPrices ?? []);
    const dropped = modifiers.length !== line.modifiers.length;
    if (product.name !== line.name || price !== line.price || stampMoved || dropped) changed = true;
    // A dropped add-on changes the line's identity: re-key it. Every line then
    // folds into an identical one already placed, so one pick never shows twice
    // — the twin may sit before a re-keyed line or after it (an unchanged line
    // whose id a re-keyed one already took).
    const lineId = dropped
      ? lineKey(line.productId, line.variation, modifiers, line.instructions, line.removedModifiers)
      : line.lineId;
    const twin = next.findIndex((l) => l.lineId === lineId);
    if (twin >= 0) {
      next[twin] = { ...next[twin], qty: Math.min(PUBLIC_ORDER_MAX_QTY, next[twin].qty + line.qty) };
      continue;
    }
    next.push({ ...rest, name: product.name, price, ...fresh, ...(dropped ? { lineId, modifiers } : {}) });
  }
  return { next, changed };
}

// Same discipline for the add-line cap decision — computed fully in pure
// code against the CURRENT cart before any setCart call, never decided by
// reading a flag mutated inside a setCart updater.
export function computeAddLine(
  prev: CartLine[],
  product: PublicMenuProduct,
  opts: PublicAddToCartOpts,
): { next: CartLine[]; capped: boolean } {
  // A stale add-on (the item no longer offers it) is dropped before keying and
  // pricing, so the line is never shown at a price the server will not charge.
  const modifiers = liveModifiers(product, opts.modifiers);
  const key = lineKey(product.id, opts.variation, modifiers, opts.instructions, opts.removedModifiers);
  const unitPrice = resolveUnitPrice(product, opts.variation, modifiers);
  const idx = prev.findIndex((l) => l.lineId === key);
  if (idx >= 0) {
    const next = [...prev];
    next[idx] = { ...next[idx], qty: Math.min(PUBLIC_ORDER_MAX_QTY, next[idx].qty + opts.qty) };
    return { next, capped: false };
  }
  if (prev.length >= PUBLIC_ORDER_MAX_ITEMS) {
    return { next: prev, capped: true };
  }
  return {
    next: [
      ...prev,
      {
        lineId: key,
        productId: product.id,
        name: product.name,
        price: unitPrice,
        qty: Math.min(PUBLIC_ORDER_MAX_QTY, opts.qty),
        variation: opts.variation,
        modifiers,
        instructions: opts.instructions,
        ...modifierPricesField(product, modifiers),
        ...(opts.removedModifiers && opts.removedModifiers.length > 0
          ? { removedModifiers: opts.removedModifiers }
          : {}),
      },
    ],
    capped: false,
  };
}

// CR2.2b stepper derivations — qty summed per product (drives ADD vs.
// [− n +] on each menu tile) and line count per product (drives
// handleDecrement's single-line-vs-open-drawer branch).
export function computeQtyByProduct(cart: CartLine[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const line of cart) map[line.productId] = (map[line.productId] ?? 0) + line.qty;
  return map;
}

export function computeLineCountByProduct(cart: CartLine[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const line of cart) map[line.productId] = (map[line.productId] ?? 0) + 1;
  return map;
}

// CB-4 — "Order this again". Rebuilds cart lines from a PAST order's items,
// validated against the LIVE menu rather than trusted: a repeat is a
// convenience, and a diner must never be able to re-add a product the cafe has
// since removed, hidden, marked unavailable, or re-priced.
//
// Pure, like everything else here — the caller decides what to do with the
// result. `skipped` is what the UI tells the diner, so a silently shorter cart
// can never be mistaken for a faithful repeat.
//
// Reuses computeAddLine rather than constructing lines directly, so the item
// cap, the per-line qty cap and the merge-by-lineKey rule are the SAME ones a
// hand-tapped add obeys.
export function buildRepeatCart(
  prev: CartLine[],
  pastItems: readonly {
    productId: string;
    qty: number;
    variation?: string;
    modifiers: string[];
    removedModifiers?: string[];
    instructions?: string;
  }[],
  menuItems: PublicMenuProduct[],
): { next: CartLine[]; added: number; skipped: number } {
  let next = prev;
  let added = 0;
  let skipped = 0;
  for (const item of pastItems) {
    const product = menuItems.find((p) => p.id === item.productId);
    // Gone, hidden or sold out today.
    if (!product || !product.available) {
      skipped += 1;
      continue;
    }
    // A variation that no longer exists would otherwise re-add at the base
    // price — a silent price change on the diner's behalf.
    if (item.variation && !product.variations?.some((v) => v.name === item.variation)) {
      skipped += 1;
      continue;
    }
    // "NO Mushroom" must repeat as NO Mushroom — dropping it would put the
    // mushroom back on. If the item no longer has its modifiers ticked, or no
    // longer has that modifier, the line is skipped (the server would refuse
    // it anyway), never silently repeated without the removal.
    const removed = item.removedModifiers ?? [];
    if (
      removed.length > 0 &&
      (product.modifiersPreselected !== true || !removed.every((m) => product.modifiers.includes(m)))
    ) {
      skipped += 1;
      continue;
    }
    const result = computeAddLine(next, product, {
      qty: Math.min(PUBLIC_ORDER_MAX_QTY, item.qty),
      variation: item.variation,
      modifiers: item.modifiers,
      ...(removed.length > 0 ? { removedModifiers: removed } : {}),
      instructions: item.instructions,
    });
    if (result.capped) {
      skipped += 1;
      continue;
    }
    next = result.next;
    added += 1;
  }
  return { next, added, skipped };
}
