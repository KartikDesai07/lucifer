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
import { moveChargePreview, chargeChangeNote } from "./move-charge-preview";

// ── filter / update shapes ───────────────────────────────────────────────────
// assert.deepEqual on the WHOLE object — that's what a typo in a key or a
// wrong literal (e.g. "" vs undefined) breaks.

test("moveOrderFilter: CAS on the order's status, its current table, AND the money-state terms the other writers use (total/kotRounds/voidGuardFilter)", () => {
  assert.deepEqual(moveOrderFilter("ORD-1", "T-1", { total: 150, kotRounds: 2, voids: [{}] }), {
    _id: "ORD-1",
    status: MOVABLE_ORDER_STATUS,
    tableNo: "T-1",
    total: 150,
    kotRounds: 2,
    voids: { $size: 1 },
  });
});

test("moveOrderFilter: kotRounds/voids default to 0/none when the order carries neither (a fresh one-shot order)", () => {
  assert.deepEqual(moveOrderFilter("ORD-1", "T-1", { total: 100 }), {
    _id: "ORD-1",
    status: MOVABLE_ORDER_STATUS,
    tableNo: "T-1",
    total: 100,
    kotRounds: 0,
    $or: [{ voids: { $exists: false } }, { voids: { $size: 0 } }],
  });
});

// ── CB-CHG's ASSIGN verb — the absent-field CAS ──────────────────────────────
// moveOrderFilter(id, undefined, order) is what the route sends when a tab has
// NO table yet (order.tableNo is undefined — omit-empty discipline, never ""
// or null). If this emitted the bare literal `tableNo: undefined`, Mongoose/
// the Mongo driver drops the key entirely and the CAS would match ANY table —
// a racing seat/move on a DIFFERENT table would be silently clobbered. It must
// instead emit an explicit `{ $in: [null, ""] }` so an absent field is matched
// on purpose, not by the key vanishing.

test("moveOrderFilter: an undefined fromTableNo (the ASSIGN verb — a tab with NO table) emits the explicit absent-field CAS, never a dropped key", () => {
  assert.deepEqual(moveOrderFilter("ORD-1", undefined, { total: 100 }), {
    _id: "ORD-1",
    status: MOVABLE_ORDER_STATUS,
    tableNo: { $in: [null, ""] },
    total: 100,
    kotRounds: 0,
    $or: [{ voids: { $exists: false } }, { voids: { $size: 0 } }],
  });
});

test("moveOrderFilter: a real string fromTableNo still emits that EXACT string (not the absent-field form) — the two verbs' filters must never blur together", () => {
  const filter = moveOrderFilter("ORD-1", "T-3", { total: 100 });
  assert.equal(filter.tableNo, "T-3");
  assert.notDeepEqual(filter.tableNo, { $in: [null, ""] });
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

// ── moveChargePreview / chargeChangeNote — the ASSIGN/UNSEAT money preview ──
// Uses the REAL helpers (chargesFromOrder/withTableCharge/chargesTotal via
// move-charge-preview.ts), never a re-implementation — the whole point being
// that client and server can never disagree about which entry changes.

test("moveChargePreview: UNSEAT (destination null) DROPS the table charge and keeps every extra charge, total reflects only the table entry leaving", () => {
  const seatedOrder = {
    total: 250,
    charges: [
      { type: "table" as const, label: "Rooftop", amount: 50 },
      { type: "extra" as const, label: "Takeaway", amount: 30 },
    ],
  };
  const preview = moveChargePreview(seatedOrder, null);
  assert.equal(preview.total, 200, "total must drop by exactly the table charge (250 - 50)");
  assert.equal(preview.from?.amount, 50);
  assert.equal(preview.from?.label, "Rooftop");
  assert.equal(preview.to, undefined, "no table entry survives an unseat");
});

test("moveChargePreview: ASSIGN (a walk-in tab with NO table charge moved onto a charged table) ADDS the destination's charge", () => {
  const walkInOrder = { total: 100, charges: [] as { type: "table" | "extra"; label: string; amount: number }[] };
  const chargedTable = { chargeAmount: 40, chargeLabel: "Garden" };
  const preview = moveChargePreview(walkInOrder, chargedTable);
  assert.equal(preview.total, 140, "total must rise by exactly the destination's configured charge");
  assert.equal(preview.from, undefined, "the walk-in tab carried no table entry before");
  assert.equal(preview.to?.amount, 40);
  assert.equal(preview.to?.label, "Garden");
});

test("chargeChangeNote: neither side carries a table charge — returns null so no '₹0' line is ever shown", () => {
  assert.equal(chargeChangeNote(undefined, undefined), null);
});

test("chargeChangeNote: returns a non-null sentence for an add, a remove, and an unchanged-amount replace", () => {
  const rooftop = { type: "table" as const, label: "Rooftop", amount: 50 };
  const garden = { type: "table" as const, label: "Garden", amount: 50 };
  assert.notEqual(chargeChangeNote(undefined, rooftop), null, "adding a charge must produce a sentence");
  assert.notEqual(chargeChangeNote(rooftop, undefined), null, "removing a charge must produce a sentence");
  assert.notEqual(chargeChangeNote(rooftop, garden), null, "replacing the table entry must produce a sentence");
});

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
