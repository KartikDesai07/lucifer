import { test } from "node:test";
import assert from "node:assert/strict";

import { deadlineLine, MONTHS_SHORT } from "@/components/public/rewards/reward-clock";

const MS_PER_MINUTE = 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * MS_PER_MINUTE;
const ONE_DAY = 24 * 60 * MS_PER_MINUTE;

// NOW is 12:00 IST on 9 Nov 2026 (06:30 UTC).
const NOW = Date.UTC(2026, 10, 9, 6, 30);
// An instant given as IST wall-clock time (month is 0-based).
const ist = (year: number, month: number, day: number, hour: number, minute: number): number =>
  Date.UTC(year, month, day, hour, minute) - IST_OFFSET_MS;

test("deadlineLine: several days ahead counts IST calendar days", () => {
  assert.equal(deadlineLine("scratch", ist(2026, 10, 12, 23, 59), NOW), "Scratch by 12 Nov (3 days left)");
  assert.equal(deadlineLine("use", ist(2026, 10, 12, 23, 59), NOW), "Use by 12 Nov (3 days left)");
});

test("deadlineLine: tomorrow is one day left, the same IST day is the last day", () => {
  assert.equal(deadlineLine("scratch", ist(2026, 10, 10, 9, 0), NOW), "Scratch by 10 Nov (1 day left)");
  assert.equal(deadlineLine("scratch", ist(2026, 10, 9, 23, 59), NOW), "Scratch by 9 Nov (last day)");
});

test("deadlineLine: IST midnight belongs to the NEXT cafe day (a UTC date would say 12 Nov)", () => {
  // 00:00 IST on 13 Nov is 18:30 UTC on 12 Nov.
  assert.equal(deadlineLine("scratch", ist(2026, 10, 13, 0, 0), NOW), "Scratch by 13 Nov (4 days left)");
});

test("deadlineLine: the deadline instant itself is still valid; one millisecond later is expired", () => {
  const deadline = ist(2026, 10, 9, 18, 0);
  assert.equal(deadlineLine("scratch", deadline, deadline), "Scratch by 9 Nov (last day)");
  assert.equal(deadlineLine("scratch", deadline, deadline + 1), "Expired on 9 Nov");
  assert.equal(deadlineLine("use", ist(2026, 10, 1, 10, 0), NOW), "Expired on 1 Nov");
});

test("deadlineLine: a year boundary and the month table", () => {
  const now = ist(2026, 11, 30, 10, 0);
  assert.equal(deadlineLine("use", now + 3 * ONE_DAY, now), "Use by 2 Jan (3 days left)");
  assert.equal(MONTHS_SHORT.length, 12);
  assert.equal(MONTHS_SHORT[0], "Jan");
  assert.equal(MONTHS_SHORT[11], "Dec");
});
