import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AFTERNOON_FROM_HOUR,
  EVENING_FROM_HOUR,
  MORNING_FROM_HOUR,
  dayPartOf,
  greetingFor,
} from "./brand-time";

// Local-time Dates (new Date(y, m, d, h, min)) — the helpers read getHours(),
// so constructing in local time keeps these independent of the machine's zone.
const at = (hour: number, minute = 0) => new Date(2026, 8, 26, hour, minute);

test("dayPartOf: each boundary hour starts its own part, and the minute before stays in the previous one", () => {
  assert.equal(dayPartOf(at(MORNING_FROM_HOUR)), "morning");
  assert.equal(dayPartOf(at(MORNING_FROM_HOUR - 1, 59)), "evening", "04:59 is still the night's service, not morning");
  assert.equal(dayPartOf(at(AFTERNOON_FROM_HOUR)), "afternoon");
  assert.equal(dayPartOf(at(AFTERNOON_FROM_HOUR - 1, 59)), "morning");
  assert.equal(dayPartOf(at(EVENING_FROM_HOUR)), "evening");
  assert.equal(dayPartOf(at(EVENING_FROM_HOUR - 1, 59)), "afternoon");
});

test("dayPartOf: a late-closing kitchen after midnight is still in the evening", () => {
  assert.equal(dayPartOf(at(0)), "evening");
  assert.equal(dayPartOf(at(1, 30)), "evening");
  assert.equal(dayPartOf(at(23, 59)), "evening");
});

test("greetingFor: reads as a full sentence for each part of the day", () => {
  assert.equal(greetingFor(at(9)), "Good morning.");
  assert.equal(greetingFor(at(14)), "Good afternoon.");
  assert.equal(greetingFor(at(20)), "Good evening.");
});
