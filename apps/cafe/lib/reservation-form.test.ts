// U6 Task 4 (2026-11-03): the reservation form's rules (lib/reservation-form.ts; values 13, 19.6; design 8.1, B20, Q2, Q3, Q6).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DINNER_SLOTS,
  LUNCH_SLOTS,
  bestFits,
  createPayload,
  dayChips,
  isSlotTime,
  moreLabel,
  editPayload,
  formDefaults,
  knownName,
  returningGuestLine,
  slotLoad,
  slotPassed,
  summaryLine,
  tableMessage,
  type FormValues,
} from "./reservation-form";
import type { Reservation, Table } from "@/types";

const TODAY = "2026-11-03";
const NOW = Date.parse(`${TODAY}T21:30:00+05:30`);
const res = (over: Partial<Reservation>): Reservation => ({
  _id: "r1", name: "Neha Joshi", mobile: "9812233445", date: TODAY, time: "19:00", guests: 2, tableNo: undefined, status: "Booked",
  createdAt: "2026-11-02T10:00:00.000Z", updatedAt: "2026-11-02T10:00:00.000Z", ...over,
});
const table = (no: string, capacity: number, over: Partial<Table> = {}): Table => ({
  _id: `t-${no}`, tableNo: no, status: "Available", capacity, createdAt: "", updatedAt: "", ...over,
});
const values = (over: Partial<FormValues> = {}): FormValues => ({
  name: "Asha", mobile: "9000000001", date: TODAY, time: "22:00", guests: 2, tableNo: undefined, notes: "", ...over,
});
const names = (x: Table[]): string[] => x.map((t) => t.tableNo);

test("the slots: Lunch 12:00 - 15:30 (8), Dinner 18:00 - 22:30 (10), half hours", () => {
  assert.equal(LUNCH_SLOTS.length, 8, "eight lunch slots");
  assert.equal(LUNCH_SLOTS[0], "12:00", "lunch starts at noon");
  assert.equal(LUNCH_SLOTS[7], "15:30", "lunch ends 15:30");
  assert.equal(DINNER_SLOTS.length, 10, "ten dinner slots");
  assert.equal(DINNER_SLOTS[0], "18:00", "dinner starts at 6");
  assert.equal(DINNER_SLOTS[9], "22:30", "dinner ends 22:30");
});

test("slotLoad: other Booked / Seated guests under 45 minutes away: > 0, >= 8, >= 16; never the booking itself", () => {
  const at = (guests: number, time = "20:30", status: Reservation["status"] = "Booked", id = "o") => res({ _id: id, guests, time, status });
  assert.equal(slotLoad([], TODAY, "20:00", null), 0, "nobody: quiet");
  assert.equal(slotLoad([at(2)], TODAY, "20:00", null), 1, "2 guests: one dot");
  assert.equal(slotLoad([at(8)], TODAY, "20:00", null), 2, "8 guests: two dots");
  assert.equal(slotLoad([at(6), at(10, "20:15", "Seated", "p")], TODAY, "20:00", null), 3, "16 guests across two bookings: three dots");
  assert.equal(slotLoad([at(8, "20:45")], TODAY, "20:00", null), 0, "exactly 45 minutes away: not counted");
  assert.equal(slotLoad([at(8, "20:30", "Cancelled")], TODAY, "20:00", null), 0, "a Cancelled booking is not load");
  assert.equal(slotLoad([at(8, "20:30", "Completed")], TODAY, "20:00", null), 0, "a Completed booking is not load");
  assert.equal(slotLoad([at(8, "20:30", "Booked", "me")], TODAY, "20:00", "me"), 0, "the booking being edited is excluded");
  assert.equal(slotLoad([{ ...at(8), date: "2026-11-04" }], TODAY, "20:00", null), 0, "another day is not load");
});

test("slotPassed: today only, earlier than now - 10 minutes", () => {
  assert.equal(slotPassed(TODAY, "21:19", TODAY, NOW), true, "11 minutes ago: passed");
  assert.equal(slotPassed(TODAY, "21:20", TODAY, NOW), false, "exactly 10 minutes ago: still open");
  assert.equal(slotPassed(TODAY, "22:00", TODAY, NOW), false, "later today: open");
  assert.equal(slotPassed("2026-11-04", "09:00", TODAY, NOW), false, "another day: never passed");
  assert.equal(slotPassed("2026-11-02", "09:00", TODAY, NOW), false, "a past day: the picker allows it, no slot is struck");
});

test("formDefaults (B20): the shown day if it is today or later, else today; guests 2; Book again seeds name, mobile, guests", () => {
  assert.equal(formDefaults({ shownDay: "2026-11-05", today: TODAY }).date, "2026-11-05", "a later shown day");
  assert.equal(formDefaults({ shownDay: "2026-11-01", today: TODAY }).date, TODAY, "a past shown day becomes today");
  assert.equal(formDefaults({ shownDay: "all", today: TODAY }).date, TODAY, "All dates becomes today");
  const d = formDefaults({ shownDay: TODAY, today: TODAY });
  assert.deepEqual([d.guests, d.time, d.tableNo, d.name, d.mobile, d.notes], [2, "", undefined, "", "", ""], "the empty form");
  const p = formDefaults({ shownDay: TODAY, today: TODAY, prefill: { name: "Arjun", mobile: "9876543210", guests: 6 } });
  assert.deepEqual([p.name, p.mobile, p.guests, p.time], ["Arjun", "9876543210", 6, ""], "Book again: no time, no table");
});

