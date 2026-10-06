import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NUMBER_RESET_MINUTES_MAX,
  NUMBER_RESET_MINUTES_MIN,
  isNumberResetMinutes,
  numberResetLabel,
  numberResetOptions,
  numberResetMinutesOf,
  slipDayKey,
  slipDayStart,
  TOKEN_READY_CLEAR_MINUTES_DEFAULT,
  TOKEN_READY_CLEAR_MINUTES_MAX,
  TOKEN_READY_CLEAR_MINUTES_MIN,
  TOKEN_READY_CLEAR_STEPS,
  isTokenReadyClearMinutes,
  tokenReadyClearLabel,
  tokenReadyClearMinutesOf,
  tokenReadyClearOptions,
} from "./slip-day";
import { cafeDateString, dayRange } from "./utils";

// Print customization S6: the "business day" a printed number belongs to. Pure, so every case is a
// plain value check; the property cases run over a SEEDED random sweep so a failing instant reproduces.

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
const SEEDED_INSTANTS = 10_000;
const FIRST_INSTANT_MS = Date.UTC(2020, 0, 1);
const LAST_INSTANT_MS = Date.UTC(2030, 11, 31);
const MINUTES_PER_DAY = 1440;
const IST_OFFSET_MS = 330 * MS_PER_MINUTE;

// mulberry32
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomInstants(seed: number, n: number): Date[] {
  const next = seeded(seed);
  return Array.from({ length: n }, () => new Date(FIRST_INSTANT_MS + Math.floor(next() * (LAST_INSTANT_MS - FIRST_INSTANT_MS))));
}
// Independent oracle: the IST calendar date by plain arithmetic on the +05:30 offset (does not use cafeDateString).
const istDay = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, "");

test("slipDayKey: reset 0 (the default) is exactly cafeDateString without dashes, either side of IST midnight", () => {
  const before = new Date("2026-07-15T18:29:59.999Z"); // 23:59:59.999 IST on the 15th
  const at = new Date("2026-07-15T18:30:00.000Z"); // 00:00:00.000 IST on the 16th
  assert.equal(slipDayKey(before), "20260715");
  assert.equal(slipDayKey(at), "20260716");
  assert.equal(slipDayKey(before, 0), "20260715");
  assert.equal(slipDayKey(at, 0), "20260716");
  assert.equal(slipDayKey(before), cafeDateString(before).replace(/-/g, ""));
  assert.equal(slipDayKey(at), cafeDateString(at).replace(/-/g, ""));
  assert.match(slipDayKey(at), /^\d{8}$/, "landmark: eight digits, no dashes");
});

test("slipDayKey: reset 0 equals cafeDateString (dashes stripped) and the independent IST oracle over 10,000 seeded instants in 2020-2030", () => {
  const instants = randomInstants(2026, SEEDED_INSTANTS);
  assert.equal(instants.length, SEEDED_INSTANTS);
  for (const d of instants) {
    const legacy = cafeDateString(d).replace(/-/g, "");
    assert.equal(slipDayKey(d, 0), legacy, d.toISOString());
    assert.equal(slipDayKey(d), legacy, d.toISOString());
    assert.equal(legacy, istDay(d.getTime()), `oracle agrees with cafeDateString @ ${d.toISOString()}`);
  }
});

test("slipDayKey: reset 240 (4:00 am) - 22:29:59.999Z is still the PREVIOUS IST day, 22:30:00.000Z is the same IST day", () => {
  // 22:30Z = 04:00 IST on the 16th. Just before it the business day is still the 15th.
  assert.equal(slipDayKey(new Date("2026-07-15T22:29:59.999Z"), 240), "20260715");
  assert.equal(slipDayKey(new Date("2026-07-15T22:30:00.000Z"), 240), "20260716");
  // vision guard: at reset 0 the first instant is already the 16th, so the shift is what moved it.
  assert.equal(slipDayKey(new Date("2026-07-15T22:29:59.999Z"), 0), "20260716");
  // the evening before the restart is that same IST date
  assert.equal(slipDayKey(new Date("2026-07-15T12:00:00Z"), 240), "20260715");
});

