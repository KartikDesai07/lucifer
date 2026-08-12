import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FREE_TABLE_FILTER,
  isTableFree,
  TABLE_BUSY_ERROR,
  TABLE_CLAIMED_ERROR,
  TABLE_DUPLICATE_ERROR,
  TABLE_NOT_FOUND_ERROR,
  freeTableFilter,
  unknownTableMessage,
} from "./table-admin";

// checkTableExists is NOT tested here — it calls Table.exists() and needs a real
// DB connection (DB-free rule); its behavior is exercised by the route-level /
// integration coverage instead.

// ── isTableFree ──────────────────────────────────────────────────────────────

test("isTableFree: true for Available with no currentOrderId at all (seeded table)", () => {
  assert.equal(isTableFree({ status: "Available" }), true);
});

test("isTableFree: true for Available with currentOrderId === '' (freed table)", () => {
  assert.equal(isTableFree({ status: "Available", currentOrderId: "" }), true);
});

test("isTableFree: false for Occupied, even with no currentOrderId set", () => {
  assert.equal(isTableFree({ status: "Occupied" }), false);
});

test("isTableFree: false for Reserved, even with no currentOrderId set", () => {
  assert.equal(isTableFree({ status: "Reserved" }), false);
});

test("isTableFree: false for Available but still pointing at an order — the stale-claim case that would otherwise let an admin delete/rename a table out from under a live tab", () => {
  assert.equal(isTableFree({ status: "Available", currentOrderId: "order-123" }), false);
});

// ── FREE_TABLE_FILTER ────────────────────────────────────────────────────────

test("FREE_TABLE_FILTER: exact shape — status Available AND currentOrderId matches BOTH null and '' (seeded tables have the field unset/null, freed tables have it set to ''; a plain equality would miss one of the two so $in is required)", () => {
  assert.deepEqual(FREE_TABLE_FILTER, {
    status: "Available",
    currentOrderId: { $in: [null, ""] },
  });
});

// ── unknownTableMessage ──────────────────────────────────────────────────────

test("unknownTableMessage: includes the offending table name", () => {
  assert.match(unknownTableMessage("T-99"), /T-99/);
  assert.equal(unknownTableMessage("T-99"), 'Table "T-99" is not on the floor plan');
});

// ── error message constants ──────────────────────────────────────────────────

test("error message constants: all non-empty and mutually distinct", () => {
  const messages = [
    TABLE_BUSY_ERROR,
    TABLE_DUPLICATE_ERROR,
    TABLE_NOT_FOUND_ERROR,
    TABLE_CLAIMED_ERROR,
  ];
  for (const message of messages) {
    assert.equal(typeof message, "string");
    assert.ok(message.length > 0, "message must not be empty");
  }
  assert.equal(new Set(messages).size, messages.length, "all four messages must be distinct");
});

// ── freeTableFilter (CR1.5 Slice 2 — PUT /api/tables/[tableNo]) ──────────────

test("freeTableFilter: omits currentOrderId entirely when no order is expected", () => {
  assert.deepEqual(freeTableFilter("T-1"), { tableNo: "T-1" });
  assert.deepEqual(freeTableFilter("T-1", undefined), { tableNo: "T-1" });
});

test("freeTableFilter: includes currentOrderId VERBATIM when an order is expected — a blind free (omitting this) is the CR1-audit bug that let a second order's occupancy be silently wiped", () => {
  assert.deepEqual(freeTableFilter("T-1", "ORD-A-20260811-001"), {
    tableNo: "T-1",
    currentOrderId: "ORD-A-20260811-001",
  });
});
