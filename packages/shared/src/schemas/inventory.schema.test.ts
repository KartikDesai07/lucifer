import { test } from "node:test";
import assert from "node:assert/strict";
import { createStockItemSchema, updateStockItemSchema } from "./inventory.schema";
import { STOCK_ITEM_NAME_MAX_LEN, STOCK_QTY_MAX_MILLI } from "../inventory";

// Inventory lite Slice 2: the write bodies of /api/inventory/items.

const valid = { name: "Milk", unit: "L", openingQtyMilli: 10000, lowAtMilli: 2000 };

test("createStockItemSchema accepts a full body and one with only name and unit", () => {
  assert.equal(createStockItemSchema.safeParse(valid).success, true);
  assert.equal(createStockItemSchema.safeParse({ name: "Sugar", unit: "kg" }).success, true);
  assert.equal(createStockItemSchema.safeParse({ ...valid, openingQtyMilli: 0 }).success, true);
  assert.equal(createStockItemSchema.safeParse({ ...valid, openingQtyMilli: STOCK_QTY_MAX_MILLI }).success, true);
});

test("createStockItemSchema refuses an unknown unit, a float, a negative and an over-cap quantity", () => {
  assert.equal(createStockItemSchema.safeParse({ ...valid, unit: "kgs" }).success, false);
  assert.equal(createStockItemSchema.safeParse({ ...valid, openingQtyMilli: 1.5 }).success, false);
  assert.equal(createStockItemSchema.safeParse({ ...valid, openingQtyMilli: -1 }).success, false);
  assert.equal(createStockItemSchema.safeParse({ ...valid, openingQtyMilli: STOCK_QTY_MAX_MILLI + 1 }).success, false);
});

test("createStockItemSchema refuses an extra key", () => {
  assert.equal(createStockItemSchema.safeParse({ ...valid, qty: 5 }).success, false);
});

test("createStockItemSchema trims the name and refuses an empty or too-long one", () => {
  const trimmed = createStockItemSchema.safeParse({ ...valid, name: "  Milk  " });
  assert.equal(trimmed.success && trimmed.data.name, "Milk");
  assert.equal(createStockItemSchema.safeParse({ ...valid, name: "   " }).success, false);
  assert.equal(createStockItemSchema.safeParse({ ...valid, name: "" }).success, false);
  assert.equal(createStockItemSchema.safeParse({ ...valid, name: "a".repeat(STOCK_ITEM_NAME_MAX_LEN) }).success, true);
  assert.equal(createStockItemSchema.safeParse({ ...valid, name: "a".repeat(STOCK_ITEM_NAME_MAX_LEN + 1) }).success, false);
});

test("updateStockItemSchema refuses unit and any stock number", () => {
  assert.equal(updateStockItemSchema.safeParse({ unit: "kg" }).success, false);
  assert.equal(updateStockItemSchema.safeParse({ qty: 1 }).success, false);
  assert.equal(updateStockItemSchema.safeParse({ qtyMilli: 1 }).success, false);
});

test("updateStockItemSchema: lowAtMilli null clears, 0 is refused, a level above 0 is fine", () => {
  assert.equal(updateStockItemSchema.safeParse({ lowAtMilli: null }).success, true);
  assert.equal(updateStockItemSchema.safeParse({ lowAtMilli: 0 }).success, false);
  assert.equal(updateStockItemSchema.safeParse({ lowAtMilli: 500 }).success, true);
});

test("updateStockItemSchema: archived can only be true", () => {
  assert.equal(updateStockItemSchema.safeParse({ archived: false }).success, false);
  assert.equal(updateStockItemSchema.safeParse({ archived: true }).success, true);
  assert.equal(updateStockItemSchema.safeParse({ name: "Oat milk" }).success, true);
});
