import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { supplierUpdate, toSupplierDto } from "./suppliers";

// Inventory lite Slice 5: the pure parts of the supplier core (the DTO and the PATCH update). DB truth (the dues sum,
// the collation, the archive rule): scripts/verify-inventory-purchases-live.ts.

const ID = new Types.ObjectId("665f0000000000000000d001");

test("toSupplierDto: id, name, phone and note only when set, and the due as given (any sign)", () => {
  assert.deepEqual(toSupplierDto({ _id: ID, name: "Sharma Dairy", phone: "98765 43210", note: "Mornings" }, 1500), {
    id: ID.toString(),
    name: "Sharma Dairy",
    phone: "98765 43210",
    note: "Mornings",
    duePaise: 1500,
  });
  const bare = toSupplierDto({ _id: ID, name: "Sharma Dairy" }, -200);
  assert.deepEqual(bare, { id: ID.toString(), name: "Sharma Dairy", duePaise: -200 });
  assert.equal("phone" in bare || "note" in bare, false, "omit-empty");
  assert.equal("phone" in toSupplierDto({ _id: ID, name: "X", phone: "" }, 0), false, "an empty phone is no phone");
});

test("supplierUpdate: nothing to change is null", () => {
  assert.equal(supplierUpdate({}), null);
  assert.equal(supplierUpdate({ phone: undefined, note: undefined }), null);
});

test("supplierUpdate: the name and a non-empty phone / note are $set; archived sets true", () => {
  assert.deepEqual(supplierUpdate({ name: "Rao", phone: "+91 99", note: "Net 7" }), { $set: { name: "Rao", phone: "+91 99", note: "Net 7" } });
  assert.deepEqual(supplierUpdate({ archived: true }), { $set: { archived: true } });
});

test("supplierUpdate: null or an empty string CLEARS the phone / note ($unset), never $set to empty", () => {
  assert.deepEqual(supplierUpdate({ phone: null }), { $unset: { phone: "" } });
  assert.deepEqual(supplierUpdate({ phone: "", note: null }), { $unset: { phone: "", note: "" } });
  assert.deepEqual(supplierUpdate({ name: "Rao", note: "" }), { $set: { name: "Rao" }, $unset: { note: "" } });
});
