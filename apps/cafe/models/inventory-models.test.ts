import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { StockEntry, stockEntrySchema } from "./StockEntry";
import { StockItem, stockItemSchema, STOCK_ITEM_SCHEMA_VERSION } from "./StockItem";
import { Supplier, supplierSchema, SUPPLIER_SCHEMA_VERSION } from "./Supplier";
import { Product } from "./Product";
import { Order } from "./Order";
import { STOCK_UNITS, SUPPLIER_NAME_MAX_LEN, SUPPLIER_NOTE_MAX_LEN, SUPPLIER_PHONE_MAX_LEN } from "@pos/shared/inventory";

// Inventory lite (Slice 1) — the model shapes, DB-free: documents are built, validated and toObject()-ed, never
// saved. The DB-truth (the partial unique index build, $inc on a real row) is verify:inventory:live.

const ITEM = new Types.ObjectId();

test("StockItem: the one-tap index is unique, partial on $exists, and named", () => {
  const found = stockItemSchema.indexes().find(([keys]) => JSON.stringify(keys) === JSON.stringify({ ownerProductId: 1 }));
  assert.ok(found, "the ownerProductId index is declared");
  const [, options] = found;
  assert.equal(options.unique, true);
  assert.deepEqual(options.partialFilterExpression, { ownerProductId: { $exists: true } });
  assert.equal(options.name, "ownerProductId_unique_partial");
  assert.equal(options.sparse, undefined, "partial, not sparse");
  assert.ok(
    stockItemSchema.indexes().every(([, o]) => o.expireAfterSeconds === undefined),
    "no TTL index (an inventory record never expires)",
  );
});

test("StockItem: the unit enum is the shared list; an unknown unit is refused", () => {
  assert.deepEqual(stockItemSchema.path("unit").options.enum, [...STOCK_UNITS]);
  const bad = new StockItem({ name: "Milk", unit: "kgs" }).validateSync();
  assert.ok(bad?.errors.unit, "kgs is not a unit");
  for (const unit of STOCK_UNITS) {
    assert.equal(new StockItem({ name: "Milk", unit }).validateSync(), undefined, `landmark: ${unit} validates`);
  }
});

test("StockItem: qty defaults to 0 and v to the schema version; optional paths store no key", () => {
  const obj = new StockItem({ name: "Milk", unit: "L" }).toObject() as unknown as Record<string, unknown>;
  assert.equal(obj.qty, 0);
  assert.equal(obj.v, STOCK_ITEM_SCHEMA_VERSION);
  for (const key of ["lowAt", "lastRatePaise", "ownerProductId", "archived"]) assert.equal(key in obj, false, key);
  assert.equal(stockItemSchema.path("lastRatePaise").instance, "Int32", "a rate is paise, Int32");
  assert.equal(stockItemSchema.path("qty").instance, "Number", "qty is a plain Number (ml stock would overflow Int32)");
});

test("StockItem: qty and lowAt are whole milli-units; negative stock is legal (a sale is never blocked)", () => {
  assert.ok(new StockItem({ name: "Milk", unit: "L", qty: 1.5 }).validateSync()?.errors.qty);
  assert.ok(new StockItem({ name: "Milk", unit: "L", lowAt: 0.5 }).validateSync()?.errors.lowAt);
  assert.equal(new StockItem({ name: "Milk", unit: "L", qty: -2000, lowAt: 500 }).validateSync(), undefined);
});

test("StockItem: the name is required and capped", () => {
  assert.ok(new StockItem({ unit: "L" }).validateSync()?.errors.name);
  assert.ok(new StockItem({ name: "x".repeat(61), unit: "L" }).validateSync()?.errors.name);
  assert.equal(new StockItem({ name: "x".repeat(60), unit: "L" }).validateSync(), undefined, "landmark: 60 is fine");
});

