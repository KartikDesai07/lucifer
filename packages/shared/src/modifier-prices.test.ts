// Priced add-ons (owner, 2026-11-02): the shared contract — the one price rule
// every pricer adds (addOnTotal), the server's per-line snapshot of what was
// charged (lineModifierPrices), the product write rule (productAddOnsError,
// decisions D3/D4) and the bill's "+ Cheese Burst ₹100" line (D1).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addOnTotal,
  lineModifierPrices,
  productAddOnsError,
  billModifierLines,
  hasRepeatedModifier,
  ADD_ON_PRICES_TICKED_ERROR,
  ADD_ON_PRICE_WHOLE_ERROR,
  ADD_ON_PRICE_REPEATED_ERROR,
  ADD_ON_PRICE_UNKNOWN_ERROR,
} from "./modifier-prices";
import { orderItemModifierLines } from "./modifiers";
import { inr } from "./utils";
import { VARIATION_PRICE_MAX } from "./constants";

const PIZZA = {
  modifiers: ["Cheese Burst", "Olives", "Jalapeno"],
  modifierPrices: [
    { name: "Olives", price: 30 },
    { name: "Cheese Burst", price: 100 },
  ],
};

// ── addOnTotal: the amount the picked add-ons add to ONE unit ────────────────

test("addOnTotal: one priced pick adds its amount; an unpriced pick adds 0", () => {
  assert.equal(addOnTotal(PIZZA, ["Cheese Burst"]), 100);
  assert.equal(addOnTotal(PIZZA, ["Jalapeno"]), 0);
  assert.equal(addOnTotal(PIZZA, []), 0);
});

test("addOnTotal: two priced picks sum, in any order", () => {
  assert.equal(addOnTotal(PIZZA, ["Cheese Burst", "Olives", "Jalapeno"]), 130);
  assert.equal(addOnTotal(PIZZA, ["Olives", "Cheese Burst"]), 130);
});

test("addOnTotal: a product with no amounts (every existing item) adds 0", () => {
  assert.equal(addOnTotal({ modifiers: ["Cheese Burst"] }, ["Cheese Burst"]), 0);
  assert.equal(addOnTotal({ modifiers: ["Cheese Burst"], modifierPrices: [] }, ["Cheese Burst"]), 0);
});

test("addOnTotal: an amount whose name is no longer one of the item's add-ons is ignored", () => {
  const orphan = { modifiers: ["Olives"], modifierPrices: [{ name: "Cheese Burst", price: 100 }] };
  assert.equal(addOnTotal(orphan, ["Cheese Burst"]), 0);
});

test("addOnTotal: an item whose add-ons come ticked never charges (D3)", () => {
  assert.equal(addOnTotal({ ...PIZZA, modifiersPreselected: true }, ["Cheese Burst"]), 0);
});

test("addOnTotal: a modifier named after an Object.prototype key resolves by array membership only", () => {
  assert.equal(addOnTotal(PIZZA, ["constructor"]), 0);
  const odd = { modifiers: ["constructor"], modifierPrices: [{ name: "constructor", price: 5 }] };
  assert.equal(addOnTotal(odd, ["constructor"]), 5);
});

// ── lineModifierPrices: the server's snapshot on the written line ────────────

test("lineModifierPrices: priced picks only, sorted by name", () => {
  assert.deepEqual(lineModifierPrices(PIZZA, ["Olives", "Jalapeno", "Cheese Burst"]), [
    { name: "Cheese Burst", price: 100 },
    { name: "Olives", price: 30 },
  ]);
});

test("lineModifierPrices: nothing priced picked = an empty list (the caller omits the key)", () => {
  assert.deepEqual(lineModifierPrices(PIZZA, ["Jalapeno"]), []);
  assert.deepEqual(lineModifierPrices({ modifiers: ["A"] }, ["A"]), []);
  assert.deepEqual(lineModifierPrices({ ...PIZZA, modifiersPreselected: true }, ["Cheese Burst"]), []);
});

test("lineModifierPrices: the snapshot always sums to addOnTotal", () => {
  const picks = ["Cheese Burst", "Olives"];
  const sum = lineModifierPrices(PIZZA, picks).reduce((s, p) => s + p.price, 0);
  assert.equal(sum, addOnTotal(PIZZA, picks));
});