test("summaryLine: the day, the time or 'time not set', the guests (plural), the table or 'no table'", () => {
  assert.equal(summaryLine(values({ time: "19:00", tableNo: "T-3" })), "Tue, 3 Nov · 7:00 PM · 2 guests · T-3", "all set");
  assert.equal(summaryLine(values({ time: "", guests: 1 })), "Tue, 3 Nov · time not set · 1 guest · no table", "nothing set");
  assert.equal(summaryLine(values({ guests: Number.NaN })), "Tue, 3 Nov · 10:00 PM · guests not set · no table", "an empty count");
});

test("bestFits: free, fitting, ranked by spare seats then name, first 7; the picked one kept; unknown capacity after the known", () => {
  const tables = [table("T-1", 2), table("T-2", 4), table("T-3", 6), table("T-4", 2), table("T-5", 0), table("T-6", 2), table("T-7", 2), table("T-8", 2), table("T-9", 2), table("T-10", 8)];
  const v = values({ time: "13:00", date: "2026-11-04" });
  assert.deepEqual(names(bestFits(tables, v, [], null, TODAY, NOW)), ["T-1", "T-4", "T-6", "T-7", "T-8", "T-9", "T-2"], "2-seaters first by name (natural order), then 4; 7 only");
  assert.deepEqual(names(bestFits(tables.slice(0, 5), v, [], null, TODAY, NOW)), ["T-1", "T-4", "T-2", "T-3", "T-5"], "the unknown capacity table comes after the known fits");
  assert.deepEqual(names(bestFits(tables, { ...v, guests: 7 }, [], null, TODAY, NOW)), ["T-10", "T-5"], "7 guests: only the 8-seater fits, then the unknown one");
  const picked = bestFits(tables, { ...v, tableNo: "T-3" }, [], null, TODAY, NOW);
  assert.equal(picked[0].tableNo, "T-3", "a picked table outside the first 7 is prepended");
  assert.equal(picked.length, 7, "and the list stays 7");
  assert.deepEqual(names(bestFits(tables, { ...v, tableNo: "T-1" }, [], null, TODAY, NOW)).slice(0, 2), ["T-1", "T-4"], "a picked table already in the list keeps its place");
  const conflict = res({ _id: "o", tableNo: "T-1", date: "2026-11-04", time: "13:30" });
  assert.ok(!names(bestFits(tables, v, [conflict], null, TODAY, NOW)).includes("T-1"), "a table booked within 90 minutes is not a best fit");
  assert.ok(names(bestFits(tables, v, [conflict], "o", TODAY, NOW)).includes("T-1"), "...unless it is the booking being edited");
});

test("bestFits: an Occupied table is out today while the booking is under 90 minutes from now (or no time yet), in later", () => {
  const tables = [table("T-1", 2, { status: "Occupied" }), table("T-2", 2)];
  const fits = (v: FormValues): string[] => names(bestFits(tables, v, [], null, TODAY, NOW));
  assert.deepEqual(fits(values({ time: "22:00" })), ["T-2"], "22:00 is 30 minutes from 21:30: occupied is out");
  assert.deepEqual(fits(values({ time: "" })), ["T-2"], "no time yet: treated as now");
  assert.deepEqual(fits(values({ time: "23:00" })), ["T-1", "T-2"], "23:00 is 90 minutes away: occupied comes back");
  assert.deepEqual(fits(values({ time: "22:00", date: "2026-11-04" })), ["T-1", "T-2"], "another day: the table's state is not today's");
});

test("tableMessage: the conflict sentences (bad), occupied now and too small (warn), nothing for a fit", () => {
  const tables = [table("T-3", 4), table("T-7", 4, { status: "Occupied" }), table("T-2", 2)];
  const msg = (v: FormValues, list: Reservation[] = [], id: string | null = null) => tableMessage(tables, v, list, id, TODAY, NOW);
  assert.equal(msg(values({ tableNo: undefined })), null, "no table: no message");
  assert.equal(msg(values({ tableNo: "T-2", time: "22:00" })), null, "a free fitting table");
  const booked = res({ _id: "o", name: "Rahul Mehta", tableNo: "T-3", time: "21:45" });
  assert.deepEqual(msg(values({ tableNo: "T-3", time: "22:00" }), [booked]), { tone: "bad", text: "T-3 is already booked at 9:45 PM for Rahul Mehta. Pick another table or leave it unassigned." }, "a booking holds it");
  const seated = res({ _id: "o", name: "Neha Joshi", tableNo: "T-3", time: "21:00", status: "Seated" });
  assert.deepEqual(msg(values({ tableNo: "T-3", time: "22:00" }), [seated]), { tone: "bad", text: "T-3 has Neha Joshi seated from 9:00 PM. Pick another table or leave it unassigned." }, "a seated party holds it");
  assert.equal(msg(values({ tableNo: "T-3", time: "22:00" }), [booked], "o"), null, "the booking being edited does not conflict with itself");
  assert.deepEqual(msg(values({ tableNo: "T-7", time: "22:00" }), []), { tone: "warn", text: "T-7 is occupied right now. It may not be free by 10:00 PM." }, "occupied now");
  assert.equal(msg(values({ tableNo: "T-7", time: "" })), null, "occupied but no time to word it: no message");
  assert.equal(msg(values({ tableNo: "T-7", time: "22:00", date: "2026-11-04" })), null, "occupied is today's state only");
  assert.deepEqual(msg(values({ tableNo: "T-3", guests: 8, time: "22:00" })), { tone: "warn", text: "T-3 seats 4. For 8 guests you may need to join a table." }, "too small");
  assert.equal(msg(values({ tableNo: "T-3", guests: 8, time: "22:00" }), [booked])?.tone, "bad", "a conflict outranks the rest");
});

