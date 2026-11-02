import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { addOnTotal } from "@pos/shared/modifier-prices";
import { effectiveUnitPrice } from "@pos/shared/public";
import {
  modifiersPreselectedFor,
  initialSelected,
  pickModifierResult,
  withAddOns,
  addOnAmount,
} from "@/lib/modifier-picker";
import { cartItemFromOrderItem, effectivePrice } from "@/hooks/use-cart";
import { derivedLinePrice } from "@/lib/public-pricing";
import { stripComments } from "@/lib/source-pin-utils";
import type { OrderItem, Product } from "@/types";

const FLAGGED = { modifiersPreselected: true, modifiers: ["Mushroom", "Onion", "Olives"] };
const NORMAL = { modifiersPreselected: false, modifiers: ["Extra shot", "Oat milk"] };
const FLAGGED_NO_MODIFIERS = { modifiersPreselected: true, modifiers: [] as string[] };
const UNFLAGGED_UNDEFINED = { modifiers: ["Sugar"] };

test("modifiersPreselectedFor: only true AND at least one modifier turns reverse mode on", () => {
  assert.equal(modifiersPreselectedFor(FLAGGED), true);
  assert.equal(modifiersPreselectedFor(NORMAL), false);
  assert.equal(modifiersPreselectedFor(FLAGGED_NO_MODIFIERS), false);
  assert.equal(modifiersPreselectedFor(UNFLAGGED_UNDEFINED), false);
});

test("initialSelected: reverse mode starts every modifier ticked; normal mode starts with none", () => {
  assert.deepEqual(initialSelected(FLAGGED), ["Mushroom", "Onion", "Olives"]);
  assert.deepEqual(initialSelected(NORMAL), []);
  assert.deepEqual(initialSelected(FLAGGED_NO_MODIFIERS), []);
});

test("pickModifierResult: normal mode — modifiers is exactly what's ticked, no removedModifiers ever", () => {
  assert.deepEqual(pickModifierResult(NORMAL, ["Extra shot"]), { modifiers: ["Extra shot"] });
  assert.deepEqual(pickModifierResult(NORMAL, []), { modifiers: [] });
});

test("pickModifierResult: reverse mode — modifiers always empty, unticked ones become removedModifiers", () => {
  assert.deepEqual(pickModifierResult(FLAGGED, ["Mushroom", "Onion", "Olives"]), { modifiers: [] });
  assert.deepEqual(pickModifierResult(FLAGGED, ["Onion"]), {
    modifiers: [],
    removedModifiers: ["Mushroom", "Olives"],
  });
  assert.deepEqual(pickModifierResult(FLAGGED, []), {
    modifiers: [],
    removedModifiers: ["Mushroom", "Onion", "Olives"],
  });
});

test("pickModifierResult: a flagged product with no modifiers behaves like normal mode (nothing to preselect)", () => {
  assert.deepEqual(pickModifierResult(FLAGGED_NO_MODIFIERS, []), { modifiers: [] });
});

test("reverse mode: an item whose list names a modifier twice still sends that removal ONCE (the server refuses repeats)", () => {
  const product = { modifiersPreselected: true, modifiers: ["Mushroom", "Onion", "Mushroom"] };
  assert.deepEqual(pickModifierResult(product, ["Onion"]), { modifiers: [], removedModifiers: ["Mushroom"] });
});

// ── priced add-ons (owner 2026-11-02): the cart's line price is the server's rule ────────────────────────────────────

const PIZZA: {
  _id: string; name: string; price: number; discount: number; available: boolean; modifiers: string[];
  modifiersPreselected?: boolean; modifierPrices: { name: string; price: number }[]; variations: { name: string; price: number }[];
} = {
  _id: "p1",
  name: "Pizza",
  price: 250,
  discount: 0,
  available: true,
  modifiers: ["Cheese Burst", "Jalapeno", "Olives"],
  modifierPrices: [{ name: "Cheese Burst", price: 100 }, { name: "Olives", price: 30 }],
  variations: [{ name: "Medium", price: 300 }, { name: "Large", price: 400 }],
};

