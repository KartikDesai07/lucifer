import { test } from "node:test";
import assert from "node:assert/strict";

import { settingsSchema, updateSettingsSchema } from "./settings.schema";
import { UPI_RULES_MAX, UPI_RULE_UPTO_MAX } from "../print-qr";

// The UPI amount slabs on Settings (print-qr.ts upiRulesOf is the lenient reader; this is the strict write gate).
// Tested through the PUT partial: a patch of only upiRules, exactly what the Business form sends.
const SMALL = "small.bills@ybl";
const MID = "mid.bills@paytm";
const parse = (upiRules: unknown) => updateSettingsSchema.safeParse({ upiRules });
const messages = (upiRules: unknown): string[] => {
  const r = parse(upiRules);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

test("upiRules: a valid list of slabs passes, with each ID trimmed", () => {
  const r = parse([{ upTo: 500, upiId: ` ${SMALL} ` }, { upTo: 2000, upiId: MID }]);
  assert.equal(r.success, true);
  if (r.success) assert.deepEqual(r.data.upiRules, [{ upTo: 500, upiId: SMALL }, { upTo: 2000, upiId: MID }]);
  assert.equal(parse([]).success, true);
});

test("upiRules: absent is fine (both on the PUT partial and the full settings shape)", () => {
  assert.equal(updateSettingsSchema.safeParse({}).success, true);
  assert.equal(settingsSchema.shape.upiRules.safeParse(undefined).success, true);
});

test("upiRules: 5 slabs pass, 6 are refused", () => {
  const slabs = (n: number) => Array.from({ length: n }, (_, i) => ({ upTo: (i + 1) * 100, upiId: SMALL }));
  assert.equal(parse(slabs(UPI_RULES_MAX)).success, true);
  assert.equal(parse(slabs(UPI_RULES_MAX + 1)).success, false);
});

test("upiRules: two slabs with the same amount are refused with a plain message", () => {
  assert.ok(messages([{ upTo: 500, upiId: SMALL }, { upTo: 500, upiId: MID }]).includes("Two slabs have the same amount"));
});

test("upiRules: a bad or empty UPI ID is refused on that slab", () => {
  for (const upiId of ["", "no-at-sign", "a@1", "with space@okaxis"]) {
    const r = parse([{ upTo: 500, upiId }]);
    assert.equal(r.success, false, JSON.stringify(upiId));
    if (!r.success) assert.deepEqual(r.error.issues[0].path.slice(0, 3), ["upiRules", 0, "upiId"]);
  }
});

test("upiRules: the amount must be a whole number from 1 to the ceiling", () => {
  for (const upTo of [0, -1, 10.5, Number.NaN, UPI_RULE_UPTO_MAX + 1, "500", null]) {
    assert.equal(parse([{ upTo, upiId: SMALL }]).success, false, String(upTo));
  }
  for (const upTo of [1, 500, UPI_RULE_UPTO_MAX]) assert.equal(parse([{ upTo, upiId: SMALL }]).success, true, String(upTo));
});

test("upiRules: a slab carrying an unknown key is refused (strict)", () => {
  assert.equal(parse([{ upTo: 500, upiId: SMALL, label: "x" }]).success, false);
});
