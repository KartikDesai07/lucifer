// U6 Task 3 (2026-11-03): the seat / assign dialog's tile rules (lib/reservations-tables.ts; values 14, 19.5; design 8.2,
// B18): the 90-minute hold conflict and the tile's sub-line, tone and state per precedence step, in both modes.
import { test } from "node:test";
import assert from "node:assert/strict";

import { HOLD_MINUTES, conflictFor, seatTile } from "./reservations-tables";
import type { Reservation, Table } from "@/types";

const TODAY = "2026-11-03";
const res = (over: Partial<Reservation>): Reservation => ({
  _id: "r1", name: "Neha Joshi", mobile: "9812233445", date: TODAY, time: "19:00", guests: 2, tableNo: "T-3", status: "Booked",
  createdAt: "2026-11-02T10:00:00.000Z", updatedAt: "2026-11-02T10:00:00.000Z", ...over,
});
const table = (over: Partial<Table> = {}): Table => ({
  _id: "t3", tableNo: "T-3", status: "Available", capacity: 4, createdAt: "", updatedAt: "", ...over,
});
const booking = { id: "me", date: TODAY, time: "19:30", guests: 2 };

test("HOLD_MINUTES is the HTML's 90", () => {
  assert.equal(HOLD_MINUTES, 90, "RHOLD");
});

test("conflictFor: the same table and date under 90 minutes apart, either side; none at 90", () => {
  const other = res({ _id: "o1", time: "18:30" });
  assert.equal(conflictFor([other], "me", "T-3", TODAY, "20:00"), null, "exactly 90 minutes after: no conflict");
  assert.equal(conflictFor([other], "me", "T-3", TODAY, "19:59")?._id, "o1", "89 minutes: a conflict");
  assert.equal(conflictFor([other], "me", "T-3", TODAY, "19:30")?._id, "o1", "60 minutes: a conflict");
  assert.equal(conflictFor([res({ _id: "o2", time: "20:00" })], "me", "T-3", TODAY, "19:00")?._id, "o2", "a later booking within 60 minutes: a conflict");
  assert.equal(conflictFor([res({ _id: "o3", time: "20:30" })], "me", "T-3", TODAY, "19:00"), null, "90 minutes before: none");
});

test("conflictFor: another table, another date, a Cancelled / Completed booking and the booking itself never conflict; Seated does", () => {
  assert.equal(conflictFor([res({ tableNo: "T-4" })], "me", "T-3", TODAY, "19:00"), null, "another table");
  assert.equal(conflictFor([res({ date: "2026-11-04" })], "me", "T-3", TODAY, "19:00"), null, "another date");
  assert.equal(conflictFor([res({ status: "Cancelled" })], "me", "T-3", TODAY, "19:00"), null, "Cancelled");
  assert.equal(conflictFor([res({ status: "Completed" })], "me", "T-3", TODAY, "19:00"), null, "Completed");
  assert.equal(conflictFor([res({ _id: "me" })], "me", "T-3", TODAY, "19:00"), null, "the booking itself");
  assert.equal(conflictFor([res({ _id: "me" })], null, "T-3", TODAY, "19:00")?._id, "me", "no booking id (a new booking in the form): nothing excluded");
  assert.equal(conflictFor([res({ status: "Seated" })], "me", "T-3", TODAY, "19:00")?.status, "Seated", "Seated holds the table");
});

test("seatTile: free and fitting reads the seats in ok, with the ok border", () => {
  assert.deepEqual(seatTile(table({ capacity: 4 }), booking, [], "seat", TODAY), { sub: "4 seats", tone: "ok", off: false, fits: true }, "4 seats for 2 guests");
  assert.equal(seatTile(table({ capacity: 1 }), { ...booking, guests: 1 }, [], "seat", TODAY).sub, "1 seat", "one seat is singular");
});

test("seatTile: too small reads 'Seats {n} only' in warn, still pickable, no ok border; no capacity reads nothing", () => {
  assert.deepEqual(seatTile(table({ capacity: 2 }), { ...booking, guests: 6 }, [], "seat", TODAY), { sub: "Seats 2 only", tone: "warn", off: false, fits: false }, "too small");
  assert.deepEqual(seatTile(table({ capacity: 0 }), booking, [], "seat", TODAY), { sub: "", tone: "ok", off: false, fits: true }, "no capacity set");
});

test("seatTile: Occupied today is disabled when seating and pickable when assigning (info tone)", () => {
  const occupied = table({ status: "Occupied" });
  assert.deepEqual(seatTile(occupied, booking, [], "seat", TODAY), { sub: "Occupied", tone: "info", off: true, fits: false }, "seating: off");
  assert.deepEqual(seatTile(occupied, booking, [], "assign", TODAY), { sub: "Occupied", tone: "info", off: false, fits: false }, "assigning: pickable");
  assert.equal(seatTile(occupied, { ...booking, date: "2026-11-05" }, [], "seat", TODAY).sub, "4 seats", "a booking on another day has no Occupied state (B18)");
});

test("seatTile: Reserved reads 'Reserved' in the reserved ink and stays pickable in both modes (B18)", () => {
  const held = table({ status: "Reserved" });
  for (const mode of ["seat", "assign"] as const) {
    assert.deepEqual(seatTile(held, booking, [], mode, TODAY), { sub: "Reserved", tone: "reserved", off: false, fits: false }, `${mode}: pickable`);
  }
});

test("seatTile: a conflicting booking reads 'Seated · {first}' / 'Booked {time}' in warn; Occupied and Reserved outrank it", () => {
  const seated = res({ _id: "o1", status: "Seated", time: "19:00" });
  assert.deepEqual(seatTile(table(), booking, [seated], "seat", TODAY), { sub: "Seated · Neha", tone: "warn", off: false, fits: false }, "a Seated neighbour");
  const booked = res({ _id: "o2", time: "20:15" });
  assert.equal(seatTile(table(), booking, [booked], "seat", TODAY).sub, "Booked 8:15 PM", "a Booked neighbour");
  assert.equal(seatTile(table({ status: "Occupied" }), booking, [booked], "assign", TODAY).sub, "Occupied", "Occupied first");
  assert.equal(seatTile(table({ status: "Reserved" }), booking, [booked], "seat", TODAY).sub, "Reserved", "Reserved second");
  assert.equal(seatTile(table(), booking, [res({ _id: "me", time: "19:30" })], "seat", TODAY).sub, "4 seats", "the booking itself is not a conflict");
});