/** What addToCart quotes for a pick: the item's own price (variation or base, after the discount) through withAddOns. */
function cartPrice(product: typeof PIZZA, variation: string | undefined, picked: string[]): number {
  const v = variation ? product.variations.find((x) => x.name === variation) : undefined;
  const item = v ? effectivePrice({ price: v.price, discount: product.discount }) : effectivePrice(product);
  return withAddOns(item, product, picked).price;
}

test("withAddOns: base + add-on, and the stamp is the priced picks only, sorted by name", () => {
  assert.deepEqual(withAddOns(250, PIZZA, ["Cheese Burst"]), { price: 350, modifierPrices: [{ name: "Cheese Burst", price: 100 }] });
  assert.deepEqual(withAddOns(250, PIZZA, ["Olives", "Jalapeno", "Cheese Burst"]), {
    price: 380,
    modifierPrices: [{ name: "Cheese Burst", price: 100 }, { name: "Olives", price: 30 }],
  });
  assert.deepEqual(withAddOns(250, PIZZA, ["Jalapeno"]), { price: 250 }, "a free add-on adds nothing and stamps nothing (omit-empty)");
  assert.deepEqual(withAddOns(250, PIZZA, []), { price: 250 });
  assert.deepEqual(withAddOns(250, { modifiers: ["A"] }, ["A"]), { price: 250 }, "an item with no amounts is untouched");
});

test("withAddOns: variation + add-on", () => {
  assert.equal(cartPrice(PIZZA, "Large", ["Cheese Burst"]), 500);
  assert.equal(cartPrice(PIZZA, "Medium", ["Cheese Burst", "Olives"]), 430);
});

test("withAddOns: the item's own % discount applies to the item price only (D2): 250 at 10% + 100 = 325", () => {
  const sale = { ...PIZZA, discount: 10 };
  assert.equal(cartPrice(sale, undefined, ["Cheese Burst"]), 325, "225 + 100, the add-on is not discounted");
  assert.equal(cartPrice(sale, "Large", ["Cheese Burst"]), 460, "360 + 100");
});

test("withAddOns: an item whose add-ons come ticked adds 0 (D3), and an amount of a name the item lacks is ignored", () => {
  const ticked = { ...PIZZA, modifiersPreselected: true };
  assert.deepEqual(withAddOns(250, ticked, ["Cheese Burst"]), { price: 250 });
  assert.deepEqual(withAddOns(250, { ...PIZZA, modifiers: ["Jalapeno"] }, ["Cheese Burst"]), { price: 250 });
});

test("the cart price equals derivedLinePrice (the server's rule) for the same picks", () => {
  const sale = { ...PIZZA, discount: 10 };
  const picks: Array<[typeof PIZZA, string | undefined, string[]]> = [
    [PIZZA, undefined, []],
    [PIZZA, undefined, ["Cheese Burst"]],
    [PIZZA, "Large", ["Cheese Burst", "Olives"]],
    [sale, undefined, ["Cheese Burst", "Jalapeno"]],
    [sale, "Medium", ["Olives"]],
    [{ ...PIZZA, modifiersPreselected: true }, "Medium", ["Cheese Burst"]],
  ];
  for (const [product, variation, picked] of picks) {
    assert.equal(
      cartPrice(product, variation, picked),
      derivedLinePrice(product, variation, picked),
      `${variation ?? "base"} + [${picked.join(", ")}] at ${product.discount}%`,
    );
    const item = variation ? product.variations.find((v) => v.name === variation)!.price : product.price;
    assert.equal(cartPrice(product, variation, picked), effectiveUnitPrice(item, product.discount) + addOnTotal(product, picked));
  }
});

