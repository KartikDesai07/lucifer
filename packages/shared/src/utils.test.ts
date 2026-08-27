import { test } from "node:test";
import assert from "node:assert/strict";
import { maskMobile, orderItemLabel, orderLineKey } from "./utils";
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


// -- orderLineKey + orderItemLabel: variations are part of a line's IDENTITY ----
// A Small and a Large of the same dish, same round, same qty are NOT
// interchangeable: a void echo must not be able to take the wrong one off a tab,
// and the two must not fold into one cart line. The variation is appended to the
// key ONLY when the line has one, so a key for an item sold one way stays
// byte-identical to the pre-variations format and a tab opened before this
// shipped keeps matching its own echoes across the deploy.

// The key's own separators, referenced by code point: they are ASCII record/unit
// separators, and a literal one in source would be invisible to a reader.
const LINE_SEP = String.fromCharCode(30);
const MOD_SEP = String.fromCharCode(31);

test("orderLineKey: a no-variation line keeps the EXACT pre-variations format (a tab opened before the deploy must keep matching its void echoes)", () => {
  const key = orderLineKey({
    productId: "p1",
    kotRound: 2,
    qty: 3,
    instructions: "less sugar",
    modifiers: ["b", "a"],
  });
  // productId, round, qty, instructions, sorted modifiers -- and nothing more.
  assert.equal(key, ["p1", "2", "3", "less sugar", "a" + MOD_SEP + "b"].join(LINE_SEP));
});

test("orderLineKey: an absent variation and an EMPTY-STRING variation produce the same key (an empty value must not append a trailing separator)", () => {
  const base = { productId: "p1", qty: 1, kotRound: 1 };
  assert.equal(orderLineKey(base), orderLineKey({ ...base, variation: "" }));
});

test("orderLineKey: a line WITH a variation is a different line from the same line without one", () => {
  const base = { productId: "p1", qty: 1, kotRound: 1 };
  assert.notEqual(orderLineKey(base), orderLineKey({ ...base, variation: "Large" }));
});

test("orderLineKey: two sizes of the same dish are DIFFERENT lines -- this is what stops a void taking the wrong one", () => {
  const base = { productId: "p1", qty: 1, kotRound: 1 };
  assert.notEqual(
    orderLineKey({ ...base, variation: "Small" }),
    orderLineKey({ ...base, variation: "Large" }),
  );
});

test("orderItemLabel: renders the variation in parentheses, and the bare name without one", () => {
  assert.equal(orderItemLabel({ name: "Cold Coffee", variation: "Large" }), "Cold Coffee (Large)");
  assert.equal(orderItemLabel({ name: "Cold Coffee" }), "Cold Coffee");
  // An empty variation means "sold one way", not an empty pair of brackets on a bill.
  assert.equal(orderItemLabel({ name: "Cold Coffee", variation: "" }), "Cold Coffee");
});
