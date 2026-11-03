// U6 Task 3 (2026-11-03): the booking detail's words and states (lib/reservations-detail-view.ts; values 10.3, 10.4, 19.4;
// design 7, B11, B19) with fixed clocks.
import { test } from "node:test";
import assert from "node:assert/strict";

import { bannerOf, detailSub, historyFact, madeOn, stepsOf, tableFact } from "./reservations-detail-view";
import type { Reservation, Table } from "@/types";

const TODAY = "2026-11-03";
const NOW = Date.parse("2026-11-03T18:30:00+05:30");
const res = (over: Partial<Reservation> = {}): Reservation => ({
  _id: "r1", name: "Rahul", mobile: "9812233445", date: TODAY, time: "19:00", guests: 2, tableNo: "T-3", status: "Booked",
  createdAt: "2026-11-02T10:00:00.000Z", updatedAt: "", ...over,
});
const table = (tableNo: string, capacity: number): Table => ({ _id: tableNo, tableNo, status: "Available", capacity, createdAt: "", updatedAt: "" });

test("detailSub: guests, the short day and the time; one guest is singular", () => {
  assert.equal(detailSub(res()), "2 guests · Tue, 3 Nov · 7:00 PM", "the HTML's sub-line");
  assert.equal(detailSub(res({ guests: 1 })), "1 guest · Tue, 3 Nov · 7:00 PM", "1 guest");
});

test("bannerOf: today's Booked shows the relative words; another day, Completed and Cancelled their own words", () => {
  assert.deepEqual(bannerOf(res(), NOW, TODAY), { time: "7:00 PM", text: "in 30 min", tone: "accent" }, "in 30 min");
  assert.equal(bannerOf(res(), Date.parse("2026-11-03T19:30:00+05:30"), TODAY).text, "Late · 30 min", "Late");
  assert.deepEqual(bannerOf(res({ date: "2026-11-04" }), NOW, TODAY), { time: "7:00 PM", text: "Booked for 7:00 PM", tone: null }, "another day");
  assert.equal(bannerOf(res({ date: "2026-11-02" }), NOW, TODAY).text, "Booked for 7:00 PM", "a past Booked day shows no Late (B11)");
  assert.deepEqual(bannerOf(res({ status: "Completed" }), NOW, TODAY), { time: "7:00 PM", text: "Completed", tone: null }, "Completed");
  assert.equal(bannerOf(res({ status: "Cancelled" }), NOW, TODAY).text, "Cancelled", "Cancelled");
  assert.deepEqual(bannerOf(res({ status: "Seated" }), NOW, TODAY), { time: "7:00 PM", text: "Seated 7:00 PM", tone: "ok" }, "Seated");
});

test("madeOn: the IST day of createdAt as 'd Mon'", () => {
  assert.equal(madeOn("2026-11-02T10:00:00.000Z"), "2 Nov", "2 Nov");
  assert.equal(madeOn("2026-11-02T20:00:00.000Z"), "3 Nov", "after 18:30 UTC it is already the next IST day");
});

test("stepsOf: three steps; dots up to the status, lines before it; Cancelled is grey all through; the time sits under Booked only", () => {
  const dots = (r: Reservation) => stepsOf(r).map((s) => (s.reached ? 1 : 0)).join("");
  const lines = (r: Reservation) => stepsOf(r).map((s) => (s.lineDone ? 1 : 0)).join("");
  assert.deepEqual(stepsOf(res()).map((s) => s.label), ["Booked", "Seated", "Completed"], "the HTML's Confirmed step is dropped");
  assert.equal(dots(res()), "100", "Booked: the first dot");
  assert.equal(lines(res()), "000", "Booked: no line yet");
  assert.equal(dots(res({ status: "Seated" })), "110", "Seated");
  assert.equal(lines(res({ status: "Seated" })), "100", "Seated: the first line");
  assert.equal(dots(res({ status: "Completed" })), "111", "Completed: all");
  assert.equal(lines(res({ status: "Completed" })), "110", "Completed: both lines (the last never draws)");
  assert.equal(dots(res({ status: "Cancelled" })), "000", "Cancelled: every dot grey");
  assert.equal(lines(res({ status: "Cancelled" })), "000", "Cancelled: every line grey");
  assert.deepEqual(stepsOf(res()).map((s) => s.time), ["2 Nov", "", ""], "the day it was made, under Booked");
});

test("tableFact: seats, warn when too small, off the plan, loading, not assigned", () => {
  const tables = [table("T-3", 4), table("T-5", 0)];
  assert.deepEqual(tableFact(res(), tables), { text: "T-3 · 4 seats", tone: "plain" }, "T-3 · 4 seats");
  assert.deepEqual(tableFact(res({ guests: 6 }), tables), { text: "T-3 · 4 seats", tone: "warn" }, "fewer seats than guests: warn");
  assert.deepEqual(tableFact(res({ tableNo: "T-9" }), tables), { text: "T-9 · no longer on the floor plan", tone: "warn" }, "B19");
  assert.deepEqual(tableFact(res({ tableNo: "T-5" }), tables), { text: "T-5", tone: "plain" }, "no capacity set");
  assert.deepEqual(tableFact(res(), undefined), { text: "T-3", tone: "plain" }, "tables still loading: the name only, never 'no longer on the floor plan'");
  assert.deepEqual(tableFact(res({ tableNo: undefined }), tables), { text: "Not assigned yet", tone: "faint" }, "no table");
  assert.equal(tableFact(res({ guests: 1 }), [table("T-3", 1)]).text, "T-3 · 1 seat", "one seat is singular");
});

test("historyFact: plurals right", () => {
  assert.equal(historyFact(0), "First booking", "none");
  assert.equal(historyFact(1), "1 past visit", "one");
  assert.equal(historyFact(3), "3 past visits", "three");
});

test("madeOn / stepsOf (review M2): a missing or malformed createdAt gives no date and never throws", () => {
  assert.equal(madeOn("not a date"), "", "malformed");
  assert.equal(madeOn(""), "", "empty");
  assert.equal(madeOn(undefined as unknown as string), "", "missing");
  assert.equal(stepsOf(res({ createdAt: undefined as unknown as string }))[0]?.time, "", "stepsOf keeps rendering");
  assert.equal(madeOn("2026-11-02T10:00:00.000Z"), "2 Nov", "a real one is unchanged");
});
