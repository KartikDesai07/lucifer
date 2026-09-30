import { test } from "node:test";
import assert from "node:assert/strict";
import { reorderOps, sameTableSet } from "./table-order";

test("reorderOps: empty list produces no ops", () => {
  assert.deepEqual(reorderOps([]), []);
});

test("reorderOps: exact bulkWrite shape for a 3-name list, position = index — pins the SHAPE a bulkWrite typo would break", () => {
  assert.deepEqual(reorderOps(["T-2", "T-1", "T-5"]), [
    { updateOne: { filter: { tableNo: "T-2" }, update: { $set: { displayOrder: 0 } } } },
    { updateOne: { filter: { tableNo: "T-1" }, update: { $set: { displayOrder: 1 } } } },
    { updateOne: { filter: { tableNo: "T-5" }, update: { $set: { displayOrder: 2 } } } },
  ]);
});

test("reorderOps: names are carried verbatim — no trimming or casing applied", () => {
  const ops = reorderOps([" Patio A ", "patio a"]);
  assert.deepEqual(ops[0].updateOne.filter, { tableNo: " Patio A " });
  assert.deepEqual(ops[1].updateOne.filter, { tableNo: "patio a" });
});

test("sameTableSet: the same names match, whatever the order", () => {
  assert.equal(sameTableSet(["T-1", "T-2", "T-3"], ["T-1", "T-2", "T-3"]), true);
  assert.equal(sameTableSet(["T-3", "T-1", "T-2"], ["T-1", "T-2", "T-3"]), true);
  assert.equal(sameTableSet([], []), true);
});

test("sameTableSet: a subset, a superset, or an unknown name is NOT the same set", () => {
  assert.equal(sameTableSet(["T-1", "T-2"], ["T-1", "T-2", "T-3"]), false);
  assert.equal(sameTableSet(["T-1", "T-2", "T-3", "T-4"], ["T-1", "T-2", "T-3"]), false);
  assert.equal(sameTableSet(["T-1", "T-2", "Ghost"], ["T-1", "T-2", "T-3"]), false);
});

test("sameTableSet: duplicates never match, on either side, even when the lengths agree", () => {
  assert.equal(sameTableSet(["T-1", "T-1", "T-2"], ["T-1", "T-2", "T-3"]), false);
  assert.equal(sameTableSet(["T-1", "T-2", "T-3"], ["T-1", "T-1", "T-2"]), false);
  assert.equal(sameTableSet(["T-1", "T-1"], ["T-1", "T-1"]), false);
});
