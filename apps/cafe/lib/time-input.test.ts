// No-native-pickers slice T (2026-10-11) — the pure "HH:mm" <-> 12-hour helpers
// behind the shared TimePicker. The stored shape stays the schemas' 24 h
// zero-padded "HH:mm".
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  defaultTimeParts,
  formatTimeInput,
  minuteOptions,
  parseTimeInput,
  timeLabel,
  withTimePart,
} from "./time-input";

const CASES: Array<[string, { hour12: number; minute: number; period: "AM" | "PM" }, string]> = [
  ["00:00", { hour12: 12, minute: 0, period: "AM" }, "12:00 AM"],
  ["00:05", { hour12: 12, minute: 5, period: "AM" }, "12:05 AM"],
  ["07:30", { hour12: 7, minute: 30, period: "AM" }, "7:30 AM"],
  ["11:59", { hour12: 11, minute: 59, period: "AM" }, "11:59 AM"],
  ["12:00", { hour12: 12, minute: 0, period: "PM" }, "12:00 PM"],
  ["12:45", { hour12: 12, minute: 45, period: "PM" }, "12:45 PM"],
  ["13:00", { hour12: 1, minute: 0, period: "PM" }, "1:00 PM"],
  ["19:30", { hour12: 7, minute: 30, period: "PM" }, "7:30 PM"],
  ["23:59", { hour12: 11, minute: 59, period: "PM" }, "11:59 PM"],
];

for (const [stored, parts, label] of CASES) {
  test(`time-input: ${stored} <-> ${label}`, () => {
    assert.deepEqual(parseTimeInput(stored), parts);
    assert.equal(formatTimeInput(parts), stored, "round-trips to the stored 24 h shape");
    assert.equal(timeLabel(stored), label);
  });
}

test("parseTimeInput: bad input is null, never a bogus time", () => {
  for (const raw of ["", "7:30", "24:00", "12:60", "ab:cd", "19:30:00", "19-30", " 19:30", "1930", "7:30 PM"]) {
    assert.equal(parseTimeInput(raw), null, `expected null for "${raw}"`);
    assert.equal(timeLabel(raw), "", `expected an empty label for "${raw}"`);
  }
});

test("minuteOptions: 00..55 by 5, plus an off-step current minute in order", () => {
  const steps = minuteOptions(null);
  assert.equal(steps.length, 12);
  assert.deepEqual([steps[0], steps[1], steps[11]], [0, 5, 55]);
  assert.deepEqual(minuteOptions(30), steps, "an on-step minute adds nothing");
  const withOffStep = minuteOptions(32);
  assert.equal(withOffStep.length, 13);
  assert.deepEqual(withOffStep.slice(6, 9), [30, 32, 35], "7:32 keeps its own minute, in order");
  assert.deepEqual(minuteOptions(59).slice(-2), [55, 59]);
  assert.deepEqual(minuteOptions(60), steps, "an out-of-range minute is ignored");
});

test("defaultTimeParts: current hour + the next 5-minute step, rolling over the hour and midnight", () => {
  assert.deepEqual(defaultTimeParts(new Date(2026, 9, 11, 14, 32)), { hour12: 2, minute: 35, period: "PM" });
  assert.deepEqual(defaultTimeParts(new Date(2026, 9, 11, 14, 30)), { hour12: 2, minute: 30, period: "PM" });
  assert.deepEqual(defaultTimeParts(new Date(2026, 9, 11, 14, 58)), { hour12: 3, minute: 0, period: "PM" });
  assert.deepEqual(defaultTimeParts(new Date(2026, 9, 11, 23, 58)), { hour12: 12, minute: 0, period: "AM" });
});

test("withTimePart: keeps the other parts of a real value (an off-step 7:32 survives an hour tap)", () => {
  const now = new Date(2026, 9, 11, 10, 0);
  assert.equal(withTimePart("07:32", { hour12: 9 }, now), "09:32");
  assert.equal(withTimePart("07:32", { period: "PM" }, now), "19:32");
  assert.equal(withTimePart("19:30", { minute: 45 }, now), "19:45");
  assert.equal(withTimePart("00:00", { period: "PM" }, now), "12:00");
});

test("withTimePart: a first tap on an empty value fills the rest from now, so one tap gives a real time", () => {
  const now = new Date(2026, 9, 11, 14, 32); // default = 2:35 PM
  assert.equal(withTimePart("", { hour12: 7 }, now), "19:35");
  assert.equal(withTimePart("", { minute: 10 }, now), "14:10");
  assert.equal(withTimePart("", { period: "AM" }, now), "02:35");
  assert.equal(withTimePart("junk", { hour12: 7 }, now), "19:35", "an unreadable value is treated as empty");
});
