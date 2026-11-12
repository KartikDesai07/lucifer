import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DUE_NEEDS_SUPPLIER_ERROR,
  PAID_OVER_TOTAL_ERROR,
  createStockEntrySchema,
  createStockItemSchema,
  createSupplierSchema,
  ownStockSchema,
  stockEntryListQuerySchema,
  stockUseSchema,
  updateStockItemSchema,
  updateSupplierSchema,
} from "./inventory.schema";
import {
  PURCHASE_MAX_LINES,
  STOCK_ENTRY_MAX_TOTAL_PAISE,
  STOCK_ENTRY_NOTE_MAX_LEN,
  STOCK_ENTRY_PAGE_MAX,
  STOCK_ITEM_NAME_MAX_LEN,
  STOCK_QTY_MAX_MILLI,
  STOCK_RATE_MAX_PAISE,
  STOCK_USE_MAX_LINES,
  SUPPLIER_NAME_MAX_LEN,
  SUPPLIER_NOTE_MAX_LEN,
  SUPPLIER_PHONE_MAX_LEN,
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
  assert.equal(createStockEntrySchema.safeParse({ ...waste, kind: "purchase" }).success, false, "a purchase has its own keys");
  assert.equal(createStockEntrySchema.safeParse({ ...waste, kind: "payment" }).success, false, "a payment has its own keys (Slice 6)");
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

// Inventory lite Slice 5: a purchase (admin) and the supplier bodies.

const SUPPLIER = "665f00000000000000000009";
const ITEM_2 = "665f00000000000000000002";
// 2.5 kg at Rs 40.10 = Rs 100.25; 3 pcs at Rs 12 = Rs 36: total 13625 paise.
const purchase = {
  kind: "purchase",
  supplierId: SUPPLIER,
  date: "2026-11-13",
  lines: [
    { itemId: ITEM, qtyMilli: 2500, ratePaise: 4010 },
    { itemId: ITEM_2, qtyMilli: 3000, ratePaise: 1200 },
  ],
  paidPaise: 13625,
  clientRef: REF,
};
const PURCHASE_TOTAL = 13625;
const { supplierId: _noSupplier, ...purchaseNoSupplier } = purchase;

const issueAt = (body: unknown, key: string): string | undefined => {
  const parsed = createStockEntrySchema.safeParse(body);
  if (parsed.success) return undefined;
  return parsed.error.issues.find((issue) => issue.path[0] === key)?.message;
};

test("createStockEntrySchema accepts a purchase paid in full, in part with a supplier, and a free line", () => {
  assert.equal(createStockEntrySchema.safeParse(purchase).success, true);
  assert.equal(createStockEntrySchema.safeParse(purchaseNoSupplier).success, true, "paid in full needs no supplier");
  assert.equal(createStockEntrySchema.safeParse({ ...purchase, paidPaise: 0 }).success, true, "nothing paid, all owed");
  assert.equal(createStockEntrySchema.safeParse({ ...purchase, paidPaise: 5000, note: "Bill 42" }).success, true);
  const free = { ...purchaseNoSupplier, lines: [{ itemId: ITEM, qtyMilli: 1000, ratePaise: 0 }], paidPaise: 0 };
  assert.equal(createStockEntrySchema.safeParse(free).success, true, "free goods: rate 0, total 0, nothing owed");
});

test("createStockEntrySchema: paid over the total, or anything owed without a supplier, is refused", () => {
  assert.equal(issueAt({ ...purchase, paidPaise: PURCHASE_TOTAL + 1 }, "paidPaise"), PAID_OVER_TOTAL_ERROR);
  assert.equal(issueAt({ ...purchaseNoSupplier, paidPaise: PURCHASE_TOTAL - 1 }, "supplierId"), DUE_NEEDS_SUPPLIER_ERROR);
  assert.equal(issueAt({ ...purchaseNoSupplier, paidPaise: 0 }, "supplierId"), DUE_NEEDS_SUPPLIER_ERROR);
  assert.equal(createStockEntrySchema.safeParse({ ...purchase, supplierId: "abc" }).success, false);
});

test("createStockEntrySchema: purchase lines need 1..max unique items, qty above 0, whole paise within the caps", () => {
  const line = purchase.lines[0];
  const idOf = (i: number) => (0x665f0000 + i).toString(16).padEnd(24, "0");
  const many = Array.from({ length: PURCHASE_MAX_LINES + 1 }, (_, i) => ({ ...line, itemId: idOf(i) }));
  assert.equal(createStockEntrySchema.safeParse({ ...purchase, lines: [] }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...purchase, lines: many, paidPaise: 0 }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...purchase, lines: many.slice(0, PURCHASE_MAX_LINES), paidPaise: 0 }).success, true);
  assert.equal(createStockEntrySchema.safeParse({ ...purchase, lines: [line, line], paidPaise: 0 }).success, false, "an item twice");
  const bads = [{ qtyMilli: 0 }, { qtyMilli: 1.5 }, { qtyMilli: STOCK_QTY_MAX_MILLI + 1 }, { ratePaise: -1 }, { ratePaise: 10.5 }, { ratePaise: STOCK_RATE_MAX_PAISE + 1 }];
  for (const bad of bads) {
    assert.equal(createStockEntrySchema.safeParse({ ...purchase, lines: [{ ...line, ...bad }], paidPaise: 0 }).success, false, JSON.stringify(bad));
  }
  assert.equal(createStockEntrySchema.safeParse({ ...purchase, lines: [{ ...line, amountPaise: 1 }] }).success, false, "no client amounts");
  assert.equal(createStockEntrySchema.safeParse({ ...purchase, totalPaise: PURCHASE_TOTAL }).success, false, "no client total");
  assert.equal(createStockEntrySchema.safeParse({ ...purchase, paidPaise: 10.5 }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...purchase, paidPaise: -1 }).success, false);
});

