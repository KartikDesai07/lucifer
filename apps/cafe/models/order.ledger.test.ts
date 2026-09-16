import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  orderSchema,
  orderItemSchema,
  getOrderModel,
  buildOrderId,
  ledgerTagOf,
  orderDayOf,
  ORDER_ID_RE,
  ORDER_SCHEMA_VERSION,
} from "./order.ledger";

// F2c §10 / build-rule #6 — the Number→Double landmine. These are STATIC,
// DB-free guards: `.instance === 'Int32'` proves the schema enforces a real BSON
// int32, and the cast tests prove a stray rupee float / over-cap value is REJECTED
// (so paise-only can't silently regress to a Double). The authoritative on-server
// `$type` assertion runs against a seeded M0 in F2 (per F2c §1) — not on this box.

// `SchemaType.defaultValue` exists at runtime but isn't on Mongoose's public TS
// type; read it through a narrow cast.
function defaultOf(schema: mongoose.Schema, path: string): unknown {
  return (schema.path(path) as unknown as { defaultValue?: unknown }).defaultValue;
}

const ORDER_MONEY_PATHS = [
  "subtotal",
  "total",
  "paidAmount",
  "discount",
  "gstAmount",
  "gstRate",
  "splitCash",
  "splitOnline",
  "kotRounds",
  "v",
];
const ITEM_MONEY_PATHS = ["price", "qty", "kotRound"];

test("every Order money/int path is BSON Int32 (not Double)", () => {
  for (const p of ORDER_MONEY_PATHS) {
    assert.equal(orderSchema.path(p).instance, "Int32", `Order.${p} must be Int32`);
  }
  for (const p of ITEM_MONEY_PATHS) {
    assert.equal(orderItemSchema.path(p).instance, "Int32", `item.${p} must be Int32`);
  }
});

test("Int32 paise enforcement rejects rupee floats and over-cap values", () => {
  const Order = getOrderModel(mongoose.createConnection());
  const base = {
    _id: "ORD-A-20260629-001",
    customerName: "Walk-in",
    items: [{ productId: new mongoose.Types.ObjectId(), name: "Coffee", price: 12000, qty: 1 }],
    subtotal: 12000,
    total: 12000,
    paidAmount: 12000,
    payment: "Cash",
    receiver: "Rahul",
  };
  assert.equal(new Order(base).validateSync(), undefined, "integer paise is valid");
  // A non-integer (a rupee value that slipped through) is a CastError, not stored.
  const floatErr = new Order({ ...base, total: 120.5 }).validateSync();
  assert.equal(floatErr?.errors.total?.name, "CastError");
  // Beyond ₹21.4 L/field (int32 max) is rejected.
  const overErr = new Order({ ...base, total: 3_000_000_000 }).validateSync();
  assert.equal(overErr?.errors.total?.name, "CastError");
});

test("identity + refs: _id is String (orderId), customerId/productId are ObjectId", () => {
  assert.equal(orderSchema.path("_id").instance, "String");
  assert.equal(orderSchema.path("customerId").instance, "ObjectId");
  assert.equal(orderItemSchema.path("productId").instance, "ObjectId");
});

test("no createdAt/updatedAt/__v — orderId carries the day, settledAt the exact time (#5)", () => {
  assert.equal(orderSchema.path("createdAt"), undefined);
  assert.equal(orderSchema.path("updatedAt"), undefined);
  assert.equal(orderSchema.path("__v"), undefined); // versionKey:false
  assert.equal(orderSchema.path("settledAt").instance, "Date");
});

test("omit-empty: optionals carry NO default; only status/v default (#8)", () => {
  for (const p of [
    "discount",
    "gstAmount",
    "splitCash",
    "splitOnline",
    "kotRounds",
    "tableNo",
    "notes",
    "customerId",
    "idemKey",
    "source",
    "externalRef",
  ]) {
    assert.equal(
      defaultOf(orderSchema, p),
      undefined,
      `Order.${p} must have no default (omit-empty)`,
    );
  }
  // Array path must not auto-materialize to [] (default:undefined override).
  assert.equal(defaultOf(orderItemSchema, "modifiers"), undefined);
  assert.equal(defaultOf(orderItemSchema, "instructions"), undefined);
  assert.equal(defaultOf(orderItemSchema, "kotRound"), undefined);
  // The two intentional defaults.
  assert.equal(defaultOf(orderSchema, "status"), "Pending");
  assert.equal(defaultOf(orderSchema, "v"), ORDER_SCHEMA_VERSION);
});

