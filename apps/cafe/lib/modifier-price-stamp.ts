import { lineModifierPrices, type AddOnProduct } from "@pos/shared/modifier-prices";

// Priced add-ons (owner, 2026-11-02) — the WRITE-time half. Every staff order
// writer (POST /api/orders, POST /api/orders/[id]/items) stamps each new line
// with what its picked add-ons are charged, from the product rows it already
// read for the menu re-check, so a reprint years later prints what was charged
// even if the menu amount has moved since. PURE and DB-free: lines + rows in,
// lines out. The menu check (orderLinesRefusal) has already passed by the time
// this runs, so each priced pick is on the menu and the line price includes it.
//
// Omit-empty: a line whose picks carry no amount gets NO key. Whatever a client
// sent under `modifierPrices` is dropped first — the stamp is the server's alone
// (the order schemas strip it already; this is the second fence).

export interface StampProductRow extends AddOnProduct {
  _id: unknown; // stringified via String(); never assumed to already be a string
}

export interface StampableLine {
  productId: unknown;
  modifiers?: readonly string[];
  modifierPrices?: unknown;
}

export function stampModifierPrices<T extends StampableLine>(
  lines: readonly T[],
  products: readonly StampProductRow[],
): T[] {
  const byId = new Map(products.map((p) => [String(p._id), p]));
  return lines.map((line) => {
    const base = { ...line };
    delete (base as StampableLine).modifierPrices;
    const product = byId.get(String(line.productId));
    const stamp = product ? lineModifierPrices(product, line.modifiers ?? []) : [];
    // Fresh {name, price} objects: nothing of the product row is shared into the order.
    return stamp.length > 0
      ? { ...base, modifierPrices: stamp.map(({ name, price }) => ({ name, price })) }
      : base;
  });
}
