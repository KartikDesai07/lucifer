import { test } from "node:test";
import assert from "node:assert/strict";
import { stockItemUpdate, toStockItemDto, type StockItemRow } from "./items";

// Inventory lite Slice 2: the two pure pieces of the stock-item core. DB behaviour: scripts/verify-inventory-items-live.ts.

const ID = "665f0000000000000000b001";

function row(over: Partial<StockItemRow> = {}): StockItemRow {
  return { _id: { toString: () => ID }, name: "Milk", unit: "L", qty: 10000, ...over };
}

test("toStockItemDto: admin sees lastRatePaise, staff has no such KEY", () => {
  const stored = row({ lastRatePaise: 6000, lowAt: 2000 });
  const admin = toStockItemDto(stored, true);
  const staff = toStockItemDto(stored, false);
  assert.deepEqual(admin, { id: ID, name: "Milk", unit: "L", qtyMilli: 10000, lowAtMilli: 2000, lastRatePaise: 6000 });
  assert.deepEqual(staff, { id: ID, name: "Milk", unit: "L", qtyMilli: 10000, lowAtMilli: 2000 });
  assert.equal("lastRatePaise" in staff, false);
});

test("toStockItemDto: an admin without a stored rate has no lastRatePaise key either", () => {
  const dto = toStockItemDto(row(), true);
  assert.equal("lastRatePaise" in dto, false);
});

test("toStockItemDto: no lowAt means no lowAtMilli key", () => {
  assert.equal("lowAtMilli" in toStockItemDto(row(), true), false);
  assert.equal(toStockItemDto(row({ lowAt: 1 }), true).lowAtMilli, 1);
});

test("toStockItemDto: an absent qty reads 0 and a negative qty is kept", () => {
  assert.equal(toStockItemDto(row({ qty: undefined }), false).qtyMilli, 0);
  assert.equal(toStockItemDto(row({ qty: -2000 }), false).qtyMilli, -2000);
  assert.equal(toStockItemDto(row({ qty: 0 }), false).qtyMilli, 0);
});

test("stockItemUpdate: each key maps to its own operator", () => {
  assert.deepEqual(stockItemUpdate({ name: "Oat milk" }), { $set: { name: "Oat milk" } });
  assert.deepEqual(stockItemUpdate({ lowAtMilli: 500 }), { $set: { lowAt: 500 } });
  assert.deepEqual(stockItemUpdate({ archived: true }), { $set: { archived: true } });
  assert.deepEqual(stockItemUpdate({ name: "A", lowAtMilli: 5, archived: true }), {
    $set: { name: "A", lowAt: 5, archived: true },
  });
});

test("stockItemUpdate: lowAtMilli null clears the line with an $unset, never a $set of null", () => {
  assert.deepEqual(stockItemUpdate({ lowAtMilli: null }), { $unset: { lowAt: "" } });
  assert.deepEqual(stockItemUpdate({ name: "A", lowAtMilli: null }), { $set: { name: "A" }, $unset: { lowAt: "" } });
});

test("stockItemUpdate: nothing to change is null", () => {
  assert.equal(stockItemUpdate({}), null);
});

test("stockItemUpdate: no input ever produces a qty or unit key", () => {
  const inputs = [
    { name: "A" },
    { lowAtMilli: 1 },
    { lowAtMilli: null },
    { archived: true as const },
    { name: "A", lowAtMilli: null, archived: true as const },
    // What a caller that skipped the strict schema might pass: still never written.
    { name: "A", qty: 5, unit: "kg" } as never,
  ];
  for (const input of inputs) {
    const text = JSON.stringify(stockItemUpdate(input));
    assert.doesNotMatch(text, /"(qty|unit)"/, text);
  }
});
