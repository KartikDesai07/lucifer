import { test } from "node:test";
import assert from "node:assert/strict";

import { createReservationSchema, updateReservationSchema } from "./reservation.schema";

// U6 Task 4 (owner Q6, B28): the edit may clear a booking's table with `tableNo: null`; create never takes null.
test("updateReservationSchema keeps tableNo: null (Unassigned over a saved table)", () => {
  const parsed = updateReservationSchema.parse({ tableNo: null });
  assert.equal(parsed.tableNo, null, "the null survives the parse so the route can $unset it");
});

test("updateReservationSchema still takes a table name, an absent table and the other partial fields", () => {
  assert.equal(updateReservationSchema.parse({ tableNo: "T-3" }).tableNo, "T-3", "a name stays a string");
  assert.equal("tableNo" in updateReservationSchema.parse({ guests: 4 }), false, "an absent table stays absent");
  assert.equal(updateReservationSchema.safeParse({ tableNo: "" }).success, false, "an empty name is still refused");
  assert.equal(updateReservationSchema.safeParse({ status: "Seated" }).success, true, "a status write still parses");
});

test("createReservationSchema still refuses a null table", () => {
  const base = { name: "Asha", mobile: "9000000001", date: "2026-11-03", time: "19:00", guests: 2 };
  assert.equal(createReservationSchema.safeParse({ ...base, tableNo: null }).success, false, "create never takes null");
  assert.equal(createReservationSchema.safeParse(base).success, true, "create without a table is fine");
});
