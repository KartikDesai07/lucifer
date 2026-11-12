import { test } from "node:test";
import assert from "node:assert/strict";
import { createStockItemSchema, ownStockSchema, stockUseSchema, updateStockItemSchema } from "./inventory.schema";
import { STOCK_ITEM_NAME_MAX_LEN, STOCK_QTY_MAX_MILLI, STOCK_USE_MAX_LINES } from "../inventory";
import { MAX_VARIATIONS } from "../constants";

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

// Slice 3: the stock use of a menu item (PUT /api/products/[id]/stock-use) and the own-stock one tap.

const MILK = "64b000000000000000000001";
const SUGAR = "64b000000000000000000002";
const line = { itemId: MILK, unit: "ml", qtyMilli: 150000 };

test("stockUseSchema accepts lines, per-size amounts (0 allowed) and an empty list", () => {
  assert.equal(stockUseSchema.safeParse({ lines: [line, { itemId: SUGAR, unit: "g", qtyMilli: 10000 }] }).success, true);
  const sized = { ...line, sizes: [{ name: "Large", qtyMilli: 250000 }, { name: "Small", qtyMilli: 0 }] };
  assert.equal(stockUseSchema.safeParse({ lines: [sized] }).success, true);
  assert.equal(stockUseSchema.safeParse({ lines: [] }).success, true);
});

test("stockUseSchema refuses a zero, float or over-cap amount, a bad id, an unknown unit and an extra key", () => {
  assert.equal(stockUseSchema.safeParse({ lines: [{ ...line, qtyMilli: 0 }] }).success, false);
  assert.equal(stockUseSchema.safeParse({ lines: [{ ...line, qtyMilli: 1.5 }] }).success, false);
  assert.equal(stockUseSchema.safeParse({ lines: [{ ...line, qtyMilli: STOCK_QTY_MAX_MILLI + 1 }] }).success, false);
  assert.equal(stockUseSchema.safeParse({ lines: [{ ...line, itemId: "nope" }] }).success, false);
  assert.equal(stockUseSchema.safeParse({ lines: [{ ...line, itemId: MILK.toUpperCase() }] }).success, false);
  assert.equal(stockUseSchema.safeParse({ lines: [{ ...line, unit: "litre" }] }).success, false);
  assert.equal(stockUseSchema.safeParse({ lines: [{ ...line, qty: 150 }] }).success, false);
  assert.equal(stockUseSchema.safeParse({ lines: [], productId: MILK }).success, false);
  assert.equal(stockUseSchema.safeParse({}).success, false);
});

test("stockUseSchema refuses a repeated stock item, too many lines, and bad sizes", () => {
  assert.equal(stockUseSchema.safeParse({ lines: [line, { ...line, unit: "L", qtyMilli: 150 }] }).success, false);
  const many = Array.from({ length: STOCK_USE_MAX_LINES + 1 }, (_, i) => ({
    ...line,
    itemId: `64b0000000000000000001${String(i).padStart(2, "0")}`,
  }));
  assert.equal(stockUseSchema.safeParse({ lines: many.slice(0, STOCK_USE_MAX_LINES) }).success, true);
  assert.equal(stockUseSchema.safeParse({ lines: many }).success, false);
  const sizes = (list: unknown[]) => stockUseSchema.safeParse({ lines: [{ ...line, sizes: list }] }).success;
  assert.equal(sizes([]), false);
  assert.equal(sizes([{ name: "Large", qtyMilli: 1 }, { name: "Large", qtyMilli: 2 }]), false);
  assert.equal(sizes([{ name: "Large", qtyMilli: -1 }]), false);
  assert.equal(sizes([{ name: "", qtyMilli: 1 }]), false);
  assert.equal(sizes(Array.from({ length: MAX_VARIATIONS + 1 }, (_, i) => ({ name: `S${i}`, qtyMilli: 1 }))), false);
});

test("stockUseSchema keeps a size name byte for byte (a sale matches it exactly)", () => {
  const parsed = stockUseSchema.safeParse({ lines: [{ ...line, sizes: [{ name: " Large", qtyMilli: 1 }] }] });
  assert.equal(parsed.success && parsed.data.lines[0].sizes?.[0].name, " Large");
});

test("ownStockSchema defaults to pcs and refuses an unknown unit or an extra key", () => {
  const empty = ownStockSchema.safeParse({});
  assert.equal(empty.success && empty.data.unit, "pcs");
  const kg = ownStockSchema.safeParse({ unit: "kg" });
  assert.equal(kg.success && kg.data.unit, "kg");
  assert.equal(ownStockSchema.safeParse({ unit: "kgs" }).success, false);
  assert.equal(ownStockSchema.safeParse({ unit: "kg", qty: 1 }).success, false);
});
