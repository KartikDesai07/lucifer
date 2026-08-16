import { test } from "node:test";
import assert from "node:assert/strict";
import { maskMobile } from "./utils";
import { MOBILE_MASK_CHAR, MOBILE_VISIBLE_PREFIX } from "./constants";
import { createCustomerSchema } from "./schemas/customer.schema";

// maskMobile is the one place that decides how much of a customer's mobile
// number anyone below admin may see (constants.ts: MOBILE_VISIBLE_PREFIX/
// MOBILE_MASK_CHAR). These pins follow the CONSTANTS, not hardcoded 5/"*", so
// a future change to either constant re-derives the expected output instead
// of silently drifting from what the source actually does.

test("maskMobile: a 10-digit number keeps exactly the first MOBILE_VISIBLE_PREFIX characters and masks the rest", () => {
  const mobile = "9876543210";
  const expected =
    mobile.slice(0, MOBILE_VISIBLE_PREFIX) +
    MOBILE_MASK_CHAR.repeat(mobile.length - MOBILE_VISIBLE_PREFIX);
  assert.equal(maskMobile(mobile), expected);
  // Anchor the derived expectation to the literal the spec calls out, so a
  // change to the constants is visible here as an intentional edit, not a
  // silent pass-through.
  assert.equal(maskMobile(mobile), "98765*****");
});

test("maskMobile: output length always equals input length", () => {
  for (const mobile of ["", "1", "1234", "12345", "123456", "9876543210", "+919876543210"]) {
    assert.equal(maskMobile(mobile).length, mobile.length);
  }
});

test("maskMobile: a masked 10-digit value still satisfies createCustomerSchema's mobile min-length", () => {
  const masked = maskMobile("9876543210");
  const result = createCustomerSchema.safeParse({
    name: "Priya",
    mobile: masked,
  });
  assert.equal(result.success, true, `expected masked value "${masked}" to satisfy the schema`);
});

test("maskMobile: fail-closed — a value AT the prefix length is masked entirely, never returned in full", () => {
  const mobile = "12345"; // length === MOBILE_VISIBLE_PREFIX
  assert.equal(mobile.length, MOBILE_VISIBLE_PREFIX);
  assert.equal(maskMobile(mobile), MOBILE_MASK_CHAR.repeat(5));
  assert.equal(maskMobile(mobile), "*****");
});

test("maskMobile: fail-closed — a value UNDER the prefix length is masked entirely", () => {
  assert.equal(maskMobile("1234"), "****");
});

test('maskMobile: "" (empty string) maps to ""', () => {
  assert.equal(maskMobile(""), "");
});

test("maskMobile: a longer value (e.g. a 13-char +91-prefixed number) still exposes only the first MOBILE_VISIBLE_PREFIX characters", () => {
  const mobile = "+919876543210";
  const masked = maskMobile(mobile);
  assert.equal(masked.slice(0, MOBILE_VISIBLE_PREFIX), mobile.slice(0, MOBILE_VISIBLE_PREFIX));
  assert.equal(masked.length, mobile.length);
});

test("maskMobile: no digit beyond the prefix survives anywhere in the output", () => {
  const mobile = "9876543210";
  const masked = maskMobile(mobile);
  const hiddenDigits = mobile.slice(MOBILE_VISIBLE_PREFIX);
  // The whole output beyond the prefix must be pure mask character — checking
  // the FULL masked string (not just its tail) also catches a bug where a
  // hidden digit leaked earlier than expected.
  for (const digit of new Set(hiddenDigits)) {
    assert.ok(!masked.slice(MOBILE_VISIBLE_PREFIX).includes(digit), `digit "${digit}" from beyond the prefix leaked into the masked output`);
  }
  assert.equal(masked.slice(MOBILE_VISIBLE_PREFIX), MOBILE_MASK_CHAR.repeat(hiddenDigits.length));
});