test("a minimal order serializes with zero null/zero slots (#8)", () => {
  const Order = getOrderModel(mongoose.createConnection());
  const doc = new Order({
    _id: "ORD-A-20260629-001",
    customerName: "Walk-in",
    items: [{ productId: new mongoose.Types.ObjectId(), name: "Coffee", price: 12000, qty: 1 }],
    subtotal: 12000,
    total: 12000,
    paidAmount: 12000,
    payment: "Cash",
    receiver: "Rahul",
  });
  const obj = doc.toObject();
  for (const absent of ["discount", "gstAmount", "gstRate", "splitCash", "splitOnline", "tableNo", "notes", "customerId", "kotRounds", "idemKey", "source", "externalRef", "settledAt", "frozen"]) {
    assert.ok(!(absent in obj), `${absent} should be omitted on a simple order`);
  }
  assert.ok(!("modifiers" in obj.items[0]), "empty item.modifiers should be omitted");
});

// ── Index set (F2c §5 + build-rule #11; ≤5 incl. the P10-CH exception) ────────

test("the Order index set is exactly the F2c partial set", () => {
  const indexes = orderSchema.indexes(); // [keySpec, options][]
  const byName = new Map(indexes.map(([, opts]) => [opts?.name, { ...opts }]));
  // _id is the free identity index (never declared). Four explicit partials:
  assert.equal(indexes.length, 4, "exactly 4 declared indexes (≤5 incl. _id)");

  const tableNo = indexes.find(([k]) => "tableNo" in k);
  assert.deepEqual(tableNo?.[0], { tableNo: 1 });
  assert.deepEqual(tableNo?.[1]?.partialFilterExpression, { status: "Pending" });
  assert.ok(!tableNo?.[1]?.unique);

  const customerId = indexes.find(([k]) => "customerId" in k);
  assert.deepEqual(customerId?.[0], { customerId: 1 });
  assert.deepEqual(customerId?.[1]?.partialFilterExpression, { customerId: { $exists: true } });

  const idem = byName.get("idemKey_unique_partial");
  assert.equal(idem?.unique, true);
  assert.deepEqual(idem?.partialFilterExpression, { idemKey: { $exists: true } });

  const ext = indexes.find(([k]) => "source" in k && "externalRef" in k);
  assert.deepEqual(ext?.[0], { source: 1, externalRef: 1 });
  assert.equal(ext?.[1]?.unique, true);
  assert.deepEqual(ext?.[1]?.partialFilterExpression, { externalRef: { $exists: true } });
});

test("NO partial filter uses $ne/$exists:false (MongoDB rejects them) — the spec-defect regression guard", () => {
  const json = JSON.stringify(orderSchema.indexes());
  assert.ok(!json.includes("$ne"), "partialFilterExpression must not use $ne");
  assert.ok(!json.includes('"$exists":false'), "partialFilterExpression must not use $exists:false");
});

// ── orderId helpers ───────────────────────────────────────────────────────────

test("orderId build/parse round-trips and the regex pins the format", () => {
  const id = buildOrderId("A2", "20260629", 7);
  assert.equal(id, "ORD-A2-20260629-007");
  assert.ok(ORDER_ID_RE.test(id));
  assert.equal(ledgerTagOf(id), "A2");
  assert.equal(orderDayOf(id), "20260629");
  assert.equal(ledgerTagOf("not-an-order"), null);
  assert.equal(orderDayOf("not-an-order"), null);
  // a 4-digit sequence (busy day past 999) is still valid
  assert.ok(ORDER_ID_RE.test("ORD-A-20260629-1024"));
});

test("getOrderModel is idempotent per connection", () => {
  const conn = mongoose.createConnection();
  assert.equal(getOrderModel(conn), getOrderModel(conn));
});

// ── boundedness (F2 §4 F2.10) ─────────────────────────────────────────────────

test("Order's ONLY unbounded-capable arrays are items[] (append-then-close) + item modifiers — kotRounds is an Int32 COUNTER, not an array", () => {
  // The 300 MB hygiene contract: an Order doc must not grow without bound. The
  // one embedded array, `items`, is append-then-close (frozen at settlement);
  // KOT rounds are counted, never accumulated as an event array (the event
  // stream belongs to the bucketed kotEventLog, F2c §8 — not on the Order).
  const arrayPaths = (schema: mongoose.Schema): string[] => {
    const found: string[] = [];
    schema.eachPath((path, type) => {
      if (type.instance === "Array" || type.instance === "DocumentArray") {
        found.push(path);
      }
    });
    return found;
  };
  assert.deepEqual(arrayPaths(orderSchema), ["items"]);
  assert.deepEqual(arrayPaths(orderItemSchema), ["modifiers"]);
  assert.equal(orderSchema.path("kotRounds").instance, "Int32");
});