test("createStockEntrySchema: a purchase over the total cap is refused on its lines", () => {
  // Two lines at the per-unit cap: one alone fits under the total cap, the two together pass it.
  const qtyMilli = Math.ceil(((STOCK_ENTRY_MAX_TOTAL_PAISE / 2 + 1) * 1000) / STOCK_RATE_MAX_PAISE);
  const lines = [
    { itemId: ITEM, qtyMilli, ratePaise: STOCK_RATE_MAX_PAISE },
    { itemId: ITEM_2, qtyMilli, ratePaise: STOCK_RATE_MAX_PAISE },
  ];
  assert.ok(issueAt({ ...purchase, lines, paidPaise: 0 }, "lines")?.includes("at most"), "the total cap names the limit");
  assert.equal(createStockEntrySchema.safeParse({ ...purchase, lines: lines.slice(0, 1), paidPaise: 0 }).success, true);
});

test("createSupplierSchema / updateSupplierSchema: name, phone and note shapes; strict keys", () => {
  assert.equal(createSupplierSchema.safeParse({ name: "Fresh Dairy" }).success, true);
  assert.equal(createSupplierSchema.safeParse({ name: "Fresh Dairy", phone: "+91 98765-43210", note: "Comes Mon" }).success, true);
  assert.equal(createSupplierSchema.safeParse({ name: "Fresh Dairy", phone: "" }).success, true, "empty phone = none");
  assert.equal(createSupplierSchema.safeParse({ name: "   " }).success, false);
  assert.equal(createSupplierSchema.safeParse({ name: "x".repeat(SUPPLIER_NAME_MAX_LEN + 1) }).success, false);
  assert.equal(createSupplierSchema.safeParse({ name: "A", phone: "call me" }).success, false);
  assert.equal(createSupplierSchema.safeParse({ name: "A", phone: "9".repeat(SUPPLIER_PHONE_MAX_LEN + 1) }).success, false);
  assert.equal(createSupplierSchema.safeParse({ name: "A", note: "x".repeat(SUPPLIER_NOTE_MAX_LEN + 1) }).success, false);
  assert.equal(createSupplierSchema.safeParse({ name: "A", duePaise: 0 }).success, false, "no stored dues");
  const trimmed = createSupplierSchema.safeParse({ name: "  Fresh Dairy  " });
  assert.ok(trimmed.success && trimmed.data.name === "Fresh Dairy");

  assert.equal(updateSupplierSchema.safeParse({}).success, true);
  assert.equal(updateSupplierSchema.safeParse({ phone: null, note: null }).success, true, "null clears");
  assert.equal(updateSupplierSchema.safeParse({ archived: true }).success, true);
  assert.equal(updateSupplierSchema.safeParse({ archived: false }).success, false, "no un-archive yet");
  assert.equal(updateSupplierSchema.safeParse({ name: "" }).success, false);
  assert.equal(updateSupplierSchema.safeParse({ duePaise: 0 }).success, false);
});

