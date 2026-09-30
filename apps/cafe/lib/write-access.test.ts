import { test } from "node:test";
import assert from "node:assert/strict";

import { STAFF_PRODUCT_FIELDS, isStaffScopedUpdate } from "./write-access";

// Menu redesign (owner, 2026-09-30) — R1's staff-scoped PUT allow-list.
// STAFF_PRODUCT_FIELDS itself is the fence's DATA half; isStaffScopedUpdate is
// the pure predicate crud-route.ts's PUT handler calls.

test("STAFF_PRODUCT_FIELDS is exactly ['available']", () => {
  assert.deepEqual([...STAFF_PRODUCT_FIELDS], ["available"]);
});

test("isStaffScopedUpdate: {available} against ['available'] is allowed", () => {
  assert.equal(isStaffScopedUpdate({ available: false }, STAFF_PRODUCT_FIELDS), true);
});

test("isStaffScopedUpdate: {available, price} is refused — every parsed key must be in the allow-list", () => {
  assert.equal(isStaffScopedUpdate({ available: false, price: 10 }, STAFF_PRODUCT_FIELDS), false);
});

test("isStaffScopedUpdate: {price} alone is refused", () => {
  assert.equal(isStaffScopedUpdate({ price: 10 }, STAFF_PRODUCT_FIELDS), false);
});

test("isStaffScopedUpdate: an empty body (0 keys) is refused — there is nothing a staff PUT could mean by sending no fields", () => {
  assert.equal(isStaffScopedUpdate({}, STAFF_PRODUCT_FIELDS), false);
});

test("isStaffScopedUpdate: a non-object body (null, array, primitive) is refused", () => {
  assert.equal(isStaffScopedUpdate(null, STAFF_PRODUCT_FIELDS), false);
  assert.equal(isStaffScopedUpdate(undefined, STAFF_PRODUCT_FIELDS), false);
  assert.equal(isStaffScopedUpdate("available", STAFF_PRODUCT_FIELDS), false);
});

test("isStaffScopedUpdate: an empty allow-list refuses everything, even an empty-looking match", () => {
  assert.equal(isStaffScopedUpdate({ available: true }, []), false);
});

// Object.hasOwn, not `in` — a prototype key must not pose as a present field.
test("isStaffScopedUpdate: a prototype key ('constructor') cannot pose as an allowed field", () => {
  const allowed = ["constructor"] as const;
  // Object.keys() never enumerates inherited/prototype properties on a plain
  // object literal in the first place, so a payload that never explicitly SET
  // "constructor" as its own key is correctly refused here — this proves the
  // function reads OWN keys only, not `in`/prototype membership.
  assert.equal(isStaffScopedUpdate({}, allowed), false);
  assert.equal(isStaffScopedUpdate({ constructor: "x" }, allowed), true);
});
