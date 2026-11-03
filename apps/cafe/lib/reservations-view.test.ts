// U6 Task 1 (2026-11-03): the Reservations page's pure view model (lib/reservations-view.ts): the owner's HTML
// view-model (values 19.1 - 19.3, 9; design 6.1 - 6.5, 6.3 actions, 7 detail actions; rulings B11, B12) on our four
// statuses. Fixed clocks only: the IST instant is written out so no test reads the machine's zone.
import { test } from "node:test";
import assert from "node:assert/strict";

import { cafeDateString } from "@pos/shared/utils";
import type { Reservation } from "@/types";
import {
  bookingAt,
  clockOf,
  dayLabel,
  dayTag,
  detailActions,
  emptyWords,
  formatMobile,
  fullDay,
  headerLine,
  listRows,
  matchesQuery,
  pastVisits,
  pillOf,
  relativeOf,
  resolveDay,
  rowActions,
  shiftDay,
  shortDay,
  tabCounts,
  tabOptions,
} from "./reservations-view";

const TODAY = "2026-10-19";
const at = (hm: string, day = TODAY): number => Date.parse(`${day}T${hm}:00+05:30`);
const NOW = at("21:30");

let seq = 0;
function res(over: Partial<Reservation> = {}): Reservation {
  seq += 1;
  return {
    _id: `r${seq}`,
    name: "Rahul Mehta",
    mobile: "9820123456",
    date: TODAY,
    time: "21:00",
    guests: 2,
    status: "Booked",
    createdAt: "2026-10-18T10:00:00.000Z",
    updatedAt: "2026-10-18T10:00:00.000Z",
    ...over,
  };
}

test("bookingAt is the IST instant of the booking", () => {
  assert.equal(bookingAt({ date: TODAY, time: "21:00" }), Date.UTC(2026, 9, 19, 15, 30), "21:00 IST is 15:30 UTC");
});

test("clockOf: 12-hour words, 00:30 is 12:30 AM and 12:00 is 12:00 PM", () => {
  assert.deepEqual(clockOf("19:00"), { full: "7:00 PM", hm: "7:00", ap: "PM" }, "19:00");
  assert.equal(clockOf("00:30").full, "12:30 AM", "00:30 is 12:30 AM (the shared formatTime's 0:30 AM is not used)");
  assert.equal(clockOf("12:00").full, "12:00 PM", "noon");
  assert.equal(clockOf("09:05").full, "9:05 AM", "no leading zero");
});

test("formatMobile: ten digits as +91 98670 04512, anything else as stored", () => {
  assert.equal(formatMobile("9867004512"), "+91 98670 04512", "ten digits");
  assert.equal(formatMobile("+91 98670 04512"), "+91 98670 04512", "stored with a prefix");
  assert.equal(formatMobile("12345"), "12345", "short as stored");
});

test("relativeOf at 21:30 IST on today's date (values 19.2, B11)", () => {
  const rel = (r: Reservation) => relativeOf(r, NOW, TODAY);
  assert.deepEqual(rel(res({ time: "21:00" })), { text: "Late · 30 min", tone: "bad", weight: 600 }, "30 min late");
  assert.deepEqual(rel(res({ time: "21:30" })), { text: "Due now", tone: "warn", weight: 600 }, "due now at the minute");
  assert.deepEqual(rel(res({ time: "21:45" })), { text: "in 15 min", tone: "accent", weight: 600 }, "within the hour");
  assert.deepEqual(rel(res({ time: "23:00" })), { text: "in 1h 30m", tone: "muted", weight: 400 }, "later today");
  assert.equal(rel(res({ time: "23:30" })).text, "in 2h 00m", "two-digit minutes");
  assert.equal(rel(res({ time: "21:20" })).text, "Due now", "up to 15 minutes past is still Due now");
  assert.equal(rel(res({ time: "21:10" })).text, "Late · 20 min", "past 15 minutes is Late");
  assert.equal(rel(res({ time: "20:25" })).text, "Late · 1h 05m", "an hour and more");
  assert.deepEqual(rel(res({ date: "2026-10-18" })), { text: "", tone: null, weight: 400 }, "B11: yesterday has no relative line");
  assert.deepEqual(rel(res({ date: "2026-10-20" })), { text: "", tone: null, weight: 400 }, "another day has none");
  assert.deepEqual(rel(res({ status: "Seated" })), { text: "Seated 9:00 PM", tone: "ok", weight: 500 }, "Seated shows the booking time");
  assert.equal(rel(res({ status: "Completed" })).text, "", "Completed has none");
  assert.equal(rel(res({ status: "Cancelled" })).text, "", "Cancelled has none");
});