// Inventory lite Slice 6: a payment to a supplier (admin) and the supplier filter of the list query.

const payment = { kind: "payment", supplierId: SUPPLIER, amountPaise: 120050, date: "2026-11-13", clientRef: REF };

test("createStockEntrySchema accepts a payment, with or without a note, up to the cap", () => {
  assert.equal(createStockEntrySchema.safeParse(payment).success, true);
  assert.equal(createStockEntrySchema.safeParse({ ...payment, note: "Cash at the door" }).success, true);
  assert.equal(createStockEntrySchema.safeParse({ ...payment, amountPaise: 1 }).success, true, "one paisa is a payment");
  assert.equal(createStockEntrySchema.safeParse({ ...payment, amountPaise: STOCK_ENTRY_MAX_TOTAL_PAISE }).success, true);
});

test("createStockEntrySchema refuses a payment of 0, below 0, a float, over the cap, or without a supplier", () => {
  for (const amountPaise of [0, -100, 10.5, STOCK_ENTRY_MAX_TOTAL_PAISE + 1]) {
    assert.equal(createStockEntrySchema.safeParse({ ...payment, amountPaise }).success, false, String(amountPaise));
  }
  const { supplierId: _none, ...noSupplier } = payment;
  assert.equal(createStockEntrySchema.safeParse(noSupplier).success, false, "a payment always names its supplier");
  assert.equal(createStockEntrySchema.safeParse({ ...payment, supplierId: "raju" }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...payment, clientRef: "abc" }).success, false);
  assert.equal(createStockEntrySchema.safeParse({ ...payment, date: "2026-02-30" }).success, false);
});

test("createStockEntrySchema: a payment has only its own keys (no lines, no paid, no due, no pay-it-all flag)", () => {
  for (const extra of [{ lines: [] }, { paidPaise: 100 }, { duePaise: -100 }, { totalPaise: 100 }, { payAll: true }, { itemId: ITEM }]) {
    assert.equal(createStockEntrySchema.safeParse({ ...payment, ...extra }).success, false, Object.keys(extra)[0]);
  }
  const { amountPaise: _none, ...noAmount } = payment;
  assert.equal(createStockEntrySchema.safeParse(noAmount).success, false, "the amount is always sent");
});

test("stockEntryListQuerySchema takes one supplier's id, and nothing else in its place", () => {
  assert.equal(stockEntryListQuerySchema.safeParse({ supplierId: SUPPLIER }).success, true);
  assert.equal(stockEntryListQuerySchema.safeParse({ supplierId: SUPPLIER, before: `2026-11-13_${ITEM}` }).success, true);
  assert.equal(stockEntryListQuerySchema.safeParse({ supplierId: "raju" }).success, false);
  assert.equal(stockEntryListQuerySchema.safeParse({ supplierId: { $ne: null } }).success, false);
});