test("slipDayKey: for every restart time the day flips exactly at IST midnight + m and agrees with the oracle (seeded sweep)", () => {
  const next = seeded(7);
  for (const d of randomInstants(11, SEEDED_INSTANTS)) {
    const m = Math.floor(next() * MINUTES_PER_DAY);
    assert.equal(slipDayKey(d, m), istDay(d.getTime() - m * MS_PER_MINUTE), `${d.toISOString()} m=${m}`);
  }
});

test("slipDayStart: reset 0 is dayRange(d).start (IST midnight) for the default and an explicit 0", () => {
  for (const d of [new Date("2026-07-15T18:29:59.999Z"), new Date("2026-07-15T18:30:00.000Z"), ...randomInstants(3, SEEDED_INSTANTS)]) {
    assert.equal(slipDayStart(d, 0).getTime(), dayRange(d).start.getTime(), d.toISOString());
    assert.equal(slipDayStart(d).getTime(), dayRange(d).start.getTime(), d.toISOString());
  }
  assert.equal(slipDayStart(new Date("2026-07-15T18:30:00.000Z")).toISOString(), "2026-07-15T18:30:00.000Z", "landmark: IST midnight of the 16th");
});

test("slipDayStart: slipDayStart(d, m) <= d < slipDayStart(d, m) + 24h, and the key flips exactly at the start (seeded d and m)", () => {
  const next = seeded(99);
  for (const d of randomInstants(5, SEEDED_INSTANTS)) {
    const m = Math.floor(next() * MINUTES_PER_DAY);
    const start = slipDayStart(d, m).getTime();
    assert.ok(start <= d.getTime(), `start ${new Date(start).toISOString()} must not be after ${d.toISOString()} (m=${m})`);
    assert.ok(d.getTime() < start + MS_PER_DAY, `${d.toISOString()} must be inside the 24h window (m=${m})`);
    assert.equal(slipDayKey(new Date(start), m), slipDayKey(d, m), "the start instant belongs to the same business day");
    assert.notEqual(slipDayKey(new Date(start - 1), m), slipDayKey(d, m), "one ms earlier is the previous business day");
    assert.equal(slipDayKey(new Date(start + MS_PER_DAY - 1), m), slipDayKey(d, m), "the last ms of the window is still this day");
  }
});

test("slipDayStart: reset 240 at 02:00 IST begins the previous 04:00 IST; at 05:00 IST begins that same morning's 04:00 IST", () => {
  const twoAmIst = new Date("2026-07-15T20:30:00Z"); // 02:00 IST on the 16th
  assert.equal(slipDayStart(twoAmIst, 240).toISOString(), "2026-07-14T22:30:00.000Z", "04:00 IST on the 15th");
  const fiveAmIst = new Date("2026-07-15T23:30:00Z"); // 05:00 IST on the 16th
  assert.equal(slipDayStart(fiveAmIst, 240).toISOString(), "2026-07-15T22:30:00.000Z", "04:00 IST on the 16th");
});

test("isNumberResetMinutes: only a whole number 0..1439 qualifies", () => {
  for (const ok of [0, 1, 240, 1439, NUMBER_RESET_MINUTES_MIN, NUMBER_RESET_MINUTES_MAX]) assert.equal(isNumberResetMinutes(ok), true, String(ok));
  for (const bad of [undefined, null, Number.NaN, -1, 1440, 1.5, "240", "0", Infinity, -Infinity, [], {}, true]) {
    assert.equal(isNumberResetMinutes(bad), false, String(bad));
  }
  assert.equal(NUMBER_RESET_MINUTES_MIN, 0);
  assert.equal(NUMBER_RESET_MINUTES_MAX, 1439);
});

test("numberResetMinutesOf: a valid stored value is itself, anything unusable is 0 (midnight), and it never throws", () => {
  for (const ok of [0, 1439, 240, 30, 1]) assert.equal(numberResetMinutesOf(ok), ok, String(ok));
  for (const bad of [undefined, null, Number.NaN, -1, 1440, 1.5, "240", Infinity, {}, [], true]) {
    assert.equal(numberResetMinutesOf(bad), 0, String(bad));
  }
  // a prototype-less object has no toString: it must still not throw
  assert.equal(numberResetMinutesOf(Object.create(null)), 0);
});