test("pillOf: Booked turns Late only on today's bookings (B11)", () => {
  assert.equal(pillOf(res({ time: "21:00" }), NOW, TODAY), "Late", "today, 30 min past");
  assert.equal(pillOf(res({ time: "21:20" }), NOW, TODAY), "Booked", "10 min past is not late yet");
  assert.equal(pillOf(res({ date: "2026-10-18", time: "21:00" }), NOW, TODAY), "Booked", "B11: a past day never shows Late");
  assert.equal(pillOf(res({ status: "Seated" }), NOW, TODAY), "Seated", "Seated");
  assert.equal(pillOf(res({ status: "Completed" }), NOW, TODAY), "Completed", "Completed");
  assert.equal(pillOf(res({ status: "Cancelled" }), NOW, TODAY), "Cancelled", "Cancelled");
});

test("the clock moves with the tick: Due now becomes Late, and a tab past midnight reads the new day as today (B12)", () => {
  const r = res({ time: "21:00" });
  assert.equal(relativeOf(r, at("21:00"), TODAY).text, "Due now", "at its time");
  assert.equal(relativeOf(r, at("21:16"), TODAY).text, "Late · 16 min", "16 minutes later");
  const before = Date.parse("2026-10-19T23:59:00+05:30");
  const after = Date.parse("2026-10-20T00:01:00+05:30");
  const todayBefore = cafeDateString(new Date(before));
  const todayAfter = cafeDateString(new Date(after));
  assert.equal(todayBefore, "2026-10-19", "23:59 is still the 19th");
  assert.equal(todayAfter, "2026-10-20", "00:01 is the 20th");
  assert.equal(resolveDay(null, todayBefore), "2026-10-19", "an unset day follows the clock");
  assert.equal(resolveDay(null, todayAfter), "2026-10-20", "and moves with it");
  assert.equal(resolveDay("2026-10-25", todayAfter), "2026-10-25", "a chosen day stays");
  assert.equal(dayLabel(resolveDay(null, todayAfter), todayAfter, false), "Today · Tue, 20 Oct", "the label reads the new day as Today");
  const tonight = res({ time: "23:30" });
  assert.equal(pillOf(tonight, before, todayBefore), "Late", "at 23:59 a 23:30 booking of today is Late");
  assert.equal(pillOf(tonight, after, todayAfter), "Booked", "after midnight it is yesterday's booking: never Late (B11)");
});

test("matchesQuery: the name, the table with - and spaces ignored, and three or more digits of the mobile", () => {
  const r = res({ name: "Simran Kaur", tableNo: "T-5", mobile: "9820123456" });
  assert.equal(matchesQuery(r, "simran"), true, "the name, any case");
  assert.equal(matchesQuery(r, "T5"), true, "T5 finds T-5");
  assert.equal(matchesQuery(r, "t-5"), true, "t-5 finds T-5");
  assert.equal(matchesQuery(r, "98201"), true, "98201 is in the mobile");
  assert.equal(matchesQuery(r, "98"), false, "two digits never search the phone");
  assert.equal(matchesQuery(r, "zzz"), false, "no match");
  assert.equal(matchesQuery(res({ name: "Amit", tableNo: undefined }), "T5"), false, "no table, no match");
  assert.equal(matchesQuery(r, "  simran "), true, "the query is trimmed");
});

