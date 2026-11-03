import { test } from "node:test";
import assert from "node:assert/strict";

import type { ProductModifierPrice } from "@pos/shared/types";
import { stampModifierPrices, type StampProductRow } from "./modifier-price-stamp";

// Priced add-ons (owner, 2026-11-02): the write-time stamp is pure — lines and
// the product rows the route already read go in, stamped lines come out.

const PIZZA: StampProductRow = {
  _id: "p1",
  modifiers: ["Olives", "Cheese Burst", "Jalapeno"],
  modifierPrices: [
    { name: "Olives", price: 30 },
    { name: "Cheese Burst", price: 100 },
  ],
};
const TEA: StampProductRow = { _id: "p2", modifiers: ["Ginger"] };
interface TestLine {
  productId: string;
  name: string;
  price: number;
  qty: number;
  modifiers: string[];
  modifierPrices?: ProductModifierPrice[];
  kotRound?: number;
}
const line = (productId: string, modifiers: string[], extra: Partial<TestLine> = {}): TestLine => ({
  productId,
  name: "X",
  price: 1,
  qty: 1,
  modifiers,
  ...extra,
});

test("priced picks only, sorted by name, as fresh {name, price} objects", () => {
  const [out] = stampModifierPrices([line("p1", ["Olives", "Jalapeno", "Cheese Burst"])], [PIZZA]);
  assert.deepEqual(out.modifierPrices, [
    { name: "Cheese Burst", price: 100 },
    { name: "Olives", price: 30 },
  ]);
  assert.notEqual(out.modifierPrices?.[0], PIZZA.modifierPrices?.[0], "no object is shared with the product row");
});

test("omit-empty: no priced pick, no amounts on the product, or an unknown product writes no key", () => {
  const out = stampModifierPrices(
    [line("p1", ["Jalapeno"]), line("p1", []), line("p2", ["Ginger"]), line("zz", ["Olives"])],
    [PIZZA, TEA],
  );
  for (const l of out) assert.equal(Object.hasOwn(l, "modifierPrices"), false);
});

test("a ticked item stamps nothing even if amounts are stored", () => {
  const [out] = stampModifierPrices([line("p1", ["Olives"])], [{ ...PIZZA, modifiersPreselected: true }]);
  assert.equal(Object.hasOwn(out, "modifierPrices"), false);
});

test("anything the client sent under modifierPrices is dropped or replaced", () => {
  const forged = [{ name: "Cheese Burst", price: 1 }];
  const [kept, dropped] = stampModifierPrices(
    [line("p1", ["Cheese Burst"], { modifierPrices: forged }), line("p1", ["Jalapeno"], { modifierPrices: forged })],
    [PIZZA],
  );
  assert.deepEqual(kept.modifierPrices, [{ name: "Cheese Burst", price: 100 }]);
  assert.equal(Object.hasOwn(dropped, "modifierPrices"), false);
});

test("an ObjectId-like _id matches by String(); other line keys and the input survive", () => {
  const input = line("abc", ["Olives"], { kotRound: 2 });
  const [out] = stampModifierPrices([input], [{ ...PIZZA, _id: { toString: () => "abc" } }]);
  assert.equal(out.kotRound, 2);
  assert.deepEqual(out.modifierPrices, [{ name: "Olives", price: 30 }]);
  assert.equal(Object.hasOwn(input, "modifierPrices"), false, "the input line is not mutated");
});
