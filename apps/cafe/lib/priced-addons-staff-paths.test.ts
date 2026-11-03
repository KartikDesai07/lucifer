import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "./source-pin-utils";

// Priced add-ons (owner, 2026-11-02) - source pins for the staff write paths:
// both order writers read modifierPrices and stamp it, the product PUT judges
// the resulting doc before writing, the CSV import prunes orphaned amounts, and
// the models carry the omit-empty paths. Behaviour: modifier-price-stamp.test.ts,
// product-addons-check.test.ts, order-availability.test.ts.

const CAFE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8")).replace(/\r\n/g, "\n");
const count = (src: string, needle: string) => src.split(needle).length - 1;

const ORDERS_ROUTE = "app/api/orders/route.ts";
const ITEMS_ROUTE = "app/api/orders/[id]/items/route.ts";
const SELECT = '.select("name variations modifiers modifiersPreselected modifierPrices price discount available isActive")';

test("PIN: both staff order writers select modifierPrices and stamp the new lines from the rows they read", () => {
  for (const rel of [ORDERS_ROUTE, ITEMS_ROUTE]) {
    const src = read(rel);
    assert.ok(src.includes("Product.find({ _id: { $in: productIds } })"), `${rel}: the product read is still there (landmark)`);
    assert.equal(count(src, SELECT), 1, `${rel}: the one product select carries modifierPrices`);
    assert.ok(src.includes('import { stampModifierPrices } from "@/lib/modifier-price-stamp"'), `${rel}: imports the stamp helper`);
    assert.equal(count(src, "stampModifierPrices(") , 1, `${rel}: stamps exactly once`);
  }
  // The stamp rides the array that withKitchenFlags stamps and that is written.
  const create = read(ORDERS_ROUTE);
  assert.ok(create.includes("withKitchenFlags(stampModifierPrices(rewardItems, products))"), "create: stamped before the kitchen flags, on the written array");
  assert.ok(create.includes("rewardItems = kot.lines;"), "create: the stamped array is what is kept");
  const round = read(ITEMS_ROUTE);
  assert.ok(round.includes("stampModifierPrices(parsed.data.items, products).map("), "round: new lines stamped before they join fullItems");
  assert.ok(round.includes("withKitchenFlags(fullItems.slice(old.items.length))"), "round: landmark - the flagged slice is the stamped one");
});

test("PIN: the stamp comes after the menu check passes (create route)", () => {
  const src = read(ORDERS_ROUTE);
  const check = src.indexOf("orderLinesRefusal(products, data.items)");
  const stamp = src.indexOf("stampModifierPrices(rewardItems");
  assert.ok(check !== -1 && stamp !== -1, "both landmarks present");
  assert.ok(stamp > check, "stamp after the menu re-check");
});

test("PIN: crud-route PUT runs validateUpdate after connectDB and before the write, 400 on a message", () => {
  const src = read("lib/crud-route.ts");
  assert.ok(src.includes("validateUpdate?: (id: string, data: z.infer<TUpdate>) => Promise<string | null>;"), "config type");
  const put = src.slice(src.indexOf("async function PUT("), src.indexOf("async function DELETE("));
  const connect = put.indexOf("await connectDB()");
  const hook = put.indexOf("config.validateUpdate?.(id,");
  const write = put.indexOf(".findByIdAndUpdate(");
  assert.ok(connect !== -1 && hook !== -1 && write !== -1, "landmarks present");
  assert.ok(connect < hook && hook < write, "connectDB, then the hook, then the write");
  assert.ok(put.includes("if (invalid) return failure(invalid, 400);"), "a message is a 400");
});

test("PIN: the product routes wire the add-on rule (create validate, PUT validateUpdate, null clears)", () => {
  const create = read("app/api/products/route.ts");
  assert.ok(create.includes("productAddOnsError(data) ??"), "create judges the add-on rule first");
  const put = read("app/api/products/[id]/route.ts");
  assert.ok(put.includes("createItemRoute({"), "landmark: item route factory");
  assert.ok(put.includes("validateUpdate: productUpdateAddOnsError"), "PUT wires validateUpdate");
  assert.match(put, /nullClearsFields:\s*\[[^\]]*"modifierPrices"[^\]]*\]/, "modifierPrices null clears");
});

test("PIN: the CSV import prunes an amount whose add-on left modifiers, in the same write", () => {
  const src = read("app/api/products/import/route.ts");
  assert.ok(src.includes("modifiers: e.data.modifiers,"), "landmark: the $set carries the CSV modifiers");
  assert.ok(src.includes("$pull: { modifierPrices: { name: { $nin: e.data.modifiers } } }"), "$pull of orphaned amounts");
  assert.equal(src.includes("modifierPrices: e.data"), false, "the import never writes amounts");
});

test("PIN: Product and Order line schemas declare modifierPrices omit-empty, the void trail does not", () => {
  const product = read("models/Product.ts");
  assert.ok(product.includes("modifierPrices: { type: [productModifierPriceSchema], default: undefined }"), "Product path");
  const order = read("models/Order.ts");
  assert.ok(order.includes("modifierPrices: { type: [orderItemModifierPriceSchema], default: undefined }"), "Order line path");
  assert.equal(count(order, "modifierPrices: {"), 1, "only the line schema has it");
  assert.ok(order.includes("const orderVoidSchema"), "landmark: the void trail schema exists");
});
