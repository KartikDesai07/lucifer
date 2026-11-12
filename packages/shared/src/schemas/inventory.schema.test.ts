import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createStockEntrySchema,
  createStockItemSchema,
  ownStockSchema,
  stockEntryListQuerySchema,
  stockUseSchema,
  updateStockItemSchema,
} from "./inventory.schema";
import {
  STOCK_ENTRY_NOTE_MAX_LEN,
  STOCK_ENTRY_PAGE_MAX,
  STOCK_ITEM_NAME_MAX_LEN,
  STOCK_QTY_MAX_MILLI,
  STOCK_USE_MAX_LINES,
  WASTE_REASONS,
} from "../inventory";
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

// Inventory lite Slice 4: the write body of POST /api/inventory/entries and the list query.

const REF = "0b5a2f2e-6a43-4d7e-9a51-6c1f0f5d2b11";
const ITEM = "665f00000000000000000001";
const waste = { kind: "waste", itemId: ITEM, qtyMilli: 500, reason: "Spoiled", date: "2026-11-13", clientRef: REF };
const count = { kind: "count", itemId: ITEM, countedMilli: 4250, date: "2026-11-13", clientRef: REF };

test("createStockEntrySchema accepts a wastage and a count, with or without a note", () => {
  assert.equal(createStockEntrySchema.safeParse(waste).success, true);
  assert.equal(createStockEntrySchema.safeParse({ ...waste, note: "Left out overnight" }).success, true);
  assert.equal(createStockEntrySchema.safeParse(count).success, true);
  assert.equal(createStockEntrySchema.safeParse({ ...count, countedMilli: 0 }).success, true, "a count of nothing is a real count");
  for (const reason of WASTE_REASONS) assert.equal(createStockEntrySchema.safeParse({ ...waste, reason }).success, true, reason);
});

test("createStockEntrySchema refuses a wastage of 0, a float, an over-cap amount and an unknown reason", () => {
  assert.equal(createStockEntrySchema.safeParse({ ...waste, qtyMilli: 0 }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...waste, qtyMilli: -500 }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...waste, qtyMilli: 1.5 }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...waste, qtyMilli: STOCK_QTY_MAX_MILLI + 1 }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...waste, reason: "Stolen" }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...count, countedMilli: -1 }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...count, countedMilli: STOCK_QTY_MAX_MILLI + 1 }).success, false);
});

test("createStockEntrySchema keeps each kind's own keys: no reason on a count, no countedMilli on a wastage", () => {
  assert.equal(createStockEntrySchema.safeParse({ ...count, reason: "Spoiled" }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...waste, countedMilli: 5 }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...waste, kind: "purchase" }).success, false, "purchases ship later");
  assert.equal(createStockEntrySchema.safeParse({ ...waste, createdBy: "Someone" }).success, false);
});

test("createStockEntrySchema needs a real date, a uuid clientRef, an item id and a short note", () => {
  assert.equal(createStockEntrySchema.safeParse({ ...waste, date: "2026-02-30" }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...waste, date: "13-11-2026" }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...waste, clientRef: "abc" }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...waste, itemId: "milk" }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...waste, note: "x".repeat(STOCK_ENTRY_NOTE_MAX_LEN + 1) }).success, false);
  const trimmed = createStockEntrySchema.safeParse({ ...waste, note: "  dropped  " });
  assert.ok(trimmed.success && trimmed.data.note === "dropped");
});

test("stockEntryListQuerySchema takes a server cursor and a limit up to one page", () => {
  assert.equal(stockEntryListQuerySchema.safeParse({}).success, true);
  assert.equal(stockEntryListQuerySchema.safeParse({ before: `2026-11-13_${ITEM}`, limit: "20" }).success, true);
  assert.equal(stockEntryListQuerySchema.safeParse({ limit: String(STOCK_ENTRY_PAGE_MAX + 1) }).success, false);
  assert.equal(stockEntryListQuerySchema.safeParse({ limit: "0" }).success, false);
  assert.equal(stockEntryListQuerySchema.safeParse({ before: ITEM }).success, false);
  assert.equal(stockEntryListQuerySchema.safeParse({ before: `2026-11-13_${ITEM.toUpperCase()}x` }).success, false);
  assert.equal(stockEntryListQuerySchema.safeParse({ before: { $gt: "" } }).success, false);
});