test("Product: a product made without stock use carries no stockUse key (existing products unchanged)", () => {
  const plain = new Product({ name: "Tea", categoryId: new Types.ObjectId(), price: 20 }).toObject() as unknown as Record<string, unknown>;
  assert.equal("stockUse" in plain, false);
  const linked = new Product({
    name: "Tea",
    categoryId: new Types.ObjectId(),
    price: 20,
    stockUse: [{ itemId: ITEM, qty: 150 }, { itemId: ITEM, qty: 10, sizes: [{ name: "Large", qty: 0 }] }],
  });
  assert.equal(linked.validateSync(), undefined, "landmark: a stock-use product validates");
  const obj = linked.toObject() as unknown as { stockUse: Array<Record<string, unknown>> };
  assert.equal("sizes" in obj.stockUse[0], false, "a link with one amount stores no sizes key");
  assert.equal("_id" in obj.stockUse[0], false, "embedded, no _id");
  assert.deepEqual(obj.stockUse[1].sizes, [{ name: "Large", qty: 0 }], "a size may take 0");
  assert.ok(new Product({ name: "Tea", categoryId: new Types.ObjectId(), price: 20, stockUse: [{ itemId: ITEM, qty: 0 }] }).validateSync());
});

const ORDER_BASE = { orderId: "A-0001", customerName: "Walk-in", items: [{ productId: new Types.ObjectId(), name: "Tea", price: 20, qty: 1 }], subtotal: 20, total: 20, paidAmount: 20, payment: "Cash", receiver: "x" };

test("Order: an order made without a snapshot carries no stockUsed key; one with it keeps it exactly", () => {
  const plain = new Order(ORDER_BASE).toObject() as unknown as Record<string, unknown>;
  assert.equal("stockUsed" in plain, false);
  const withUse = new Order({ ...ORDER_BASE, stockUsed: [{ itemId: ITEM, qty: 150 }] });
  assert.equal(withUse.validateSync(), undefined, "landmark: the snapshot validates");
  const obj = withUse.toObject() as unknown as { stockUsed: Array<Record<string, unknown>> };
  assert.deepEqual(Object.keys(obj.stockUsed[0]).sort(), ["itemId", "qty"], "declared (strict keeps it), no _id");
  assert.equal(String(obj.stockUsed[0].itemId), String(ITEM));
});

test("Order: stockUsed.qty is at least 1 (a zero line is never stored)", () => {
  const zero = new Order({ ...ORDER_BASE, stockUsed: [{ itemId: ITEM, qty: 0 }] }).validateSync();
  assert.ok(zero?.errors["stockUsed.0.qty"], "qty 0 is refused");
  assert.equal(new Order({ ...ORDER_BASE, stockUsed: [{ itemId: ITEM, qty: 1 }] }).validateSync(), undefined, "landmark: 1 is fine");
});

// ── StockEntry (Slice 4) ─────────────────────────────────────────────────────

const WASTE_DOC = {
  kind: "waste",
  date: "2026-11-10",
  lines: [{ itemId: ITEM, qty: -500 }],
  reason: "Spoiled",
  createdBy: "Asha",
  createdById: "u1",
  clientRef: "9b2f6a1e-0c43-4f1b-8a52-3d6f1c0e7a11",
};

test("StockEntry: indexes - clientRef unique, the date/_id list index, supplierId partial; no TTL", () => {
  const indexes = stockEntrySchema.indexes();
  const find = (keys: object) => indexes.find(([k]) => JSON.stringify(k) === JSON.stringify(keys));
  assert.equal(stockEntrySchema.path("clientRef").options.unique, true, "clientRef is unique");
  const list = find({ date: -1, _id: -1 });
  assert.ok(list, "the date/_id index is declared");
  assert.equal(list[1].name, "date_-1__id_-1");
  const supplier = find({ supplierId: 1, date: -1 });
  assert.ok(supplier, "the supplier index is declared");
  assert.deepEqual(supplier[1].partialFilterExpression, { supplierId: { $exists: true } });
  assert.ok(indexes.every(([, o]) => o.expireAfterSeconds === undefined), "no TTL index");
});

test("StockEntry: the kind and reason enums refuse unknown values; a minimal waste doc validates", () => {
  assert.equal(new StockEntry(WASTE_DOC).validateSync(), undefined, "landmark: the waste doc validates");
  assert.ok(new StockEntry({ ...WASTE_DOC, kind: "adjust" }).validateSync()?.errors.kind, "adjust is not a kind");
  assert.ok(new StockEntry({ ...WASTE_DOC, reason: "Stolen" }).validateSync()?.errors.reason, "Stolen is not a reason");
});

