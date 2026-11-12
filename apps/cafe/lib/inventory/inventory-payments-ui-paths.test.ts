// Source pins for Inventory lite Slice 6's screens (pay a supplier + supplier history): the pay sheet's once-per-open clientRef
// and always-sent amount, the history key living under the entries prefix, the row opening the history, and the two sheets
// mounting only from the admin-only suppliers screen. Read the REAL source, comments stripped.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const DIR = "apps/cafe/components/inventory";
const PAY_SHEET = `${DIR}/SupplierPaySheet.tsx`;
const HISTORY_SHEET = `${DIR}/SupplierHistorySheet.tsx`;
const SUPPLIERS_VIEW = `${DIR}/SuppliersView.tsx`;
const ENTRY_LIST = `${DIR}/EntryList.tsx`;
const PAYMENT_FORM = "apps/cafe/lib/inventory/payment-form.ts";
const HOOK = "apps/cafe/hooks/use-inventory.ts";
const MAX_LINES = 300;

const count = (src: string, needle: string): number => src.split(needle).length - 1;

test("PIN: the pay sheet's clientRef comes from a useState initializer, minted once, and the save sends the typed amount", () => {
  const src = readSrc(PAY_SHEET);
  assert.ok(src.includes("const [clientRef] = useState(() => crypto." + "randomUUID());"), "minted once, in a lazy state initializer");
  assert.equal(count(src, "random" + "UUID"), 1, "it appears nowhere else in the sheet");
  assert.ok(src.includes("create.mutateAsync("), "landmark: the save is a mutation");
  assert.ok(src.includes("buildPaymentInput(" + "values, supplier.id, clientRef)"), "the body comes from the form builder, with that clientRef");
  assert.ok(src.includes("saving={create.isPending}"), "the footer disables while pending");
  assert.ok(src.includes("const [today] = useState(() => cafeDateString())"), "today is minted once too");
  const form = readSrc(PAYMENT_FORM);
  const build = form.slice(form.indexOf("export function buildPaymentInput"), form.indexOf("export function paymentAfterText"));
  assert.ok(build.includes("amountPaise"), "landmark: the builder sets amountPaise");
  assert.ok(build.includes('{ kind: "payment", supplierId, amountPaise, date'), "amountPaise is a plain key, never behind a condition");
  assert.ok(!/\.\.\.\(\s*amountPaise/.test(build) && !/amountPaise\s*\?/.test(build), "amountPaise is never spread conditionally or ternaried away");
});

test("PIN: the pay and history sheets use the app's own widgets: no native date or number inputs, every raw button is type=button", () => {
  let landmarks = 0;
  for (const file of [PAY_SHEET, HISTORY_SHEET, SUPPLIERS_VIEW, ENTRY_LIST]) {
    const src = readSrc(file);
    const all = src.match(/<[bB]utton\b/g)?.length ?? 0;
    const typed = src.match(/<[bB]utton\s+type="button"/g)?.length ?? 0;
    landmarks += all;
    assert.equal(typed, all, `${file}: every <button / <Button starts with type="button"`);
    for (const t of ["number", "date", "time", "datetime-local", "month", "week", "color"]) assert.ok(!src.includes(`type="${t}"`), `${file}: no type="${t}"`);
    assert.ok(!/<select\b/.test(src), `${file}: no bare select`);
  }
  assert.ok(landmarks >= 5, "landmark: the files have buttons");
  const pay = readSrc(PAY_SHEET);
  assert.ok(pay.includes("<DatePicker") && pay.includes('inputMode="decimal"') && pay.includes('type="text"'), "landmarks: the calendar and a decimal text box");
  assert.ok(pay.includes('aria-label="Amount paid"') && pay.includes("Payments are not added to Expenses."), "landmarks: the box label and the Expenses hint");
});

test("PIN: a supplier history key extends the entries key, so every entries refresh covers it", () => {
  const src = readSrc(HOOK);
  assert.ok(src.includes('entries: ["inventory", "entries"] as const'), "landmark: the entries key");
  assert.ok(src.includes('[...INVENTORY_KEYS.entries, "supplier", supplierId]'), "the supplier key is the entries key plus a suffix");
  assert.ok(src.includes('params.set("supplierId", supplierId)'), "the URL carries the supplier");
  const helper = src.slice(src.indexOf("const refreshStockAndEntries"), src.indexOf("const ENTRY_SAVED_TOAST"));
  assert.ok(helper.includes("queryKey: INVENTORY_KEYS.entries"), "the shared refresh invalidates the entries prefix");
  assert.ok(src.includes('payment: "Payment saved"'), "the payment toast");
  assert.ok(readSrc(ENTRY_LIST).includes("useStockEntries(true, supplierId)"), "the list passes its supplier through");
});

test("PIN: a supplier row opens its history, and the history hands over to Pay or Edit details", () => {
  const src = readSrc(SUPPLIERS_VIEW);
  assert.ok(src.includes("aria-label={`Open ${supplier.name}`}") && src.includes('onClick={() => openSheet("history", supplier.id)}'), "the row opens the history");
  assert.ok(!src.includes("aria-label={`Edit ${supplier.name}`}"), "the row no longer jumps straight to the editor");
  assert.ok(src.includes('onPay={() => openSheet("pay", current.id)}') && src.includes('onEdit={() => openSheet("edit", current.id, current)}'), "Pay and Edit details are handoffs (Edit with its copy: review s118)");
  assert.ok(src.includes("data?.find((s) => s.id === sheet.id)"), "the open supplier is looked up by id in the live list");
  const history = readSrc(HISTORY_SHEET);
  assert.ok(history.includes("<EntryList supplierId={supplier.id} />"), "the history body is that supplier's list");
  assert.ok(history.includes("Edit details") && history.includes("onClick={onEdit}") && history.includes("onClick={onPay}"), "landmarks: the two footer buttons");
  assert.ok(!history.includes("onSubmit"), "the history is not a form");
});

test("PIN: the pay and history sheets render only from SuppliersView, which fetches for an admin only", () => {
  const view = readSrc(SUPPLIERS_VIEW);
  assert.equal(count(view, "<SupplierPaySheet"), 1, "the pay sheet is mounted once, by the view");
  assert.equal(count(view, "<SupplierHistorySheet"), 1, "the history sheet is mounted once, by the view");
  assert.ok(view.includes("useSuppliers(isAdmin)"), "landmark: the list (and so every sheet's supplier) exists only for an admin");
  const history = view.indexOf("<SupplierHistorySheet");
  const pay = view.indexOf("<SupplierPaySheet");
  assert.ok(view.slice(view.lastIndexOf("{", history), history).includes("current &&"), "the history is gated on a found supplier");
  assert.ok(view.slice(view.lastIndexOf("{", pay), pay).includes("current &&"), "the pay sheet is gated on a found supplier");
  for (const file of [`${DIR}/InventoryView.tsx`, `${DIR}/StockItemSheet.tsx`, `${DIR}/PurchaseSheet.tsx`, ENTRY_LIST]) {
    const src = readSrc(file);
    assert.ok(!src.includes("<SupplierPaySheet") && !src.includes("<SupplierHistorySheet"), `${file}: never mounts them`);
  }
  assert.ok(readSrc(`${DIR}/InventoryView.tsx`).includes("<EntryList"), "landmark: the other files exist and still use the list");
});

test("PIN: a payment row shows the amount paid and a delete sentence that puts it back to owed", () => {
  const src = readSrc(ENTRY_LIST);
  assert.ok(src.includes('entry.kind === "payment"') && src.includes("paid to ${entry.supplierName"), "landmarks: the payment branches");
  assert.ok(src.includes("is removed, so it counts as owed again."), "the delete sentence");
  assert.ok(src.includes('"Nothing here yet"') && src.includes("Purchases from this supplier and payments to them show here."), "the supplier-scoped empty state");
});

test("PIN: the new files stay under the line budget", () => {
  for (const file of [PAY_SHEET, HISTORY_SHEET, SUPPLIERS_VIEW, ENTRY_LIST, PAYMENT_FORM, HOOK]) {
    const lines = readFileSync(path.join(REPO_ROOT, file), "utf8").split("\n").length - 1;
    assert.ok(lines > 0 && lines <= MAX_LINES - 1, `${file}: ${lines} lines`);
  }
});

// Review s118 (LOW): the editor's form starts from the supplier ONCE and sends only what differs from the supplier it
// is given. Given the LIVE row, a refetch (another admin renamed it) made the untouched old name look like a change,
// and Save undid the rename. So Edit details hands the editor the copy taken when it opened, as before Slice 6.
test("PIN: Edit details gives the editor the supplier as it was when it opened, never the live row", () => {
  const src = readSrc(SUPPLIERS_VIEW);
  assert.ok(src.includes('onEdit={() => openSheet("edit", current.id, current)}'), "the copy is taken when Edit details opens");
  assert.ok(src.includes('supplier={modeIs("edit") ? sheet.snapshot : null}'), "the editor compares against that copy");
  assert.ok(src.includes("<SupplierSheet"), "landmark: the editor is mounted here");
  assert.ok(!src.includes('supplier={modeIs("edit") ? current : null}'), "never the live row");
});