test("addOnAmount: the row's amount - undefined for a free add-on and always on a ticked item", () => {
  assert.equal(addOnAmount(PIZZA, "Cheese Burst"), 100);
  assert.equal(addOnAmount(PIZZA, "Jalapeno"), undefined);
  assert.equal(addOnAmount({ ...PIZZA, modifiersPreselected: true }, "Cheese Burst"), undefined);
});

test("the modal's total (Add to order) = (price + ticked add-ons) x qty, from the same helper; ticked mode sends no picks", () => {
  const picked = pickModifierResult(PIZZA as unknown as Product, ["Cheese Burst"]).modifiers;
  assert.equal(withAddOns(250, PIZZA, picked).price * 3, 1050);
  const ticked = { ...PIZZA, modifiersPreselected: true };
  assert.deepEqual(pickModifierResult(ticked as unknown as Product, [...ticked.modifiers]).modifiers, [], "kept defaults are never picks");
});

const stored = (over: Partial<OrderItem>): OrderItem => ({
  productId: "p1", name: "Pizza", price: 350, qty: 1, modifiers: ["Cheese Burst"], instructions: "", kotRound: 1, ...over,
});

test("cartItemFromOrderItem copies the stored stamp (display only), omit-empty", () => {
  const withStamp = cartItemFromOrderItem(stored({ modifierPrices: [{ name: "Cheese Burst", price: 100 }] }), 0);
  assert.deepEqual(withStamp.modifierPrices, [{ name: "Cheese Burst", price: 100 }]);
  assert.equal(withStamp.price, 350, "the stored line price is kept as it is");
  assert.equal("modifierPrices" in cartItemFromOrderItem(stored({}), 0), false, "no stamp, no key");
  assert.equal("modifierPrices" in cartItemFromOrderItem(stored({ modifierPrices: [] }), 0), false, "an empty stamp, no key");
});

test("PIN: use-cart's addToCart prices through withAddOns and the cart never sends modifierPrices to the server", () => {
  const src = stripComments(readFileSync(fileURLToPath(new URL("../hooks/use-cart.ts", import.meta.url)), "utf8"));
  assert.ok(src.includes("const priced = withAddOns(price, product, modifiers);"), "the new line's price carries the add-ons");
  assert.ok(src.includes("price: priced.price,"), "and the line is written at that price");
  assert.ok(src.includes("...(priced.modifierPrices ? { modifierPrices: priced.modifierPrices } : {}),"), "with its display stamp, omit-empty");
  const toInput = src.slice(src.indexOf("export function cartItemToInput"), src.indexOf("export function nextCartFromServerItems"));
  assert.ok(toInput.includes("modifiers: ci.modifiers,"), "landmark: the input still carries the picks");
  assert.ok(!toInput.includes("modifierPrices"), "the stamp is display only: the server decides money");
});

// Review finding (2026-11-03): the item modal's own total and "+₹" rows were untested. The modal quotes what the cart
// will charge: the item price after its discount through withAddOns, times the qty; each priced row shows its amount
// in normal mode only.
test("PIN: ModifierModal quotes (item price + picked add-ons) x qty and shows each amount in normal mode only", () => {
  const src = stripComments(readFileSync(fileURLToPath(new URL("../components/pos/ModifierModal.tsx", import.meta.url)), "utf8"));
  assert.ok(src.includes("effectivePrice({ price: chosenVariation.price, discount: product.discount })"), "landmark: the item price is the discounted size price");
  assert.ok(
    src.includes("const unit = itemPrice === null ? null : withAddOns(itemPrice, product, pickModifierResult(product, selected).modifiers).price;"),
    "the unit the modal quotes carries the picked add-ons",
  );
  assert.ok(src.includes("`Add to order · ${inr(unit * qty)}`"), "the Add button quotes unit x qty");
  assert.ok(src.includes("const amount = reverseMode ? undefined : addOnAmount(product, modifier);"), "a ticked item's rows show no amount");
  assert.ok(src.includes("+{inr(amount)}"), "a priced row shows +₹amount");
});
