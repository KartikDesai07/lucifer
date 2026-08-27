import { test } from "node:test";
import assert from "node:assert/strict";

import { orderRequestSchema, OrderRequest } from "../models/OrderRequest";
import { Order } from "../models/Order";
import { promoRedemptionSchema, PromoRedemption } from "../models/PromoRedemption";
import { assertSchemaTtlAllowed } from "./ttl-guard";

// models/Order.ts does not export its schema separately (the v1 default-bound
// model, unchanged by this slice's instructions) — the compiled `Order` model
// exposes the same Schema instance via `.schema`, so the index/path
// assertions below read it that way instead.
const orderSchema = Order.schema;

// CR2.2 Slice 2 — DB-free schema/index shape tests for OrderRequest and the
// Order-side idempotency fence (sourceRequestIds). No DB connection: every
// assertion reads the compiled schema's declared indexes/paths/enums, or
// validates a plain (unsaved) document instance.

test("OrderRequest: schema.indexes() carries {status:1, createdAt:-1}", () => {
  const indexes = orderRequestSchema.indexes();
  const hasTrayIndex = indexes.some(
    ([key]: [Record<string, unknown>, unknown]) =>
      key.status === 1 && key.createdAt === -1,
  );
  assert.ok(hasTrayIndex, "expected a {status:1, createdAt:-1} index");
});

test("OrderRequest: shortCode path is required and unique", () => {
  const path = orderRequestSchema.path("shortCode");
  assert.ok(path, "shortCode path must exist");
  const options = (path as unknown as { options: Record<string, unknown> }).options;
  assert.equal(options.unique, true);
  assert.equal(options.required, true);
});

test("OrderRequest: status enum rejects an unknown value", () => {
  const doc = new OrderRequest({
    shortCode: "ABCDEFGHJK",
    status: "not-a-real-status",
    targetKind: "parcel",
    items: [{ productId: "p1", name: "Tea", price: 20, qty: 1, modifiers: [], instructions: "" }],
    quotedSubtotal: 20,
    quotedCharge: 0,
    quotedTotal: 20,
    mobile: "9999999999",
    name: "Diner",
  });
  const err = doc.validateSync();
  assert.ok(err, "expected a validation error for an unknown status");
  assert.ok(err?.errors.status, "expected the error to be on the status path");
});

test("Order: schema.indexes() carries a unique+sparse index on sourceRequestIds", () => {
  const indexes = orderSchema.indexes();
  const match = indexes.find(([key]) => key.sourceRequestIds === 1);
  assert.ok(match, "expected a sourceRequestIds:1 index");
  const [, options] = match as [Record<string, unknown>, Record<string, unknown>];
  assert.equal(options.unique, true);
  assert.equal(options.sparse, true);
});

test("Order: sourceRequestIds has NO default — a minimal doc leaves it undefined, not []", () => {
  const doc = new Order({
    orderId: "ORD-20260819-001",
    customerName: "Walk-in",
    items: [{ productId: "p1", name: "Tea", price: 20, qty: 1, modifiers: [], instructions: "" }],
    subtotal: 20,
    total: 20,
    paidAmount: 20,
    payment: "Cash",
    receiver: "Staff",
  });
  assert.equal(doc.sourceRequestIds, undefined);
});

// This model is never walked by the registry's module-load TTL sweep (it is
// deliberately not federated — see the file's header comment), so this test
// pins the guard directly instead of relying on that sweep to catch a future
// TTL mistake here.
test("assertSchemaTtlAllowed(OrderRequest) does not throw", () => {
  assert.doesNotThrow(() => assertSchemaTtlAllowed("OrderRequest", orderRequestSchema));
});

test("OrderRequest: optional resolution fields are absent on a minimal valid doc (omit-empty)", () => {
  const doc = new OrderRequest({
    shortCode: "ABCDEFGHJK",
    targetKind: "table",
    tableNo: "T-1",
    items: [{ productId: "p1", name: "Tea", price: 20, qty: 1, modifiers: [], instructions: "" }],
    quotedSubtotal: 20,
    quotedCharge: 0,
    quotedTotal: 20,
    mobile: "9999999999",
    name: "Diner",
  });
  assert.equal(doc.acceptedOrderId, undefined);
  assert.equal(doc.acceptedAt, undefined);
  assert.equal(doc.rejectedReason, undefined);
  assert.equal(doc.actor, undefined);
  assert.equal(doc.status, "pending"); // the one real default
});

test("OrderRequest: targetKind enum rejects an unknown value", () => {
  const doc = new OrderRequest({
    shortCode: "ABCDEFGHJK",
    targetKind: "delivery",
    items: [{ productId: "p1", name: "Tea", price: 20, qty: 1, modifiers: [], instructions: "" }],
    quotedSubtotal: 20,
    quotedCharge: 0,
    quotedTotal: 20,
    mobile: "9999999999",
    name: "Diner",
  });
  const err = doc.validateSync();
  assert.ok(err, "expected a validation error for an unknown targetKind");
  assert.ok(err?.errors.targetKind, "expected the error to be on the targetKind path");
});

// ── SPEC P4 — models/PromoRedemption.ts (the once-per-customer fence) ──────

test("PromoRedemption: schema.indexes() carries a UNIQUE compound index {code:1, mobile:1} — this IS the enforcement fence, not a courtesy", () => {
  const indexes = promoRedemptionSchema.indexes();
  const match = indexes.find(([key]: [Record<string, unknown>, unknown]) => key.code === 1 && key.mobile === 1);
  assert.ok(match, "expected a {code:1, mobile:1} index");
  const [, options] = match as [Record<string, unknown>, Record<string, unknown>];
  assert.equal(options.unique, true);
});

test("PromoRedemption: no TTL anywhere on the schema — a redemption is durable usage history, never expires", () => {
  const indexes = promoRedemptionSchema.indexes();
  for (const [, options] of indexes) {
    assert.equal((options as Record<string, unknown>).expireAfterSeconds, undefined);
  }
  // Not federated (mirrors OrderRequest), so pinned directly like it is above.
  assert.doesNotThrow(() => assertSchemaTtlAllowed("PromoRedemption", promoRedemptionSchema));
});

test("PromoRedemption: code/mobile/requestId are required; orderId is absent on a minimal doc (omit-empty)", () => {
  const doc = new PromoRedemption({ code: "SAVE10", mobile: "9999999999", requestId: "req-1" });
  const err = doc.validateSync();
  assert.equal(err, undefined, "a minimal doc must validate cleanly");
  assert.equal(doc.orderId, undefined);
});

test("PromoRedemption: a doc missing code/mobile/requestId fails validation on those exact paths", () => {
  const doc = new PromoRedemption({});
  const err = doc.validateSync();
  assert.ok(err, "expected a validation error");
  assert.ok(err?.errors.code, "expected the error to cover code");
  assert.ok(err?.errors.mobile, "expected the error to cover mobile");
  assert.ok(err?.errors.requestId, "expected the error to cover requestId");
});