test("editPayload (Q6): Unassigned over a saved table sends tableNo: null; a kept or changed table is a string; never a status", () => {
  const original = res({ tableNo: "T-3" });
  assert.equal(editPayload(values({ tableNo: undefined }), original).tableNo, null, "Unassigned over T-3 clears it");
  assert.equal(editPayload(values({ tableNo: "T-3" }), original).tableNo, "T-3", "unchanged table: the string");
  assert.equal(editPayload(values({ tableNo: "T-5" }), original).tableNo, "T-5", "a changed table: the string");
  assert.equal("tableNo" in editPayload(values({ tableNo: undefined }), res({ tableNo: undefined })), false, "no table before and after: no key");
  assert.equal("status" in editPayload(values({ tableNo: "T-3" }), original), false, "an edit never sends a status");
  assert.deepEqual(Object.keys(editPayload(values({ tableNo: "T-3" }), original)).sort(), ["date", "guests", "mobile", "name", "notes", "tableNo", "time"], "today's fields");
});

test("createPayload: today's body with status Booked and no tableNo key when none", () => {
  const none = createPayload(values());
  assert.equal(none.status, "Booked", "status Booked");
  assert.equal("tableNo" in none, false, "no table: no key (never null)");
  assert.equal(createPayload(values({ tableNo: "T-2" })).tableNo, "T-2", "a picked table is sent");
  assert.deepEqual([none.name, none.mobile, none.date, none.time, none.guests, none.notes], ["Asha", "9000000001", TODAY, "22:00", 2, ""], "the typed values as typed");
});

test("returningGuestLine: only at exactly 10 digits, only with past visits, plural right; knownName fills from an earlier booking", () => {
  const done = (id: string, status: Reservation["status"] = "Completed", mobile = "98670 04512", createdAt = "2026-11-01T10:00:00.000Z") =>
    res({ _id: id, mobile, status, name: `Guest ${id}`, createdAt });
  const list = [done("a"), done("b"), done("c"), done("d", "Cancelled", "9867004512", "2026-11-02T10:00:00.000Z")];
  assert.equal(returningGuestLine(list, "9867004512", "x"), "Returning guest · 3 past visits", "digits only match, Completed only");
  assert.equal(returningGuestLine([done("a")], "9867004512", "x"), "Returning guest · 1 past visit", "one visit");
  assert.equal(returningGuestLine(list, "9867004512", "a"), "Returning guest · 2 past visits", "the booking being edited is excluded");
  assert.equal(returningGuestLine(list, "986700451", "x"), null, "9 digits: nothing");
  assert.equal(returningGuestLine(list, "9000000001", "x"), null, "a new number: nothing");
  assert.equal(returningGuestLine(list, "+91 98670 04512", "x"), null, "12 digits: not a 10-digit number");
  assert.equal(knownName(list, "9867004512", "x"), "Guest d", "the most recently created booking's name");
  assert.equal(knownName(list, "9000000001", "x"), null, "none for a new number");
  assert.equal(knownName(list, "986700451", "x"), null, "none under 10 digits");
});

test("dayChips: seven days from today, Today / Tmrw / weekday over the day number; moreLabel and isSlotTime", () => {
  const chips = dayChips(TODAY);
  assert.equal(chips.length, 7, "seven chips");
  assert.deepEqual(chips.map((c) => c.top), ["Today", "Tmrw", "Thu", "Fri", "Sat", "Sun", "Mon"], "the tops");
  assert.deepEqual(chips.map((c) => c.num), ["3", "4", "5", "6", "7", "8", "9"], "the numbers, no month, no zero");
  assert.equal(chips[6].day, "2026-11-09", "the strip ends a week on");
  assert.equal(moreLabel("2026-11-30"), "30 Nov", "More reads the day and month");
  assert.equal(isSlotTime("19:30"), true, "a dinner slot");
  assert.equal(isSlotTime("19:15"), false, "a quarter hour is Other time");
  assert.equal(isSlotTime("09:00"), false, "outside Lunch and Dinner is Other time");
});
