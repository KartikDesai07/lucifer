import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createPublicOrderRequestSchema,
  publicOrderTargetSchema,
  publicOrderItemSchema,
} from "./public-order.schema";
import { PUBLIC_TOKEN_ALPHABET, PUBLIC_TOKEN_LENGTH } from "../public";

// CR2 — the public (diner-facing, unauthenticated) order request. These pin
// the two things this surface must never get wrong: a client-sent price/name
// overriding the server-derived ones, and a malformed target routing to the
// wrong table.

const VALID_TOKEN = PUBLIC_TOKEN_ALPHABET.slice(0, PUBLIC_TOKEN_LENGTH);

function validItem() {
  return { productId: "prod-1", qty: 1 };
}

function validRequest() {
  return {
    target: { kind: "parcel" as const },
    items: [validItem()],
    name: "Asha",
    mobile: "9876543210",
  };
}

// ── item: no price, no name — the server derives both ──────────────────────

test("publicOrderItemSchema rejects an extra `price` key — the server derives price, a client must never set it", () => {
  const r = publicOrderItemSchema.safeParse({ ...validItem(), price: 100 });
  assert.equal(r.success, false);
});

test("publicOrderItemSchema rejects an extra `name` key — the server derives name from the live product", () => {
  const r = publicOrderItemSchema.safeParse({ ...validItem(), name: "Pizza" });
  assert.equal(r.success, false);
});

test("publicOrderItemSchema rejects an extra `tableNo` key — table identity comes only from the request target", () => {
  const r = publicOrderItemSchema.safeParse({ ...validItem(), tableNo: "T-1" });
  assert.equal(r.success, false);
});

test("publicOrderItemSchema enforces the qty cap", () => {
  assert.equal(publicOrderItemSchema.safeParse({ ...validItem(), qty: 20 }).success, true);
  assert.equal(publicOrderItemSchema.safeParse({ ...validItem(), qty: 21 }).success, false);
  assert.equal(publicOrderItemSchema.safeParse({ ...validItem(), qty: 0 }).success, false);
});

// ── target union ─────────────────────────────────────────────────────────

test("publicOrderTargetSchema rejects a table target with no token", () => {
  const r = publicOrderTargetSchema.safeParse({ kind: "table" });
  assert.equal(r.success, false);
});

test("publicOrderTargetSchema rejects a token that fails the 14-char pattern", () => {
  const r = publicOrderTargetSchema.safeParse({ kind: "table", token: "SHORT" });
  assert.equal(r.success, false);
});

test("publicOrderTargetSchema accepts a valid 14-char token minted from the token alphabet", () => {
  const r = publicOrderTargetSchema.safeParse({ kind: "table", token: VALID_TOKEN });
  assert.equal(r.success, true);
});

test("publicOrderTargetSchema accepts a parcel target with exactly {kind:\"parcel\"} and no other keys", () => {
  assert.equal(publicOrderTargetSchema.safeParse({ kind: "parcel" }).success, true);
  assert.equal(
    publicOrderTargetSchema.safeParse({ kind: "parcel", token: VALID_TOKEN }).success,
    false,
    "a parcel target must reject a stray token — .strict() on that union member",
  );
});

// ── full request: items cap, honeypot, mobile ───────────────────────────────

test("createPublicOrderRequestSchema enforces the items cap", () => {
  const okItems = Array.from({ length: 30 }, () => validItem());
  assert.equal(
    createPublicOrderRequestSchema.safeParse({ ...validRequest(), items: okItems }).success,
    true,
  );
  const tooMany = Array.from({ length: 31 }, () => validItem());
  assert.equal(
    createPublicOrderRequestSchema.safeParse({ ...validRequest(), items: tooMany }).success,
    false,
  );
});

test("createPublicOrderRequestSchema: mobile rejects letters and a too-short number", () => {
  assert.equal(
    createPublicOrderRequestSchema.safeParse({ ...validRequest(), mobile: "abcdefghij" }).success,
    false,
  );
  assert.equal(
    createPublicOrderRequestSchema.safeParse({ ...validRequest(), mobile: "12345" }).success,
    false,
  );
});

test("createPublicOrderRequestSchema: mobile normalizes spaces and hyphens — \"98765 43210\" and \"9876-543210\" both store as \"9876543210\", matching plain \"9876543210\"", () => {
  const spaced = createPublicOrderRequestSchema.safeParse({ ...validRequest(), mobile: "98765 43210" });
  const hyphenated = createPublicOrderRequestSchema.safeParse({ ...validRequest(), mobile: "9876-543210" });
  const plain = createPublicOrderRequestSchema.safeParse({ ...validRequest(), mobile: "9876543210" });
  assert.equal(spaced.success, true);
  assert.equal(hyphenated.success, true);
  assert.equal(plain.success, true);
  if (spaced.success && hyphenated.success && plain.success) {
    assert.equal(spaced.data.mobile, "9876543210");
    assert.equal(hyphenated.data.mobile, "9876543210");
    assert.equal(plain.data.mobile, "9876543210");
  }
});

test("createPublicOrderRequestSchema: mobile rejects a value that normalizes BELOW the minimum length even though the raw string passes shape/pattern checks (\"1---------\" -> \"1\")", () => {
  const r = createPublicOrderRequestSchema.safeParse({ ...validRequest(), mobile: "1---------" });
  assert.equal(r.success, false);
});

test("createPublicOrderRequestSchema: a spaced 10-digit mobile that still normalizes to a full 10 digits is accepted", () => {
  const r = createPublicOrderRequestSchema.safeParse({ ...validRequest(), mobile: "98 76 54 32 10" });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.mobile, "9876543210");
});

test("createPublicOrderRequestSchema: a `hp` key on the body is rejected — the schema no longer knows about it, so it must fail .strict() like any other unknown key (the route strips it before this ever runs)", () => {
  const r = createPublicOrderRequestSchema.safeParse({ ...validRequest(), hp: "" });
  assert.equal(r.success, false);
});

test("createPublicOrderRequestSchema accepts a well-formed parcel order", () => {
  const r = createPublicOrderRequestSchema.safeParse(validRequest());
  assert.equal(r.success, true);
});
