import { effectiveUnitPrice } from "@pos/shared/public";
import { checkItemVariations } from "@/lib/variations";
import type { ProductVariation } from "@/types";

// CR2.2 SLICE 3 — server-side pricing for a diner-submitted public order.
// PURE and DB-free: takes the live product rows as an argument, same
// discipline as lib/variations.ts (the order-write routes already hold their
// own `Product.find` in hand).
//
// THREAT MODEL (mirrors lib/public-menu.ts §1): a diner's browser has no
// login, no session, and nothing standing between it and this route but
// input validation — the client is UNTRUSTED (§6). So every line this module
// builds carries a SERVER-derived `name` and `price`; nothing the client sent
// for either field is ever read. The price this function computes IS the
// price the order is charged (§1) — there is no second, later pricing pass.

export const UNKNOWN_ITEM_ERROR =
  "One of the items in your order is no longer on the menu";
export const SOLD_OUT_ERROR = (name: string) => `"${name}" is sold out`;
export const UNKNOWN_MODIFIER_ERROR = (name: string, modifier: string) =>
  `"${modifier}" is not an option for "${name}"`;
// Shown to STAFF in the requests tray (the diner-facing 422 path maps to its
// own copy client-side) — so it must say what staff should actually DO.
export const PRICE_DRIFT_ERROR =
  "Prices or charges changed after the customer ordered — reject this request and ask them to order again";

export interface PricedProductSource {
  _id: unknown; // stringified via String(); never assumed to already be a string
  name: string;
  price: number;
  discount: number;
  available: boolean;
  modifiers: string[];
  variations?: ProductVariation[];
}

export interface PricedRequestItem {
  productId: string;
  variation?: string;
  modifiers: string[];
  instructions?: string;
  qty: number;
}

export interface PricedLine {
  productId: string;
  name: string;
  price: number;
  qty: number;
  variation?: string;
  modifiers: string[];
  instructions?: string;
}

// The unit price one line bills at, mirroring hooks/use-cart.ts's addToCart
// EXACTLY: a named variation's OWN price is what runs through the PRODUCT's
// discount (never a separate per-variation discount — there isn't one).
// `null` means `variation` does not name anything on this product — the
// caller must treat that as a rejection, never fall back to the base price.
export function derivedLinePrice(
  product: PricedProductSource,
  variation?: string,
): number | null {
  if (!variation) return effectiveUnitPrice(product.price, product.discount);
  const match = product.variations?.find((v) => v.name === variation);
  if (!match) return null;
  return effectiveUnitPrice(match.price, product.discount);
}

// Prices every item in one public order request against the live product
// rows, or reports the FIRST rejection. Deliberately fail-fast (not
// error-per-line): a public order is one atomic accept-or-reject, not a
// partial cart.
export function priceRequestItems(
  products: PricedProductSource[],
  items: PricedRequestItem[],
): { lines: PricedLine[] } | { error: string } {
  const lines: PricedLine[] = [];

  for (const item of items) {
    const product = products.find((p) => String(p._id) === item.productId);
    if (!product) return { error: UNKNOWN_ITEM_ERROR };
    if (product.available === false) return { error: SOLD_OUT_ERROR(product.name) };

    // Variation validity is checkItemVariations' rule, REUSED (not forked) —
    // adapted to its one-product/one-item input shape. The name it reports
    // errors against is the product's REAL name, never anything the client
    // sent (there is nothing else to trust it against here).
    const productId = String(product._id);
    const variationError = checkItemVariations(
      [{ _id: productId, name: product.name, variations: product.variations }],
      [{ productId, name: product.name, variation: item.variation }],
    );
    if (variationError) return { error: variationError };

    const price = derivedLinePrice(product, item.variation);
    // Unreachable once checkItemVariations has passed (its unknown-variation
    // check is the same `names.includes` test derivedLinePrice makes) — kept
    // as a defensive belt-and-suspenders so the two can never silently drift
    // out of sync with each other.
    if (price === null) return { error: PRICE_DRIFT_ERROR };

    for (const modifier of item.modifiers) {
      // `.includes` on the array itself — never a keyed/object lookup — so a
      // modifier literally named "constructor" (or any other Object.prototype
      // key) is judged purely by array membership and cannot resolve via the
      // prototype chain.
      if (!product.modifiers.includes(modifier)) {
        return { error: UNKNOWN_MODIFIER_ERROR(product.name, modifier) };
      }
    }

    const line: PricedLine = {
      productId,
      name: product.name,
      price,
      qty: item.qty,
      modifiers: item.modifiers,
    };
    // Omit-empty, matching the stored order-item shape: a line with no chosen
    // variation/instructions carries no such key on the wire either.
    if (item.variation) line.variation = item.variation;
    if (item.instructions) line.instructions = item.instructions;
    lines.push(line);
  }

  return { lines };
}
