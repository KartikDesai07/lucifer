// U6 Task 1: the Reservations toasts (design 8.4): the HTML's words, no Undo; "first" is the name's first word and the
// apostrophe is U+2019.
import { test } from "node:test";
import assert from "node:assert/strict";

import type { Reservation } from "@/types";
import {
  DELETED_TOAST,
  assignedToast,
  bookedToast,
  cancelledToast,
  completedToast,
  restoredToast,
  statusToast,
  seatedToast,
  updatedToast,
} from "./reservations-toasts";

const r = (over: Partial<Reservation> = {}): Reservation => ({
  _id: "r1",
  name: "Rahul Mehta",
  mobile: "9820123456",
  date: "2026-11-03",
  time: "19:00",
  guests: 2,
  status: "Booked",
  createdAt: "2026-11-02T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
  ...over,
});

test("booked and updated: the day, the time, the guests", () => {
  assert.equal(bookedToast(r()), "Booked · Tue, 3 Nov, 7:00 PM · 2 guests", "booked");
  assert.equal(bookedToast(r({ guests: 1, time: "00:30" })), "Booked · Tue, 3 Nov, 12:30 AM · 1 guest", "one guest, past midnight");
  assert.equal(updatedToast(r()), "Booking updated · Tue, 3 Nov, 7:00 PM", "updated");
});

test("seated: the table picked, the booking's, or none", () => {
  assert.equal(seatedToast(r({ tableNo: "T-3", guests: 4 })), "Rahul seated at T-3 · 4 guests", "the booking's table");
  assert.equal(seatedToast(r({ tableNo: "T-3", guests: 4 }), "T-7"), "Rahul seated at T-7 · 4 guests", "the picked table wins");
  assert.equal(seatedToast(r({ guests: 4 })), "Rahul seated · 4 guests", "no table");
});

test("completed, cancelled, restored, assigned, deleted", () => {
  assert.equal(completedToast(r({ tableNo: "T-3" })), "T-3 marked completed", "with a table");
  assert.equal(completedToast(r()), "Rahul’s booking completed", "no table");
  assert.equal(cancelledToast(r()), "Rahul’s booking cancelled", "cancelled");
  assert.equal(restoredToast(), "Booking restored", "restored");
  assert.equal(assignedToast(r(), "T-2"), "T-2 assigned to Rahul", "assigned");
  assert.equal(DELETED_TOAST, "Reservation deleted", "deleted keeps today's words");
});

test("first is the name's first word, whatever the spacing", () => {
  assert.equal(cancelledToast(r({ name: "  Neha   Joshi " })), "Neha’s booking cancelled", "extra spaces");
});

test("statusToast picks the words of the status a write sets (Booked is Restore)", () => {
  const booking = r({ tableNo: "T-3", guests: 4 });
  assert.equal(statusToast("Seated")(booking), "Rahul seated at T-3 · 4 guests", "Seated");
  assert.equal(statusToast("Completed")(booking), "T-3 marked completed", "Completed");
  assert.equal(statusToast("Cancelled")(booking), "Rahul’s booking cancelled", "Cancelled");
  assert.equal(statusToast("Booked")(booking), "Booking restored", "Booked = Restore");
});
