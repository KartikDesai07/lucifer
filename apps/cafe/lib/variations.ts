import type { ProductVariation } from "@/types";
import { removedModifiersError } from "@pos/shared/utils";

// PURE — no DB import. Both order-write routes (POST /api/orders and
// POST /api/orders/[id]/items) already have their own query in hand (one
// indexed `Product.find` each), so this file only judges the payload against
// whatever product rows the caller passes it.
//
// A product sold by size must never reach the kitchen as a bare name, and a
// variation the product does not have must never be printed as if it did —
// this is the whole of the integrity the owner asked for.

export const VARIATION_REQUIRED_ERROR = (name: string) =>
  `Pick a variation for "${name}"`;
export const VARIATION_UNKNOWN_ERROR = (name: string, variation: string) =>
  `"${variation}" is not a variation of "${name}"`;

export interface VariationSource {
  _id: string;
  name: string;
  variations?: ProductVariation[];
}

export interface OrderedItem {
  productId: string;
  name: string;
  variation?: string;
}

// Returns the first rejection message, or null when every line is coherent
// with the product it names. A line whose productId is not in `products` is
// IGNORED here: product existence is not this function's job and the create
// path has never required it (an item can outlive its product).
export function checkItemVariations(
  products: VariationSource[],
  items: OrderedItem[],
): string | null {
  for (const item of items) {
    const product = products.find((p) => p._id === item.productId);
    if (!product) continue; // existence is somebody else's problem

    const names = product.variations?.map((v) => v.name) ?? [];
    if (names.length > 0 && !item.variation) {
      return VARIATION_REQUIRED_ERROR(item.name);
    }
    // Compare names EXACTLY (both are stored trimmed, product.schema.ts and
    // order.schema.ts both `.trim()`) — no case-folding or whitespace slack,
    // so "Large" and "large" are deliberately treated as different sizes.
    if (item.variation && !names.includes(item.variation)) {
      return VARIATION_UNKNOWN_ERROR(item.name, item.variation);
    }
  }
  return null;
}

export interface RemovedModifiersSource {
  _id: string;
  name: string;
  modifiers?: string[];
  modifiersPreselected?: boolean;
}

export interface RemovedModifiersOrderedItem {
  productId: string;
  modifiers?: string[];
  removedModifiers?: string[];
}

// "Modifiers come ticked" (owner, 2026-09-29) — the server-side twin of
// checkItemVariations above: removals are allowed only on an item whose
// modifiers come ticked, must each be one of that item's modifiers, and must
// never also appear in `modifiers` (removedModifiersError, @pos/shared/utils).
// Same "product missing → ignored" rule as checkItemVariations — existence is
// not this function's job either. Returns the first rejection, or null.
export function checkItemRemovedModifiers(
  products: RemovedModifiersSource[],
  items: RemovedModifiersOrderedItem[],
): string | null {
  for (const item of items) {
    const product = products.find((p) => p._id === item.productId);
    if (!product) continue; // existence is somebody else's problem
    const bad = removedModifiersError(product, item);
    if (bad) return bad;
  }
  return null;
}