// ── The settings picker: options and labels ──────────────────────────────────

const HALF_HOUR_STEPS = 48;
const LAST_STEP_MINUTES = 1410; // 11:30 pm

test("numberResetOptions(): 48 half-hour steps from 0 to 1410, ascending, each a valid restart time", () => {
  const options = numberResetOptions();
  assert.equal(options.length, HALF_HOUR_STEPS);
  assert.deepEqual(options, Array.from({ length: HALF_HOUR_STEPS }, (_, i) => i * 30));
  assert.equal(options[0], 0);
  assert.equal(options[options.length - 1], LAST_STEP_MINUTES);
  assert.ok(options.every(isNumberResetMinutes));
  assert.deepEqual(numberResetOptions(undefined), options);
  assert.deepEqual(numberResetOptions(240), options, "an on-step stored value adds nothing");
});

test("numberResetOptions(stored): a valid off-step value is inserted in order; an invalid one is ignored; never a duplicate", () => {
  // 270 (4:30 am) is itself a half-hour step, so the off-step value used here is 275 (4:35 am).
  assert.deepEqual(numberResetOptions(270), numberResetOptions(), "landmark: 270 is on-step and adds nothing");
  const withOff = numberResetOptions(275);
  assert.equal(withOff.length, HALF_HOUR_STEPS + 1, "landmark: it really was added");
  assert.equal(withOff[withOff.indexOf(275) - 1], 270);
  assert.equal(withOff[withOff.indexOf(275) + 1], 300);
  assert.deepEqual(withOff, [...withOff].sort((a, b) => a - b));
  assert.equal(new Set(withOff).size, withOff.length);
  assert.deepEqual(numberResetOptions(1439).slice(-2), [LAST_STEP_MINUTES, 1439], "the top of the range goes last");
  assert.deepEqual(numberResetOptions(1), [0, 1, ...numberResetOptions().slice(1)], "and the first minute goes second");
  for (const bad of [1500, 1.5, -1, 1440, Number.NaN, undefined]) {
    assert.deepEqual(numberResetOptions(bad as number | undefined), numberResetOptions(), String(bad));
  }
});

test("numberResetLabel: 12-hour clock, midnight spelled out, every option distinct", () => {
  const cases: Array<[number, string]> = [
    [0, "12:00 am (midnight)"],
    [30, "12:30 am"],
    [60, "1:00 am"],
    [270, "4:30 am"],
    [720, "12:00 pm"],
    [750, "12:30 pm"],
    [780, "1:00 pm"],
    [1410, "11:30 pm"],
    [1439, "11:59 pm"],
  ];
  for (const [minutes, label] of cases) assert.equal(numberResetLabel(minutes), label, String(minutes));
  const labels = numberResetOptions(275).map(numberResetLabel);
  assert.equal(numberResetLabel(275), "4:35 am", "an off-step stored value still reads as a clock time");
  assert.equal(new Set(labels).size, labels.length, "no two options read the same");
  assert.equal(numberResetLabel(Number.NaN), "12:00 am (midnight)", "an unusable value reads as the midnight default");
});

// ── S8: how long a Ready token stays on the token list ───────────────────────

test("token ready-clear constants: 1..120 minutes, default 10, the picker's eight steps", () => {
  assert.equal(TOKEN_READY_CLEAR_MINUTES_MIN, 1);
  assert.equal(TOKEN_READY_CLEAR_MINUTES_MAX, 120);
  assert.equal(TOKEN_READY_CLEAR_MINUTES_DEFAULT, 10);
  assert.deepEqual([...TOKEN_READY_CLEAR_STEPS], [2, 5, 10, 15, 20, 30, 45, 60]);
  assert.ok(TOKEN_READY_CLEAR_STEPS.includes(TOKEN_READY_CLEAR_MINUTES_DEFAULT), "the default is one of the offered steps");
  assert.ok(TOKEN_READY_CLEAR_STEPS.every(isTokenReadyClearMinutes), "every offered step is a valid value");
});

