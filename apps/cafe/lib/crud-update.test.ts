import { test } from "node:test";
import assert from "node:assert/strict";

import { buildUpdate } from "./crud-route";

// Regression tests for a bug that shipped: turning "Has variations" OFF on a
// product did nothing. `JSON.stringify` drops a key whose value is `undefined`,
// so the PUT body never mentioned `variations`, the partial schema parsed it as
// absent, and Mongoose only $sets keys that are present — the stored sizes
// survived every "successful" save and the item kept billing by size.
//
// The fix is a two-part contract: the client sends an explicit `null`, and this
// function turns that null into a real `$unset` so the field goes back to ABSENT
// rather than being stored as null (omit-empty). An absent key must still mean
// "leave it alone" — that is what lets a CSV re-import, which has no variations
// column, avoid wiping an item's sizes.

test("a null in a listed field becomes $unset, and the field is NOT left in $set", () => {
  const update = buildUpdate({ price: 120, variations: null }, ["variations"]);
  assert.deepEqual(update, { $set: { price: 120 }, $unset: { variations: "" } });
});

test("an ABSENT key is left completely alone — this is what keeps a CSV re-import from wiping sizes", () => {
  const update = buildUpdate({ price: 120 }, ["variations"]);
  assert.deepEqual(update, { $set: { price: 120 } });
});

test("a real value still just $sets", () => {
  const update = buildUpdate({ variations: [{ name: "Small", price: 109 }] }, ["variations"]);
  assert.deepEqual(update, { $set: { variations: [{ name: "Small", price: 109 }] } });
});

test("clearing the ONLY field produces a lone $unset, never an empty $set (Mongo rejects that)", () => {
  const update = buildUpdate({ variations: null }, ["variations"]);
  assert.deepEqual(update, { $unset: { variations: "" } });
});

test("a null in a field that is NOT listed is left as a stored null — only named fields are clearable", () => {
  const update = buildUpdate({ image: null }, ["variations"]);
  assert.deepEqual(update, { $set: { image: null } });
});

test("with no listed fields at all, behaviour is a plain $set (every other entity's PUT)", () => {
  const update = buildUpdate({ name: "Chai", price: 20 });
  assert.deepEqual(update, { $set: { name: "Chai", price: 20 } });
});

test("an empty payload yields an empty update rather than $set:{} — the route's findByIdAndUpdate would throw on that", () => {
  assert.deepEqual(buildUpdate({}, ["variations"]), {});
});

// Object.hasOwn, not `in`: a payload cannot reach through the prototype to claim
// a field is present (the repo has a live history of prototype-key bypasses).
test("a prototype key cannot pose as a present field", () => {
  const update = buildUpdate({ price: 10 }, ["constructor", "toString"]);
  assert.deepEqual(update, { $set: { price: 10 } });
});
