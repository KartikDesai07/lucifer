import assert from "node:assert/strict";
import { test } from "node:test";

import { SUPPLIER_NAME_MAX_LEN, SUPPLIER_NOTE_MAX_LEN, SUPPLIER_PHONE_MAX_LEN } from "@pos/shared/inventory";
import { createSupplierSchema, updateSupplierSchema } from "@/schemas";
import type { SupplierDto } from "@/types/inventory";
import {
  buildSupplierCreateInput,
  buildSupplierUpdateInput,
  dueLabel,
  initialSupplierValues,
  supplierSubLine,
  validateSupplierForm,
} from "./supplier-form";

const SUPPLIER: SupplierDto = { id: "64b7f0c2a1d3e4f5a6b7c8db", name: "Raju Dairy", phone: "98765 43210", note: "Pays on Sundays", duePaise: 0 };

test("initialSupplierValues: blank for an add, the supplier's own words for an edit", () => {
  assert.deepEqual(initialSupplierValues(null), { name: "", phone: "", note: "" });
  assert.deepEqual(initialSupplierValues(SUPPLIER), { name: "Raju Dairy", phone: "98765 43210", note: "Pays on Sundays" });
  assert.deepEqual(initialSupplierValues({ id: "x", name: "A", duePaise: 5 }), { name: "A", phone: "", note: "" });
});

test("validateSupplierForm: a name is needed; phone and note are optional but limited", () => {
  assert.deepEqual(validateSupplierForm({ name: "Raju", phone: "", note: "" }), {});
  assert.equal(validateSupplierForm({ name: "  ", phone: "", note: "" }).name, "Name the supplier");
  assert.ok(validateSupplierForm({ name: "x".repeat(SUPPLIER_NAME_MAX_LEN + 1), phone: "", note: "" }).name);
  assert.equal(validateSupplierForm({ name: "Raju", phone: "call me", note: "" }).phone, "Use digits, spaces, + or - only");
  assert.ok(validateSupplierForm({ name: "Raju", phone: "9".repeat(SUPPLIER_PHONE_MAX_LEN + 1), note: "" }).phone);
  assert.deepEqual(validateSupplierForm({ name: "Raju", phone: "+91 (98765) 43-210", note: "" }), {});
  assert.ok(validateSupplierForm({ name: "Raju", phone: "", note: "x".repeat(SUPPLIER_NOTE_MAX_LEN + 1) }).note);
});

test("buildSupplierCreateInput: trims, leaves out an empty phone or note, and passes the shared schema", () => {
  const full = buildSupplierCreateInput({ name: " Raju ", phone: " 98765 ", note: " Sundays " });
  assert.deepEqual(full, { name: "Raju", phone: "98765", note: "Sundays" });
  assert.ok(createSupplierSchema.safeParse(full).success);
  const bare = buildSupplierCreateInput({ name: "Raju", phone: " ", note: "" });
  assert.deepEqual(bare, { name: "Raju" });
  assert.ok(createSupplierSchema.safeParse(bare).success);
});

test("buildSupplierUpdateInput: only what changed; an emptied phone or note clears with null; nothing changed is null", () => {
  const same = initialSupplierValues(SUPPLIER);
  assert.equal(buildSupplierUpdateInput(SUPPLIER, same), null);
  assert.equal(buildSupplierUpdateInput(SUPPLIER, { ...same, name: " Raju Dairy " }), null, "trimmed equal is no change");
  assert.deepEqual(buildSupplierUpdateInput(SUPPLIER, { ...same, name: "Raju Farm" }), { name: "Raju Farm" });
  const cleared = buildSupplierUpdateInput(SUPPLIER, { ...same, phone: "", note: "" });
  assert.deepEqual(cleared, { phone: null, note: null });
  assert.ok(updateSupplierSchema.safeParse(cleared).success);
  assert.deepEqual(buildSupplierUpdateInput({ ...SUPPLIER, phone: undefined }, { ...same, phone: "123" }), { phone: "123" });
  assert.ok(!("archived" in (buildSupplierUpdateInput(SUPPLIER, { ...same, name: "Z" }) ?? {})), "an edit never archives");
});

test("dueLabel: above 0 to pay, below 0 paid ahead, 0 settled", () => {
  assert.deepEqual(dueLabel(12050), { text: "₹120.50 to pay", tone: "owed" });
  assert.deepEqual(dueLabel(-5000), { text: "₹50.00 paid ahead", tone: "ahead" });
  assert.deepEqual(dueLabel(0), { text: "Settled", tone: "settled" });
});

test("supplierSubLine: phone and note, whichever exist", () => {
  assert.equal(supplierSubLine(SUPPLIER), "98765 43210 · Pays on Sundays");
  assert.equal(supplierSubLine({ ...SUPPLIER, note: undefined }), "98765 43210");
  assert.equal(supplierSubLine({ id: "x", name: "A", duePaise: 0 }), "");
});