test("isTokenReadyClearMinutes: only a whole number 1..120 qualifies (0 and 121 are out, 1 and 120 are in)", () => {
  for (const ok of [1, 2, 10, 60, 119, 120, TOKEN_READY_CLEAR_MINUTES_MIN, TOKEN_READY_CLEAR_MINUTES_MAX]) assert.equal(isTokenReadyClearMinutes(ok), true, String(ok));
  for (const bad of [undefined, null, 0, -1, 121, 1.5, Number.NaN, "10", "0", Infinity, -Infinity, [], {}, true]) {
    assert.equal(isTokenReadyClearMinutes(bad), false, String(bad));
  }
  assert.equal(isNumberResetMinutes(0), true, "vision guard: 0 is a valid RESTART time but not a valid CLEAR time");
  assert.equal(isTokenReadyClearMinutes(0), false);
});

test("tokenReadyClearMinutesOf: a valid stored value is itself, anything unusable is 10, and it never throws", () => {
  for (const ok of [1, 2, 7, 10, 25, 120]) assert.equal(tokenReadyClearMinutesOf(ok), ok, String(ok));
  for (const bad of [undefined, null, 0, -1, 121, 1.5, Number.NaN, "20", Infinity, {}, [], true]) {
    assert.equal(tokenReadyClearMinutesOf(bad), 10, String(bad));
  }
  assert.equal(tokenReadyClearMinutesOf(Object.create(null)), 10);
  assert.notEqual(tokenReadyClearMinutesOf(undefined), 0, "the default is never 0 (a 0 clear time would hide every Ready token at once)");
});

test("tokenReadyClearOptions(): the eight steps ascending; an on-step stored value adds nothing; the result is a fresh array", () => {
  const options = tokenReadyClearOptions();
  assert.deepEqual(options, [2, 5, 10, 15, 20, 30, 45, 60]);
  assert.deepEqual(tokenReadyClearOptions(undefined), options);
  assert.deepEqual(tokenReadyClearOptions(15), options, "an on-step stored value adds nothing");
  options.push(999);
  assert.deepEqual(tokenReadyClearOptions(), [2, 5, 10, 15, 20, 30, 45, 60], "mutating a returned list does not change the next one or the steps");
  assert.equal(TOKEN_READY_CLEAR_STEPS.length, 8);
});

test("tokenReadyClearOptions(stored): a valid off-step value is kept and sorted in; an invalid one is ignored; never a duplicate", () => {
  const withOff = tokenReadyClearOptions(25);
  assert.deepEqual(withOff, [2, 5, 10, 15, 20, 25, 30, 45, 60], "25 lands between 20 and 30");
  assert.equal(withOff.length, TOKEN_READY_CLEAR_STEPS.length + 1, "landmark: it really was added");
  assert.equal(new Set(withOff).size, withOff.length);
  assert.deepEqual(tokenReadyClearOptions(1), [1, 2, 5, 10, 15, 20, 30, 45, 60], "the bottom of the range goes first");
  assert.deepEqual(tokenReadyClearOptions(120).slice(-2), [60, 120], "the top of the range goes last");
  assert.deepEqual(tokenReadyClearOptions(61).slice(-2), [60, 61]);
  for (const bad of [0, 121, 1.5, -1, Number.NaN, undefined]) {
    assert.deepEqual(tokenReadyClearOptions(bad as number | undefined), tokenReadyClearOptions(), String(bad));
  }
});

test("tokenReadyClearLabel: '1 minute', 'N minutes'; every option distinct; an unusable value reads as the default", () => {
  assert.equal(tokenReadyClearLabel(1), "1 minute");
  assert.equal(tokenReadyClearLabel(2), "2 minutes");
  assert.equal(tokenReadyClearLabel(10), "10 minutes");
  assert.equal(tokenReadyClearLabel(60), "60 minutes");
  assert.equal(tokenReadyClearLabel(25), "25 minutes", "an off-step stored value still reads cleanly");
  assert.equal(tokenReadyClearLabel(120), "120 minutes");
  const labels = tokenReadyClearOptions(25).map(tokenReadyClearLabel);
  assert.equal(new Set(labels).size, labels.length, "no two options read the same");
  assert.equal(tokenReadyClearLabel(Number.NaN), "10 minutes");
  assert.equal(tokenReadyClearLabel(0), "10 minutes");
});
