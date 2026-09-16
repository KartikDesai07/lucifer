import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSeeFullMobile,
  maskCustomer,
  maskCustomers,
  stripMobileForRole,
} from "./customer-privacy";
import { maskMobile } from "@pos/shared/utils";

// Only role "admin" may see a customer's real mobile number. Masking is
// applied server-side at the response edge, and the helpers must NEVER
// mutate their input: a customer doc/list reaching these helpers may be the
// shared in-process cache entry (packages/shared/src/cache.ts) that the NEXT
// request — possibly an admin's — will read straight out of the cache. If any
// of these helpers wrote onto its input, a staff request would permanently
// stamp stars onto the cached entry and an admin loading the SAME cached page
// afterward would see masked digits instead of the real number.

const snapshot = <T>(value: T): T => structuredClone(value);

// ── canSeeFullMobile ──────────────────────────────────────────────────────────

test("canSeeFullMobile: true only for admin", () => {
  assert.equal(canSeeFullMobile("admin"), true);
});

test("canSeeFullMobile: false for staff, undefined, empty string, and an unknown role (fail-closed)", () => {
  assert.equal(canSeeFullMobile("staff"), false);
  assert.equal(canSeeFullMobile(undefined), false);
  assert.equal(canSeeFullMobile(""), false);
  assert.equal(canSeeFullMobile("manager"), false);
});

// ── maskCustomer ──────────────────────────────────────────────────────────────

test("maskCustomer: staff gets the masked number", () => {
  const doc = { name: "Priya", mobile: "9876543210" };
  const result = maskCustomer(doc, "staff");
  assert.equal(result.mobile, maskMobile("9876543210"));
  assert.equal(result.mobile, "98765*****");
});

test("maskCustomer: admin gets the value unchanged", () => {
  const doc = { name: "Priya", mobile: "9876543210" };
  const result = maskCustomer(doc, "admin");
  assert.equal(result.mobile, "9876543210");
});

test("maskCustomer: a doc whose mobile is absent passes through untouched", () => {
  const doc: { name: string; mobile?: string } = { name: "Priya" };
  const result = maskCustomer(doc, "staff");
  assert.deepEqual(result, doc);
  assert.ok(!("mobile" in result));
});

test("maskCustomer: a doc whose mobile is not a string (e.g. null) passes through untouched", () => {
  const doc = { name: "Priya", mobile: null as unknown as string };
  const result = maskCustomer(doc, "staff");
  assert.deepEqual(result, doc);
  assert.equal(result.mobile, null);
});

// ── Non-mutation pins (the important ones) ───────────────────────────────────

test("maskCustomer: the ORIGINAL object still holds the real number after masking for staff", () => {
  const doc = { name: "Priya", mobile: "9876543210" };
  const before = snapshot(doc);
  maskCustomer(doc, "staff");
  assert.deepEqual(doc, before, "maskCustomer must not mutate its input document");
  assert.equal(doc.mobile, "9876543210");
});

test("maskCustomers: the ORIGINAL array/elements still hold the real numbers after masking for staff", () => {
  const docs = [
    { name: "Priya", mobile: "9876543210" },
    { name: "Rahul", mobile: "8765432109" },
  ];
  const before = snapshot(docs);
  maskCustomers(docs, "staff");
  assert.deepEqual(docs, before, "maskCustomers must not mutate the original array or its elements");
  assert.equal(docs[0].mobile, "9876543210");
  assert.equal(docs[1].mobile, "8765432109");
});

test("maskCustomers: returns a DIFFERENT array reference and DIFFERENT element references when masking", () => {
  const docs = [
    { name: "Priya", mobile: "9876543210" },
    { name: "Rahul", mobile: "8765432109" },
  ];
  const result = maskCustomers(docs, "staff");
  assert.notEqual(result, docs, "masking must return a new array, not the cached one");
  assert.notEqual(result[0], docs[0], "masking must return new element objects, not the cached ones");
  assert.notEqual(result[1], docs[1]);
});

