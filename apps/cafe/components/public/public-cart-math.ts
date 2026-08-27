// Pure cart-math helpers extracted out of PublicOrderFlow.tsx (CR2.2b) so
// that component stays under this repo's ~350-line budget. Zero React here —
// every function is a plain (prev, ...) => next computation the component
// calls before any setState, never a flag mutated inside a setState updater.
import { effectiveUnitPrice, PUBLIC_ORDER_MAX_ITEMS, PUBLIC_ORDER_MAX_QTY } from "@pos/shared/public";
import type { PublicAddToCartOpts } from "@/components/public/PublicItemSheet";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";
import type { CartLine } from "@/components/public/public-cart-store";

// Two lines merge into one cart line only when product + variation +
// modifiers + instructions all match — mirrors hooks/use-cart.ts's lineKey.
// That hook is POS-only and reaches into @/types/@/models shapes this
// diner-facing surface may never import, so this is a small, deliberate
// re-implementation rather than a shared import.
export function lineKey(
  productId: string,
  variation: string | undefined,
  modifiers: string[],
  instructions: string | undefined,
): string {
  return [productId, variation ?? "", [...modifiers].sort().join(","), instructions ?? ""].join("|");
}

export function resolveUnitPrice(product: PublicMenuProduct, variation: string | undefined): number {
  const chosen = variation ? product.variations?.find((v) => v.name === variation) : undefined;
  return effectiveUnitPrice(chosen ? chosen.price : product.price, product.discount);
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
    const price = resolveUnitPrice(product, line.variation);
    if (product.name !== line.name || price !== line.price) changed = true;
    next.push({ ...line, name: product.name, price });
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
  const key = lineKey(product.id, opts.variation, opts.modifiers, opts.instructions);
  const unitPrice = resolveUnitPrice(product, opts.variation);
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
        modifiers: opts.modifiers,
        instructions: opts.instructions,
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