test("StockEntry: a minimal waste doc stores no deleted / supplier / money keys; v defaults", () => {
  const obj = new StockEntry(WASTE_DOC).toObject() as unknown as Record<string, unknown>;
  for (const key of ["deletedAt", "deletedBy", "supplierId", "totalPaise", "paidPaise", "duePaise", "note"]) {
    assert.equal(key in obj, false, key);
  }
  assert.equal(obj.v, 1);
  assert.equal("_id" in (obj.lines as Array<Record<string, unknown>>)[0], false, "lines are embedded, no _id");
});

test("StockEntry: lines[].qty is a whole number of milli-units; money paths are Int32", () => {
  assert.ok(new StockEntry({ ...WASTE_DOC, lines: [{ itemId: ITEM, qty: 1.5 }] }).validateSync()?.errors["lines.0.qty"]);
  assert.equal(new StockEntry({ ...WASTE_DOC, lines: [{ itemId: ITEM, qty: -2000 }] }).validateSync(), undefined, "landmark: negative is legal");
  for (const money of ["totalPaise", "paidPaise", "duePaise"]) {
    assert.equal(stockEntrySchema.path(money).instance, "Int32", money);
  }
  assert.equal(stockEntrySchema.path("lines.ratePaise").instance, "Int32");
  assert.equal(stockEntrySchema.path("lines.amountPaise").instance, "Int32");
});

// ── Supplier (Slice 5) ───────────────────────────────────────────────────────

const SUPPLIER_DOC = { name: "Sharma Dairy" };

test("Supplier: a minimal doc validates; optional paths and archived store no key; v defaults", () => {
  assert.equal(new Supplier(SUPPLIER_DOC).validateSync(), undefined, "landmark: the minimal doc validates");
  const obj = new Supplier(SUPPLIER_DOC).toObject() as unknown as Record<string, unknown>;
  for (const key of ["phone", "note", "archived"]) assert.equal(key in obj, false, key);
  assert.equal(obj.v, SUPPLIER_SCHEMA_VERSION);
  assert.equal(SUPPLIER_SCHEMA_VERSION, 1);
});

test("Supplier: name is required and every text path has its shared length limit", () => {
  assert.ok(new Supplier({}).validateSync()?.errors.name, "a name is required");
  const long = (n: number) => "x".repeat(n + 1);
  assert.ok(new Supplier({ name: long(SUPPLIER_NAME_MAX_LEN) }).validateSync()?.errors.name, "name over the limit");
  assert.ok(new Supplier({ ...SUPPLIER_DOC, phone: long(SUPPLIER_PHONE_MAX_LEN) }).validateSync()?.errors.phone, "phone over the limit");
  assert.ok(new Supplier({ ...SUPPLIER_DOC, note: long(SUPPLIER_NOTE_MAX_LEN) }).validateSync()?.errors.note, "note over the limit");
  const edge = { name: "x".repeat(SUPPLIER_NAME_MAX_LEN), phone: "9".repeat(SUPPLIER_PHONE_MAX_LEN), note: "n".repeat(SUPPLIER_NOTE_MAX_LEN) };
  assert.equal(new Supplier(edge).validateSync(), undefined, "landmark: the limits themselves are fine");
});

test("Supplier: no TTL index and no unique index (names are matched by the write, with a collation)", () => {
  const indexes = supplierSchema.indexes();
  assert.ok(indexes.every(([, o]) => o.expireAfterSeconds === undefined), "no TTL index");
  assert.ok(indexes.every(([, o]) => o.unique !== true), "no unique index: an archived supplier may share a name");
  assert.equal(supplierSchema.path("name").options.unique, undefined, "name is not unique at the path either");
  assert.equal(supplierSchema.path("archived").instance, "Boolean", "landmark: a path of the schema is readable here");
});

test("Supplier: there is no stored balance path (dues are summed from the entries on read)", () => {
  for (const banned of ["due", "duePaise", "balance", "balancePaise", "owed"]) {
    assert.equal(supplierSchema.path(banned), undefined, banned);
  }
  assert.ok(supplierSchema.path("name"), "landmark: path() does find a real path");
});
