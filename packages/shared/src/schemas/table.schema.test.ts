import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tableNoSchema,
  createTableSchema,
  patchTableSchema,
  updateTableSchema,
} from "./table.schema";
import { createOrderSchema, updateOrderSchema } from "./order.schema";
import { createReservationSchema } from "./reservation.schema";
import { TABLE_NO_MAX_LEN } from "../constants";

// CR1.1 — tables are DATA, not a compile-time enum. These pin the shape contract
// that replaced z.enum(TABLE_NUMBERS): a tableNo is any short, URL-safe label, and
// whether it actually exists is a live DB lookup in the route layer.

const BACKSLASH = String.fromCharCode(92);

test("tableNoSchema accepts a cafe's own free-text table names", () => {
  for (const name of ["T-1", "Patio 1", "Rooftop_2", "AC3", "Bar 12"]) {
    const r = tableNoSchema.safeParse(name);
    assert.equal(r.success, true, `${name} should be accepted`);
  }
});

test("tableNoSchema trims before validating, so padding never reaches the DB", () => {
  const r = tableNoSchema.safeParse("  T-1  ");
  assert.equal(r.success, true);
  assert.equal(r.success && r.data, "T-1");
});

// The tableNo is a URL path segment (/api/tables/[tableNo]). A name carrying a
// slash would split into extra segments and route to nothing, so the charset —
// not just the length — is load-bearing.
test("tableNoSchema rejects anything unsafe in a URL path segment", () => {
  const unsafe = [
    "A/B",
    `A${BACKSLASH}B`,
    "../etc",
    "A%2FB",
    "T\n1",
    "",
    "   ",
    "-leading",
    " ",
    "x".repeat(TABLE_NO_MAX_LEN + 1),
  ];
  for (const name of unsafe) {
    assert.equal(
      tableNoSchema.safeParse(name).success,
      false,
      `${JSON.stringify(name)} must be rejected`,
    );
  }
});

test("tableNoSchema allows exactly TABLE_NO_MAX_LEN characters", () => {
  assert.equal(tableNoSchema.safeParse("x".repeat(TABLE_NO_MAX_LEN)).success, true);
  assert.equal(tableNoSchema.safeParse("x".repeat(TABLE_NO_MAX_LEN + 1)).success, false);
});

// UI sentinels ("no table" / "all tables") share a namespace with real table names
// now that names are free text. They are made collision-proof by starting with an
// underscore, which this charset can never produce — if that ever changes, a cafe
// could name a table the sentinel and silently lose the selection.
test("a leading underscore is unnameable, so UI sentinels can never collide", () => {
  for (const sentinel of ["__all__", "__unassigned__", "_x"]) {
    assert.equal(
      tableNoSchema.safeParse(sentinel).success,
      false,
      `${sentinel} must stay impossible as a table name`,
    );
  }
});

test("createTableSchema takes name + optional seats and rejects a client-set status", () => {
  assert.equal(createTableSchema.safeParse({ tableNo: "Bar 3", capacity: 2 }).success, true);
  assert.equal(createTableSchema.safeParse({ tableNo: "Bar 3" }).success, true);
  // A new table always starts Available — occupancy belongs to the order lifecycle.
  assert.equal(
    createTableSchema.safeParse({ tableNo: "Bar 3", status: "Occupied" }).success,
    false,
  );
});

test("createTableSchema bounds seats to a whole, positive, plausible number", () => {
  for (const capacity of [0, -1, 2.5, 100]) {
    assert.equal(
      createTableSchema.safeParse({ tableNo: "B", capacity }).success,
      false,
      `capacity ${capacity} must be rejected`,
    );
  }
  assert.equal(createTableSchema.safeParse({ tableNo: "B", capacity: 1 }).success, true);
  assert.equal(createTableSchema.safeParse({ tableNo: "B", capacity: 99 }).success, true);
});

test("patchTableSchema refuses an empty edit", () => {
  assert.equal(patchTableSchema.safeParse({}).success, false);
  assert.equal(patchTableSchema.safeParse({ capacity: 6 }).success, true);
  assert.equal(patchTableSchema.safeParse({ tableNo: "Rooftop 2" }).success, true);
});

// The admin config seam (patch) and the staff live-status seam (update) are
// deliberately separate schemas so the routes can guard them differently.
test("patch and update seams stay disjoint", () => {
  assert.equal(patchTableSchema.safeParse({ status: "Occupied" }).success, false);
  assert.equal(updateTableSchema.safeParse({ status: "Occupied" }).success, true);
  assert.equal(updateTableSchema.safeParse({ status: "Nope" }).success, false);
});

// ── The regression this step exists for ──────────────────────────────────────

const sampleOrder = {
  customerName: "Walk-in",
  items: [{ productId: "p1", name: "Chai", price: 20, qty: 1 }],
  subtotal: 20,
  total: 20,
  paidAmount: 20,
  payment: "Cash",
  receiver: "cashier",
};

test("an order can name a table outside the old T-1..T-8 enum", () => {
  const r = createOrderSchema.safeParse({ ...sampleOrder, tableNo: "Rooftop 9" });
  assert.equal(r.success, true, "a cafe's own table name must be accepted");
});

test("an order still rejects a URL-unsafe table name", () => {
  assert.equal(
    createOrderSchema.safeParse({ ...sampleOrder, tableNo: "A/B" }).success,
    false,
  );
});

test("a walk-in order needs no table", () => {
  assert.equal(createOrderSchema.safeParse(sampleOrder).success, true);
});

test("the order update seam shares the same tableNo contract", () => {
  assert.equal(updateOrderSchema.safeParse({ tableNo: "Patio 4" }).success, true);
  assert.equal(updateOrderSchema.safeParse({ tableNo: "A/B" }).success, false);
});

test("reservations share the tableNo contract instead of taking any string", () => {
  const base = {
    name: "Asha",
    mobile: "9876543210",
    date: "2026-08-10",
    time: "19:30",
    guests: 2,
  };
  assert.equal(createReservationSchema.safeParse({ ...base, tableNo: "Patio 1" }).success, true);
  assert.equal(createReservationSchema.safeParse({ ...base, tableNo: "A/B" }).success, false);
  assert.equal(createReservationSchema.safeParse(base).success, true);
});
