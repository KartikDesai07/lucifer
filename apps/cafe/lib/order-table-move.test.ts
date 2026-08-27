import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_NOT_LIVE_ERROR,
  ORDER_NO_TABLE_ERROR,
  SAME_TABLE_ERROR,
  TABLE_TAKEN_ERROR,
  TABLE_RESERVED_ERROR,
  ORDER_STALE_ERROR,
  MOVABLE_ORDER_STATUS,
  tableUnavailableReason,
  moveOrderFilter,
  claimTableFilter,
  occupyUpdate,
  RELEASE_UPDATE,
} from "./order-table-move";

// ── filter / update shapes ───────────────────────────────────────────────────
// assert.deepEqual on the WHOLE object — that's what a typo in a key or a
// wrong literal (e.g. "" vs undefined) breaks.

test("moveOrderFilter: CAS on both the order's status AND its current table", () => {
  assert.deepEqual(moveOrderFilter("ORD-1", "T-1"), {
    _id: "ORD-1",
    status: MOVABLE_ORDER_STATUS,
    tableNo: "T-1",
  });
});

test("claimTableFilter: the destination's name plus the free-table filter", () => {
  assert.deepEqual(claimTableFilter("T-2"), {
    tableNo: "T-2",
    status: "Available",
    currentOrderId: { $in: [null, ""] },
  });
});

test("occupyUpdate: exact shape, carries the order id verbatim", () => {
  assert.deepEqual(occupyUpdate("ORD-1"), {
    status: "Occupied",
    currentOrderId: "ORD-1",
  });
});

test("RELEASE_UPDATE: exact shape", () => {
  assert.deepEqual(RELEASE_UPDATE, { status: "Available", currentOrderId: "" });
});

// ── tableUnavailableReason ───────────────────────────────────────────────────

test("tableUnavailableReason: a genuinely free table → null", () => {
  assert.equal(tableUnavailableReason({ status: "Available" }, "ORD-1"), null);
});

test("tableUnavailableReason: Available with currentOrderId==='' (freed) → null", () => {
  assert.equal(
    tableUnavailableReason({ status: "Available", currentOrderId: "" }, "ORD-1"),
    null,
  );
});

test("tableUnavailableReason: already held by THIS order (retry) → null", () => {
  assert.equal(
    tableUnavailableReason({ status: "Occupied", currentOrderId: "ORD-1" }, "ORD-1"),
    null,
  );
});

test("tableUnavailableReason: held by ANOTHER order → TABLE_TAKEN_ERROR", () => {
  assert.equal(
    tableUnavailableReason({ status: "Occupied", currentOrderId: "ORD-2" }, "ORD-1"),
    TABLE_TAKEN_ERROR,
  );
});

test("tableUnavailableReason: Reserved with no pointer → TABLE_RESERVED_ERROR", () => {
  assert.equal(tableUnavailableReason({ status: "Reserved" }, "ORD-1"), TABLE_RESERVED_ERROR);
});

test("tableUnavailableReason: Occupied with no pointer → TABLE_TAKEN_ERROR", () => {
  assert.equal(tableUnavailableReason({ status: "Occupied" }, "ORD-1"), TABLE_TAKEN_ERROR);
});

// ── error message constants ──────────────────────────────────────────────────

test("error message constants: all non-empty and mutually distinct — a copy-paste that makes two reasons identical must fail", () => {
  const messages = [
    ORDER_NOT_LIVE_ERROR,
    ORDER_NO_TABLE_ERROR,
    SAME_TABLE_ERROR,
    TABLE_TAKEN_ERROR,
    TABLE_RESERVED_ERROR,
    ORDER_STALE_ERROR,
  ];
  for (const message of messages) {
    assert.equal(typeof message, "string");
    assert.ok(message.length > 0, "message must not be empty");
  }
  assert.equal(new Set(messages).size, messages.length, "all messages must be distinct");
});