test("listRows: a day and a tab, time order; a search lists every date nearest first and ignores the tab; All dates sorts date then time", () => {
  const a = res({ _id: "a", time: "20:00" });
  const b = res({ _id: "b", time: "19:00" });
  const done = res({ _id: "done", time: "17:00", status: "Completed" });
  const tomorrow = res({ _id: "tom", date: "2026-10-20", time: "12:00", name: "Rahul Tomorrow" });
  const far = res({ _id: "far", date: "2026-10-25", time: "09:00", name: "Rahul Far" });
  const list = [a, tomorrow, done, far, b];
  const base = { nowMs: NOW, today: TODAY, query: "" };
  assert.deepEqual(listRows(list, { ...base, day: null, tab: "upcoming" }).map((r) => r._id), ["b", "a"], "today's upcoming, by time");
  assert.deepEqual(listRows(list, { ...base, day: null, tab: "done" }).map((r) => r._id), ["done"], "the Completed tab");
  assert.deepEqual(listRows(list, { ...base, day: null, tab: "all" }).map((r) => r._id), ["done", "b", "a"], "every status of today");
  assert.deepEqual(listRows(list, { ...base, day: "2026-10-20", tab: "upcoming" }).map((r) => r._id), ["tom"], "another day");
  assert.deepEqual(listRows(list, { ...base, day: "all", tab: "upcoming" }).map((r) => r._id), ["b", "a", "tom", "far"], "All dates: date + time");
  assert.deepEqual(
    listRows(list, { ...base, day: null, tab: "cancelled", query: "rahul" }).map((r) => r._id),
    ["a", "b", "done", "tom", "far"],
    "a search: every date and status, nearest to now first (the tab is ignored)",
  );
  assert.equal(listRows(list, { ...base, day: null, tab: "upcoming", query: "zzz" }).length, 0, "no match");
});

test("tabCounts and tabOptions: the shown day's counts, the HTML's labels", () => {
  const list = [res(), res(), res({ status: "Seated" }), res({ status: "Completed" }), res({ status: "Cancelled" }), res({ date: "2026-10-20" })];
  const counts = tabCounts(list, TODAY);
  assert.deepEqual(counts, { upcoming: 2, seated: 1, done: 1, cancelled: 1, all: 5 }, "today's counts, the other day left out");
  assert.deepEqual(tabCounts(list, "all"), { upcoming: 3, seated: 1, done: 1, cancelled: 1, all: 6 }, "All dates counts everything");
  assert.deepEqual(
    tabOptions({ upcoming: 4, seated: 1, done: 1, cancelled: 1, all: 8 }),
    [
      { value: "upcoming", label: "Upcoming (4)" },
      { value: "seated", label: "Seated (1)" },
      { value: "done", label: "Completed (1)" },
      { value: "cancelled", label: "Cancelled (1)" },
      { value: "all", label: "All statuses (8)" },
    ],
    "the select's options",
  );
});

test("headerLine: upcoming bookings, guests and the day; the plurals; a search; All dates", () => {
  const list = [
    res({ guests: 4 }),
    res({ guests: 15 }),
    res({ status: "Seated", guests: 9 }),
    res({ date: "2026-10-20", guests: 6, name: "Karthik Iyer" }),
  ];
  const base = { nowMs: NOW, today: TODAY, query: "" };
  assert.equal(headerLine(list, { ...base, day: null }), "2 upcoming bookings · 19 guests · Monday, 19 October", "two bookings");
  assert.equal(headerLine(list, { ...base, day: "2026-10-20" }), "1 upcoming booking · 6 guests · Tuesday, 20 October", "one booking");
  assert.equal(headerLine([res({ guests: 1 })], { ...base, day: null }), "1 upcoming booking · 1 guest · Monday, 19 October", "one guest");
  assert.equal(headerLine([], { ...base, day: "2026-10-18" }), "0 upcoming bookings · 0 guests · Sunday, 18 October", "an empty day");
  assert.equal(headerLine(list, { ...base, day: "all" }), "3 upcoming bookings · 25 guests · all dates", "All dates");
  assert.equal(headerLine(list, { ...base, day: null, query: "karthik" }), "1 match across all dates", "one match");
  assert.equal(headerLine(list, { ...base, day: null, query: "rahul" }), "3 matches across all dates", "matches");
  assert.equal(headerLine(list, { ...base, day: null, query: "zzz" }), "0 matches across all dates", "none");
});

test("emptyWords: the HTML's three sentences with curly quotes", () => {
  assert.deepEqual(
    emptyWords({ day: "2026-10-18", tab: "upcoming", query: "", today: TODAY }),
    { title: "No upcoming bookings · Sunday, 18 October", text: "Bookings made from here, phone calls or WhatsApp show up in this list." },
    "upcoming, nothing booked",
  );
  assert.deepEqual(
    emptyWords({ day: null, tab: "seated", query: "", today: TODAY }),
    { title: "Nothing in this list for Monday, 19 October", text: "Bookings made from here, phone calls or WhatsApp show up in this list." },
    "any other tab",
  );
  assert.deepEqual(
    emptyWords({ day: null, tab: "upcoming", query: " zzz ", today: TODAY }),
    { title: "No bookings match “zzz”", text: "Try a name, phone number or table like T5." },
    "a search with no match",
  );
  assert.equal(emptyWords({ day: "all", tab: "upcoming", query: "", today: TODAY }).title, "No upcoming bookings · all dates", "All dates");
});

