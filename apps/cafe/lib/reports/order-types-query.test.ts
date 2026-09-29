// parseHourDetailQuery — pure, DB-free. Pins the hour/type validation,
// including the Object.hasOwn prototype-key guard (never `in` / a plain
// lookup), mirroring items/detail's own query-schema test discipline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHourDetailQuery } from "@/lib/reports/order-types-query";

function sp(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

test("valid hour, no type -> type null", () => {
  const result = parseHourDetailQuery(sp({ hour: "9" }));
  assert.deepEqual(result, { hour: 9, type: null });
});

test('hour "24" is out of range -> error', () => {
  const result = parseHourDetailQuery(sp({ hour: "24" }));
  assert.deepEqual(result, { error: "Pick an hour between 0 and 23" });
});

test('hour "-1" fails the digit regex -> error', () => {
  const result = parseHourDetailQuery(sp({ hour: "-1" }));
  assert.ok("error" in result);
});

test('hour "1.5" fails the digit regex -> error', () => {
  const result = parseHourDetailQuery(sp({ hour: "1.5" }));
  assert.ok("error" in result);
});

test('hour "" (empty string) -> error', () => {
  const result = parseHourDetailQuery(sp({ hour: "" }));
  assert.ok("error" in result);
});

test("hour missing entirely -> error", () => {
  const result = parseHourDetailQuery(new URLSearchParams());
  assert.ok("error" in result);
});

test('hour "08" (leading zero) parses to 8', () => {
  const result = parseHourDetailQuery(sp({ hour: "08" }));
  assert.deepEqual(result, { hour: 8, type: null });
});

test('type "" (empty string) -> null, same as absent', () => {
  const result = parseHourDetailQuery(sp({ hour: "5", type: "" }));
  assert.deepEqual(result, { hour: 5, type: null });
});

test("an unknown type value -> error", () => {
  const result = parseHourDetailQuery(sp({ hour: "5", type: "delivery" }));
  assert.deepEqual(result, { error: "Unknown order type" });
});

test('a valid type ("dine-in") passes through', () => {
  const result = parseHourDetailQuery(sp({ hour: "5", type: "dine-in" }));
  assert.deepEqual(result, { hour: 5, type: "dine-in" });
});

test('prototype key "constructor" is rejected, never treated as a known type', () => {
  const result = parseHourDetailQuery(sp({ hour: "5", type: "constructor" }));
  assert.deepEqual(result, { error: "Unknown order type" });
});

test('prototype key "__proto__" is rejected', () => {
  const result = parseHourDetailQuery(sp({ hour: "5", type: "__proto__" }));
  assert.deepEqual(result, { error: "Unknown order type" });
});

test('prototype key "toString" is rejected', () => {
  const result = parseHourDetailQuery(sp({ hour: "5", type: "toString" }));
  assert.deepEqual(result, { error: "Unknown order type" });
});
