import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { StockItem, stockItemSchema, STOCK_ITEM_SCHEMA_VERSION } from "./StockItem";
import { Product } from "./Product";
import { Order } from "./Order";
import { STOCK_UNITS } from "@pos/shared/inventory";

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