test("dayLabel, fullDay, shortDay, dayTag, shiftDay", () => {
  assert.equal(dayLabel(TODAY, TODAY, false), "Today · Mon, 19 Oct", "today");
  assert.equal(dayLabel(TODAY, TODAY, true), "Today", "today on a phone");
  assert.equal(dayLabel("2026-10-20", TODAY, false), "Tomorrow · Tue, 20 Oct", "tomorrow");
  assert.equal(dayLabel("2026-10-20", TODAY, true), "Tomorrow", "tomorrow on a phone");
  assert.equal(dayLabel("2026-10-18", TODAY, false), "Yesterday · Sun, 18 Oct", "yesterday");
  assert.equal(dayLabel("2026-10-18", TODAY, true), "18 Oct", "yesterday on a phone (the HTML's)");
  assert.equal(dayLabel("2026-10-21", TODAY, false), "Wed, 21 Oct", "another day");
  assert.equal(dayLabel("2026-10-21", TODAY, true), "21 Oct", "another day on a phone");
  assert.equal(dayLabel("all", TODAY, false), "All dates", "All dates");
  assert.equal(dayLabel("all", TODAY, true), "All dates", "All dates on a phone");
  assert.equal(fullDay("2026-11-03"), "Tuesday, 3 November", "fullDay");
  assert.equal(shortDay("2026-11-03"), "Tue, 3 Nov", "shortDay");
  assert.equal(dayTag("2026-11-04"), "Wed 4", "dayTag");
  assert.equal(shiftDay("2026-10-31", 1), "2026-11-01", "a month end");
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31", "a year start");
});

test("pastVisits: Completed bookings on the same digits, never the booking itself", () => {
  const list = [
    res({ _id: "x1", status: "Completed", mobile: "9820123456" }),
    res({ _id: "x2", status: "Completed", mobile: "98201 23456" }),
    res({ _id: "x3", status: "Cancelled", mobile: "9820123456" }),
    res({ _id: "x4", status: "Completed", mobile: "9000000000" }),
    res({ _id: "me", status: "Completed", mobile: "9820123456" }),
  ];
  assert.equal(pastVisits(list, "9820123456", "me"), 2, "two others on the same digits (spaces ignored)");
  assert.equal(pastVisits(list, "", "me"), 0, "no mobile, no history");
});

test("rowActions per status (design 6.3): Seat only today, Open order only with a table", () => {
  assert.deepEqual(rowActions(res(), TODAY), { icons: ["cancel"], primary: "seat" }, "Booked today");
  assert.deepEqual(rowActions(res({ date: "2026-10-20" }), TODAY), { icons: ["cancel"], primary: null }, "Booked on another day has no primary");
  assert.deepEqual(rowActions(res({ status: "Seated", tableNo: "T-3" }), TODAY), { icons: ["complete", "cancel"], primary: "openOrder" }, "Seated with a table");
  assert.deepEqual(rowActions(res({ status: "Seated" }), TODAY), { icons: ["complete", "cancel"], primary: null }, "B26: Seated with no table has no primary");
  assert.deepEqual(rowActions(res({ status: "Completed" }), TODAY), { icons: [], primary: "bookAgain" }, "Completed");
  assert.deepEqual(rowActions(res({ status: "Cancelled" }), TODAY), { icons: ["restore"], primary: "bookAgain" }, "Cancelled");
});

test("detailActions (design 7): the grid and the footer's primary", () => {
  assert.deepEqual(detailActions(res()), { grid: ["cancel"], primary: "seat" }, "Booked (any date)");
  assert.deepEqual(detailActions(res({ date: "2026-10-25" })), { grid: ["cancel"], primary: "seat" }, "Seat stays for every date");
  assert.deepEqual(detailActions(res({ status: "Seated", tableNo: "T-3" })), { grid: ["complete", "cancel"], primary: "openOrder" }, "Seated with a table");
  assert.deepEqual(detailActions(res({ status: "Seated" })), { grid: ["complete", "cancel"], primary: null }, "Seated, no table");
  assert.deepEqual(detailActions(res({ status: "Completed" })), { grid: [], primary: "bookAgain" }, "Completed: no grid");
  assert.deepEqual(detailActions(res({ status: "Cancelled" })), { grid: ["restore"], primary: "bookAgain" }, "Cancelled");
});
