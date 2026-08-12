import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose, { Schema } from "mongoose";

import {
  dailyRollupSchema,
  productDayCounterSchema,
  getDailyRollupModel,
  getProductDayCounterModel,
  buildProductDayCounterId,
  DAY_KEY_RE,
  PRODUCT_DAY_COUNTER_ID_RE,
  DAILY_ROLLUP_COLLECTION,
  PRODUCT_DAY_COUNTER_COLLECTION,
  DAILY_ROLLUP_SCHEMA_VERSION,
} from "./daily-rollup.ledger";
import { assertSchemaTtlAllowed } from "@/lib/ttl-guard";

// F2 Step F2.10 — static DB-free guards for the LEDGER computed collections
// (the order.ledger.test regime): Int32 on every money/int path, pinned
// canonical collection names, the `_id`-only index austerity, omit-empty, and
// the TTL-FORBIDDEN rule (#23). The live round-trip runs against a seeded M0
// in F2's integration pass.

test("canonical collection names are pinned EXACTLY (F2c §4 — never pluralized/renamed)", () => {
  assert.equal(DAILY_ROLLUP_COLLECTION, "dailyRollup");
  assert.equal(PRODUCT_DAY_COUNTER_COLLECTION, "productDayCounter");
  assert.equal(dailyRollupSchema.get("collection"), "dailyRollup");
  assert.equal(productDayCounterSchema.get("collection"), "productDayCounter");
  // The fan-out targets the same strings — a rename here would silently fork
  // the read from the write.
});

test("every rollup money/int path is BSON Int32 — incl. the SIGNED netting fields (#6/#38)", () => {
  for (const p of ["orders", "gross", "discount", "compTotal", "v"]) {
    assert.equal(dailyRollupSchema.path(p).instance, "Int32", `dailyRollup.${p}`);
  }
  const payments = dailyRollupSchema.path("payments") as unknown as {
    schema: Schema;
  };
  for (const p of ["amount", "orders"]) {
    assert.equal(payments.schema.path(p).instance, "Int32", `payments.${p}`);
  }
  const tax = dailyRollupSchema.path("taxBuckets") as unknown as { schema: Schema };
  for (const p of ["rate", "taxable", "gst"]) {
    assert.equal(tax.schema.path(p).instance, "Int32", `taxBuckets.${p}`);
  }
  for (const p of ["sold", "revenue", "v"]) {
    assert.equal(productDayCounterSchema.path(p).instance, "Int32", `counter.${p}`);
  }
});

test("_id is the day/prodId-day String key; no createdAt/updatedAt/__v", () => {
  assert.equal(dailyRollupSchema.path("_id").instance, "String");
  assert.equal(productDayCounterSchema.path("_id").instance, "String");
  for (const s of [dailyRollupSchema, productDayCounterSchema] as Schema[]) {
    assert.equal(s.path("createdAt"), undefined);
    assert.equal(s.path("updatedAt"), undefined);
    assert.equal(s.get("versionKey"), false);
  }
});

test("NO index beyond _id (F2c §5 austerity) and NO TTL anywhere (#23)", () => {
  assert.deepEqual(dailyRollupSchema.indexes(), []);
  assert.deepEqual(productDayCounterSchema.indexes(), []);
  // The module already self-asserts at load; prove the guard would catch a
  // future TTL on a financial collection: a clone with one throws.
  const rogue = dailyRollupSchema.clone();
  rogue.index({ someDate: 1 }, { expireAfterSeconds: 3600 });
  assert.throws(() => assertSchemaTtlAllowed("DailyRollup", rogue), /FORBIDDEN[\s\S]*#23/);
});

test("omit-empty (#8): optionals carry no default; arrays don't materialize as []", () => {
  const Rollup = getDailyRollupModel(mongoose.createConnection());
  const doc = new Rollup({ _id: "20260705", orders: 0, gross: 0 });
  const obj = doc.toObject();
  assert.equal(obj.discount, undefined);
  assert.equal(obj.compTotal, undefined);
  assert.equal(obj.payments, undefined, "payments must not materialize as []");
  assert.equal(obj.taxBuckets, undefined, "taxBuckets must not materialize as []");
  assert.equal(obj.v, DAILY_ROLLUP_SCHEMA_VERSION, "v defaults to the current version");
});

test("SIGNED netting values cast; floats are rejected (CastError)", () => {
  const Rollup = getDailyRollupModel(mongoose.createConnection());
  const negated = new Rollup({
    _id: "20260705",
    orders: 2,
    gross: -45000, // a refund-heavy day nets negative — legal
    payments: [{ mode: "Cash", amount: -45000, orders: 1 }],
    taxBuckets: [{ rate: 5, taxable: -42858, gst: -2142 }],
  });
  assert.equal(negated.validateSync(), undefined, "signed netting must validate");

  const floatErr = new Rollup({ _id: "20260705", orders: 1, gross: 120.5 }).validateSync();
  assert.equal(floatErr?.errors.gross?.name, "CastError", "rupee float must be rejected");

  const Counter = getProductDayCounterModel(mongoose.createConnection());
  const counterErr = new Counter({
    _id: buildProductDayCounterId("a".repeat(24), "20260705"),
    sold: 1,
    revenue: 99.99,
  }).validateSync();
  assert.equal(counterErr?.errors.revenue?.name, "CastError");
});

test("payments.mode is enum-bound to PAYMENT_MODES", () => {
  const Rollup = getDailyRollupModel(mongoose.createConnection());
  const bad = new Rollup({
    _id: "20260705",
    orders: 1,
    gross: 100,
    payments: [{ mode: "Barter", amount: 100, orders: 1 }],
  }).validateSync();
  assert.ok(bad, "an unknown payment mode must fail validation");
});

test("id helpers: day key + counter id round-trip", () => {
  assert.ok(DAY_KEY_RE.test("20260705"));
  assert.ok(!DAY_KEY_RE.test("2026-07-05"));
  const pid = new mongoose.Types.ObjectId().toHexString();
  const id = buildProductDayCounterId(pid, "20260705");
  const m = PRODUCT_DAY_COUNTER_ID_RE.exec(id);
  assert.ok(m, "built id must match the canonical shape");
  assert.equal(m[1], pid);
  assert.equal(m[2], "20260705");
});

test("accessors are idempotent per connection (#21) and never touch the default connection", () => {
  const conn = mongoose.createConnection();
  const a = getDailyRollupModel(conn);
  const b = getDailyRollupModel(conn);
  assert.equal(a, b, "second call must reuse the compiled model");
  const c = getProductDayCounterModel(conn);
  const d = getProductDayCounterModel(conn);
  assert.equal(c, d);
  assert.equal(
    mongoose.models.DailyRollup,
    undefined,
    "importing/binding must not register on the global mongoose connection",
  );
});