test("lineModifierPrices: a repeated pick is snapshotted once (repeats are refused at the schema)", () => {
  assert.deepEqual(lineModifierPrices(PIZZA, ["Cheese Burst", "Cheese Burst"]), [{ name: "Cheese Burst", price: 100 }]);
});

// ── productAddOnsError: the product write rule (D3, D4) ──────────────────────

test("productAddOnsError: absent or empty amounts always pass", () => {
  assert.equal(productAddOnsError({ modifiers: ["A"] }), null);
  assert.equal(productAddOnsError({ modifiers: ["A"], modifierPrices: [] }), null);
  assert.equal(productAddOnsError({ modifiers: ["A"], modifierPrices: null, modifiersPreselected: true }), null);
});

test("productAddOnsError: a valid set passes", () => {
  assert.equal(productAddOnsError(PIZZA), null);
});

test("productAddOnsError: amounts on an item whose add-ons come ticked are refused (D3)", () => {
  assert.equal(productAddOnsError({ ...PIZZA, modifiersPreselected: true }), ADD_ON_PRICES_TICKED_ERROR);
});

test("productAddOnsError: whole rupees only, at least 1, at most the price ceiling (D4)", () => {
  for (const price of [99.5, 0, -1, VARIATION_PRICE_MAX + 1, Number.NaN]) {
    const doc = { modifiers: ["A"], modifierPrices: [{ name: "A", price }] };
    assert.equal(productAddOnsError(doc), ADD_ON_PRICE_WHOLE_ERROR("A"), `price ${price}`);
  }
  assert.equal(productAddOnsError({ modifiers: ["A"], modifierPrices: [{ name: "A", price: VARIATION_PRICE_MAX }] }), null);
});

test("productAddOnsError: one amount per add-on", () => {
  const doc = { modifiers: ["A"], modifierPrices: [{ name: "A", price: 10 }, { name: "A", price: 20 }] };
  assert.equal(productAddOnsError(doc), ADD_ON_PRICE_REPEATED_ERROR("A"));
});

test("productAddOnsError: an amount must name one of the item's add-ons", () => {
  const doc = { modifiers: ["Olives"], modifierPrices: [{ name: "Cheese Burst", price: 100 }] };
  assert.equal(productAddOnsError(doc), ADD_ON_PRICE_UNKNOWN_ERROR("Cheese Burst"));
  assert.equal(productAddOnsError({ modifierPrices: [{ name: "constructor", price: 1 }] }), ADD_ON_PRICE_UNKNOWN_ERROR("constructor"));
});

// ── billModifierLines: the bill's add-on line (D1) ───────────────────────────

test("billModifierLines: '+ Cheese Burst ₹100' with the amount after each priced add-on", () => {
  const line = {
    modifiers: ["Cheese Burst", "Jalapeno", "Olives"],
    modifierPrices: [{ name: "Cheese Burst", price: 100 }, { name: "Olives", price: 30 }],
  };
  assert.deepEqual(billModifierLines(line), [`+ Cheese Burst ${inr(100)}, Jalapeno, Olives ${inr(30)}`]);
  assert.equal(inr(100), "₹100", "landmark: the bill's own money format");
});

test("billModifierLines: a line with no snapshot prints exactly what orderItemModifierLines prints", () => {
  const lines = [
    { modifiers: ["Extra cheese"] },
    { modifiers: [], removedModifiers: ["Onion"] },
    { modifiers: ["A", "B"], removedModifiers: ["C"], modifierPrices: [] },
    {},
  ];
  for (const line of lines) assert.deepEqual(billModifierLines(line), orderItemModifierLines(line));
});

test("billModifierLines: removals stay first and carry no amount", () => {
  const line = { modifiers: ["Cheese Burst"], removedModifiers: ["Onion"], modifierPrices: [{ name: "Cheese Burst", price: 100 }] };
  assert.deepEqual(billModifierLines(line), ["NO Onion", `+ Cheese Burst ${inr(100)}`]);
});

// ── hasRepeatedModifier: the order schemas' repeat check ─────────────────────

test("hasRepeatedModifier: true only when a name appears twice", () => {
  assert.equal(hasRepeatedModifier(["A", "B"]), false);
  assert.equal(hasRepeatedModifier([]), false);
  assert.equal(hasRepeatedModifier(["A", "B", "A"]), true);
});