// The cache-poisoning regression: this is the exact scenario the non-mutation
// contract exists to prevent. If maskCustomer/maskCustomers ever started
// writing onto their input (e.g. `doc.mobile = maskMobile(doc.mobile)`
// instead of returning a copy), this test fails because the SAME list object,
// re-masked for admin, would come back with stars baked in from the staff
// call that ran first against the shared cache entry.
test("REGRESSION (cache poisoning): masking a list as staff, then masking the SAME original list as admin, still returns real numbers", () => {
  const cachedList = [
    { name: "Priya", mobile: "9876543210" },
    { name: "Rahul", mobile: "8765432109" },
  ];

  const staffView = maskCustomers(cachedList, "staff");
  assert.equal(staffView[0].mobile, "98765*****");
  assert.equal(staffView[1].mobile, "87654*****");

  // A later request — possibly hitting the SAME in-process cache entry —
  // asks for the admin view of the identical underlying list.
  const adminView = maskCustomers(cachedList, "admin");
  assert.equal(adminView[0].mobile, "9876543210", "admin must still see the real number after a staff request masked the same list");
  assert.equal(adminView[1].mobile, "8765432109");
});

test("maskCustomers: for admin returns the docs unchanged (real numbers intact)", () => {
  const docs = [
    { name: "Priya", mobile: "9876543210" },
    { name: "Rahul", mobile: "8765432109" },
  ];
  const result = maskCustomers(docs, "admin");
  assert.deepEqual(result, docs);
  assert.equal(result[0].mobile, "9876543210");
  assert.equal(result[1].mobile, "8765432109");
});

// ── stripMobileForRole ────────────────────────────────────────────────────────

test("stripMobileForRole: staff — mobile is dropped from the update, name/notes stay intact", () => {
  const update = { name: "Priya", mobile: "9876543210", notes: "VIP" as const };
  const result = stripMobileForRole(update, "staff");
  assert.equal("mobile" in result, false, "the staff update must not carry a mobile KEY at all, not just an undefined value");
  assert.equal(result.name, "Priya");
  assert.equal(result.notes, "VIP");
});

test("stripMobileForRole: admin — the update is returned with mobile still present", () => {
  const update = { name: "Priya", mobile: "9876543210", notes: "VIP" as const };
  const result = stripMobileForRole(update, "admin");
  assert.equal("mobile" in result, true);
  assert.equal(result.mobile, "9876543210");
});

test("stripMobileForRole: an update with no mobile key is returned unchanged for both roles", () => {
  const update: { name: string; notes: "Regular"; mobile?: string } = { name: "Priya", notes: "Regular" };
  const staffResult = stripMobileForRole(update, "staff");
  const adminResult = stripMobileForRole(update, "admin");
  assert.deepEqual(staffResult, update);
  assert.deepEqual(adminResult, update);
  assert.equal("mobile" in staffResult, false);
});

// The real-world hazard: a staff client only ever HAS the masked string (it
// never sees the real number), so a `mobile` field arriving on a staff-
// submitted update can only be that mask echoed back by the edit form. Mobile
// is a unique-indexed field — writing "98765*****" over it would destroy a
// real number the server cannot re-derive from anything else. stripMobileForRole
// must drop it exactly like any other staff-submitted mobile value.
test("stripMobileForRole: a staff-submitted MASK STRING must not reach the update payload — it would overwrite a unique-indexed field", () => {
  const maskedEcho = maskMobile("9876543210"); // "98765*****" — what a staff client actually holds
  const update = { name: "Priya", mobile: maskedEcho };
  const result = stripMobileForRole(update, "staff");
  assert.equal("mobile" in result, false, `the mask string "${maskedEcho}" must be dropped, never persisted as the real mobile`);
});

test("stripMobileForRole: does not mutate its input update object", () => {
  const update = { name: "Priya", mobile: "9876543210" };
  const before = snapshot(update);
  stripMobileForRole(update, "staff");
  assert.deepEqual(update, before, "stripMobileForRole must not mutate its input");
});
