/**
 * Line-level composition helpers for orders-plan.ts — split out to keep both
 * files under the ~300-line cap. Pure; every draw comes from `ctx.rng`.
 *
 * VERIFIED FINDING (contrary to this plan's own assumption): the POS does
 * apply a product's `discount` % to the line price. `hooks/use-cart.ts`'s
 * `effectivePrice()` (used by ProductCard.tsx, ModifierModal.tsx, and
 * use-pos-tab.ts's addToCart path) calls `effectiveUnitPrice(price, discount)`
 * from `@pos/shared/public` — `Math.round(price - price*discount/100)` — for
 * BOTH the base price and every variation's price, and that discounted figure
 * is what is stored as `items[].price`. The order-LEVEL `discount` field (in
 * computeOrderTotals) is a separate, additional discount the cashier applies
 * on top. This planner therefore applies the product's percent discount to
 * the line price here, exactly as the POS would.
 */
import type { PlannedProduct, DemoVariation } from "./types";
import type { Rng } from "./types";
import { effectiveUnitPrice } from "@pos/shared/public";
import { ITEM_INSTRUCTIONS } from "./people-data";

export const LINE_COUNT_WEIGHTS = [
  { lines: 1, weight: 35 },
  { lines: 2, weight: 35 },
  { lines: 3, weight: 20 },
  { lines: 4, weight: 10 },
] as const;

export const QTY_WEIGHTS = [
  { qty: 1, weight: 70 },
  { qty: 2, weight: 22 },
  { qty: 3, weight: 8 },
] as const;

const VARIATION_FIRST_CHANCE = 0.65;
const LINE_MODIFIER_CHANCE = 0.2;
const LINE_INSTRUCTION_CHANCE = 0.05;

export interface ComposedLine {
  productId: PlannedProduct["_id"];
  name: string;
  price: number; // effective (discount-applied) unit price, as the POS bills it
  qty: number;
  variation?: string;
  modifiers: string[];
  instructions: string;
}

// One product's effective unit price and the variation name it was sold as
// (if any), mirroring `hooks/use-cart.ts`'s addToCart price resolution:
// variation price when a variation was picked, else the product's own price —
// both run through effectiveUnitPrice with the product's discount.
function pickPriceAndVariation(
  rng: Rng,
  product: PlannedProduct,
): { price: number; variation?: string } {
  if (product.variations && product.variations.length > 0) {
    const picked: DemoVariation = rng.chance(VARIATION_FIRST_CHANCE)
      ? product.variations[0]
      : rng.pick(product.variations.slice(1));
    return { price: effectiveUnitPrice(picked.price, product.discount), variation: picked.name };
  }
  return { price: effectiveUnitPrice(product.price, product.discount) };
}

// Picks `count` distinct AVAILABLE products, weighted by popularity.
function pickDistinctProducts(
  rng: Rng,
  products: readonly PlannedProduct[],
  count: number,
): PlannedProduct[] {
  const pool = products.filter((p) => p.available);
  const chosen: PlannedProduct[] = [];
  const remaining = [...pool];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const product = rng.weighted(remaining, (p) => p.weight);
    chosen.push(product);
    const idx = remaining.indexOf(product);
    remaining.splice(idx, 1);
  }
  return chosen;
}

// Composes N distinct order lines (kotRound stamped by the caller — line
// composition itself is round-agnostic).
export function composeLines(
  rng: Rng,
  products: readonly PlannedProduct[],
  count: number,
): ComposedLine[] {
  const chosen = pickDistinctProducts(rng, products, count);
  return chosen.map((product) => {
    const { price, variation } = pickPriceAndVariation(rng, product);
    const qty = rng.weighted(QTY_WEIGHTS, (w) => w.weight).qty;
    const modifiers: string[] =
      product.modifiers.length > 0 && rng.chance(LINE_MODIFIER_CHANCE)
        ? [rng.pick(product.modifiers)]
        : [];
    const instructions = rng.chance(LINE_INSTRUCTION_CHANCE) ? rng.pick(ITEM_INSTRUCTIONS) : "";
    return {
      productId: product._id,
      name: product.name,
      price,
      qty,
      variation,
      modifiers,
      instructions,
    };
  });
}

// How many lines a fresh order gets, weighted per LINE_COUNT_WEIGHTS.
export function pickLineCount(rng: Rng): number {
  return rng.weighted(LINE_COUNT_WEIGHTS, (w) => w.weight).lines;
}
