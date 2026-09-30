import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bulkProductsSchema,
  isStaffBulkAction,
  PRODUCT_BULK_ACTIONS,
  STAFF_PRODUCT_BULK_ACTIONS,
} from "./product-bulk.schema";
import { PRODUCT_BULK_MAX } from "../constants";

// Menu redesign (owner, 2026-09-30) — the Items page bulk bar. Pure Zod-level
// contract; the route's own role gate + updateMany filters are pinned in
// apps/cafe/lib/product-bulk.test.ts and lib/menu-access-pins.test.ts.

const ID1 = "64f000000000000000000001";
const ID2 = "64f000000000000000000002";
const CATEGORY_ID = "64f0000000000000000000c1";

// ── each branch parses with a plain, correct payload ────────────────────────

test("bulkProductsSchema: out-of-stock/in-stock/archive/restore each accept {action, ids}", () => {
  for (const action of ["out-of-stock", "in-stock", "archive", "restore"] as const) {
    const r = bulkProductsSchema.safeParse({ action, ids: [ID1, ID2] });
    assert.equal(r.success, true, `${action} must parse with a plain ids array`);
  }
});

test("bulkProductsSchema: move accepts {action:'move', ids, categoryId}", () => {
  const r = bulkProductsSchema.safeParse({ action: "move", ids: [ID1], categoryId: CATEGORY_ID });
  assert.equal(r.success, true);
});

test("bulkProductsSchema: move without categoryId is rejected", () => {
  const r = bulkProductsSchema.safeParse({ action: "move", ids: [ID1] });
  assert.equal(r.success, false);
});

test("bulkProductsSchema: move with a malformed categoryId is a 400-shaped Zod error, never a cast crash", () => {
  const r = bulkProductsSchema.safeParse({ action: "move", ids: [ID1], categoryId: "not-an-id" });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(r.error.issues.some((i) => i.path.includes("categoryId")));
  }
});

// ── strict: extra keys rejected per branch ──────────────────────────────────

test("bulkProductsSchema: an out-of-stock payload carrying an extra key (e.g. categoryId) is rejected — each branch is .strict()", () => {
  const r = bulkProductsSchema.safeParse({ action: "out-of-stock", ids: [ID1], categoryId: CATEGORY_ID });
  assert.equal(r.success, false);
});

test("bulkProductsSchema: a move payload carrying an unrelated extra key is rejected", () => {
  const r = bulkProductsSchema.safeParse({ action: "move", ids: [ID1], categoryId: CATEGORY_ID, extra: true });
  assert.equal(r.success, false);
});

// ── ids: min, max cap, duplicate refine (on the ARRAY, error path 'ids') ────

test("bulkProductsSchema: an empty ids array is rejected (min 1)", () => {
  const r = bulkProductsSchema.safeParse({ action: "archive", ids: [] });
  assert.equal(r.success, false);
});

test(`bulkProductsSchema: exactly PRODUCT_BULK_MAX (${PRODUCT_BULK_MAX}) ids parses; one more is rejected`, () => {
  const atMax = Array.from({ length: PRODUCT_BULK_MAX }, (_, i) => i.toString(16).padStart(24, "0"));
  assert.equal(bulkProductsSchema.safeParse({ action: "archive", ids: atMax }).success, true);

  const overMax = [...atMax, "f".repeat(24)];
  assert.equal(bulkProductsSchema.safeParse({ action: "archive", ids: overMax }).success, false);
});

test("bulkProductsSchema: a duplicate id in the array is rejected, with the error path on 'ids'", () => {
  const r = bulkProductsSchema.safeParse({ action: "archive", ids: [ID1, ID1] });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(r.error.issues.some((i) => i.path[0] === "ids"), "the duplicate-id error must be reported on the ids path");
  }
});

test("bulkProductsSchema: a malformed id in the array (not 24-hex) is rejected", () => {
  const r = bulkProductsSchema.safeParse({ action: "archive", ids: ["not-an-id"] });
  assert.equal(r.success, false);
});

// ── unknown action ───────────────────────────────────────────────────────────

test("bulkProductsSchema: an unknown action is rejected", () => {
  const r = bulkProductsSchema.safeParse({ action: "delete-forever", ids: [ID1] });
  assert.equal(r.success, false);
});

// ── isStaffBulkAction ─────────────────────────────────────────────────────────

test("isStaffBulkAction: true only for out-of-stock and in-stock", () => {
  for (const action of PRODUCT_BULK_ACTIONS) {
    assert.equal(
      isStaffBulkAction(action),
      (STAFF_PRODUCT_BULK_ACTIONS as readonly string[]).includes(action),
      `isStaffBulkAction("${action}") must match STAFF_PRODUCT_BULK_ACTIONS membership`,
    );
  }
  assert.equal(isStaffBulkAction("move"), false);
  assert.equal(isStaffBulkAction("archive"), false);
  assert.equal(isStaffBulkAction("restore"), false);
  assert.equal(isStaffBulkAction("out-of-stock"), true);
  assert.equal(isStaffBulkAction("in-stock"), true);
});
