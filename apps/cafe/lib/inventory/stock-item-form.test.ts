import assert from "node:assert/strict";
import { test } from "node:test";

import { STOCK_QTY_MAX } from "@pos/shared/inventory";
import type { StockItemDto } from "@/types/inventory";
import {
  buildCreateInput,
  buildUpdateInput,
  initialStockItemValues,
  parseQtyText,
  validateStockItemForm,
  type StockItemFormValues,
} from "./stock-item-form";

const milk: StockItemDto = { id: "m1", name: "Milk", unit: "L", qtyMilli: 4000, lowAtMilli: 1500 };
const sugar: StockItemDto = { id: "s1", name: "Sugar", unit: "kg", qtyMilli: 0 };
const values = (over: Partial<StockItemFormValues> = {}): StockItemFormValues => ({ name: "Milk", unit: "L", openingText: "", lowAtText: "", ...over });

test("parseQtyText: digits with one optional point become milli-units", () => {
  assert.deepEqual(parseQtyText("2"), { kind: "ok", milli: 2000 });
  assert.deepEqual(parseQtyText("1.5"), { kind: "ok", milli: 1500 });
  assert.deepEqual(parseQtyText(".5"), { kind: "ok", milli: 500 });
  assert.deepEqual(parseQtyText("  0.125 "), { kind: "ok", milli: 125 });
  assert.deepEqual(parseQtyText("0"), { kind: "ok", milli: 0 });
  assert.deepEqual(parseQtyText("0.1"), { kind: "ok", milli: 100 });
});

test("parseQtyText: empty and blank are empty", () => {
  assert.deepEqual(parseQtyText(""), { kind: "empty" });
  assert.deepEqual(parseQtyText("   "), { kind: "empty" });
});

test("parseQtyText: anything else is one plain message", () => {
  for (const bad of ["1e3", "-1", "1,5", "abc", "1.2.3", ".", "+2", "1 5"]) {
    assert.deepEqual(parseQtyText(bad), { kind: "error", message: "Enter a number, like 2 or 1.5" }, bad);
  }
});

test("parseQtyText: more than 3 decimals, and above the cap", () => {
  assert.deepEqual(parseQtyText("1.2345"), { kind: "error", message: "Use at most 3 decimal places" });
  assert.deepEqual(parseQtyText(String(STOCK_QTY_MAX)), { kind: "ok", milli: STOCK_QTY_MAX * 1000 });
  assert.deepEqual(parseQtyText(String(STOCK_QTY_MAX + 1)), { kind: "error", message: "Enter at most 1,00,000" });
  assert.deepEqual(parseQtyText("100000.001"), { kind: "error", message: "Enter at most 1,00,000" });
});

test("initialStockItemValues: blank for a new item; name, unit and low line for an edit", () => {
  assert.deepEqual(initialStockItemValues(null), { name: "", unit: "", openingText: "", lowAtText: "" });
  assert.deepEqual(initialStockItemValues(milk), { name: "Milk", unit: "L", openingText: "", lowAtText: "1.5" });
  assert.equal(initialStockItemValues(sugar).lowAtText, "");
});

test("validateStockItemForm (create): name, unit, the two quantities", () => {
  assert.deepEqual(validateStockItemForm(values({ name: "  ", unit: "" }), false), { name: "Name the stock item", unit: "Pick a unit" });
  assert.deepEqual(validateStockItemForm(values(), false), {});
  assert.equal(validateStockItemForm(values({ openingText: "abc" }), false).opening, "Enter a number, like 2 or 1.5");
  assert.equal(validateStockItemForm(values({ lowAtText: "0" }), false).lowAt, "Enter a level above 0, or leave it empty");
  assert.equal(validateStockItemForm(values({ lowAtText: "0.0004" }), false).lowAt, "Use at most 3 decimal places");
  assert.equal(validateStockItemForm(values({ openingText: "0" }), false).opening, undefined, "an opening stock of 0 is fine");
});

test("validateStockItemForm (edit): no unit rule and no opening rule", () => {
  assert.deepEqual(validateStockItemForm(values({ unit: "", openingText: "abc" }), true), {});
  assert.equal(validateStockItemForm(values({ name: "" }), true).name, "Name the stock item");
  assert.equal(validateStockItemForm(values({ lowAtText: "-1" }), true).lowAt, "Enter a number, like 2 or 1.5");
});

test("buildCreateInput: trimmed name, unit, milli quantities; an empty box sends no key", () => {
  assert.deepEqual(buildCreateInput(values({ name: " Milk ", openingText: "10", lowAtText: "1.5" })), {
    name: "Milk",
    unit: "L",
    openingQtyMilli: 10000,
    lowAtMilli: 1500,
  });
  const bare = buildCreateInput(values());
  assert.deepEqual(bare, { name: "Milk", unit: "L" });
  assert.ok(!("openingQtyMilli" in bare) && !("lowAtMilli" in bare));
  assert.equal(buildCreateInput(values({ openingText: "0" })).openingQtyMilli, 0, "a typed 0 is sent");
});

test("buildUpdateInput: only the changed keys; null when nothing changed", () => {
  assert.equal(buildUpdateInput(milk, initialStockItemValues(milk)), null);
  assert.equal(buildUpdateInput(milk, values({ name: " Milk ", lowAtText: "1.50" })), null, "a trimmed or re-typed same value is no change");
  assert.deepEqual(buildUpdateInput(milk, values({ name: "Full cream milk", lowAtText: "1.5" })), { name: "Full cream milk" });
  assert.deepEqual(buildUpdateInput(milk, values({ lowAtText: "2" })), { lowAtMilli: 2000 });
  assert.deepEqual(buildUpdateInput(sugar, values({ name: "Sugar", unit: "kg", lowAtText: "5" })), { lowAtMilli: 5000 });
});

test("buildUpdateInput: clearing the low line sends null only when the item had one", () => {
  assert.deepEqual(buildUpdateInput(milk, values({ lowAtText: "" })), { lowAtMilli: null });
  assert.equal(buildUpdateInput(sugar, values({ name: "Sugar", unit: "kg", lowAtText: "" })), null);
});

test("buildUpdateInput never emits a unit, a quantity, an opening stock or archived", () => {
  const input = buildUpdateInput(milk, values({ name: "Oat milk", unit: "ml", openingText: "99", lowAtText: "3" }));
  assert.deepEqual(input, { name: "Oat milk", lowAtMilli: 3000 });
  for (const key of ["unit", "qtyMilli", "qty", "openingQtyMilli", "archived"]) assert.ok(!(key in (input ?? {})), key);
});
