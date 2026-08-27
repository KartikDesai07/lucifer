import { test } from "node:test";
import assert from "node:assert/strict";
import { reorderOps } from "./table-order";

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
