// Source pins for Inventory lite Slice 5's screens (purchases and suppliers): the More menu items that only an admin
// sees, the purchase sheet's once-per-open clientRef and shared-helper preview, the suppliers screen fetching only for an
// admin, the admin-only route, and the create hook refreshing the suppliers list on a failure too. Read the REAL
// source, comments stripped.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { ADMIN_ROUTES } from "@pos/shared/constants";
import { pageTitleFor } from "@/lib/page-titles";
import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const DIR = "apps/cafe/components/inventory";
const VIEW = `${DIR}/InventoryView.tsx`;
const PURCHASE_SHEET = `${DIR}/PurchaseSheet.tsx`;
const PURCHASE_LINE = `${DIR}/PurchaseLineRow.tsx`;
const SUPPLIERS_VIEW = `${DIR}/SuppliersView.tsx`;
const SUPPLIER_SHEET = `${DIR}/SupplierSheet.tsx`;
const ENTRY_LIST = `${DIR}/EntryList.tsx`;
const PURCHASE_FORM = "apps/cafe/lib/inventory/purchase-form.ts";
const SUPPLIERS_PAGE = "apps/cafe/app/(dashboard)/inventory/suppliers/page.tsx";
const HOOK = "apps/cafe/hooks/use-inventory.ts";
const MAX_LINES = 300;

const count = (src: string, needle: string): number => src.split(needle).length - 1;
/** One exported hook's source, up to the next export. */
function hookBody(src: string, name: string): string {
  const start = src.indexOf(`export function ${name}`);
  assert.ok(start >= 0, `landmark: ${name} exists`);
  const next = src.indexOf("export function", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

test("PIN: the More menu's Add purchase and Suppliers items exist only in the admin branch of the header", () => {
  const src = readSrc(VIEW);
  const admin = src.indexOf("const headerActions = isAdmin ? (");
  const staff = src.indexOf("hasItems && !authLoading ? (");
  assert.ok(admin >= 0 && staff > admin, "landmark: the header is admin branch, then staff branch");
  const purchaseItem = src.indexOf("onSelect={openPurchase}");
  const suppliersItem = src.indexOf("<AppLink href={SUPPLIERS_PATH}>");
  assert.equal(count(src, "onSelect={openPurchase}"), 1, "exactly one place opens the purchase sheet from the menu");
  assert.equal(count(src, "<AppLink href={SUPPLIERS_PATH}>"), 1, "exactly one Suppliers link in the view");
  assert.ok(purchaseItem > admin && purchaseItem < staff, "Add purchase sits inside the admin branch");
  assert.ok(suppliersItem > purchaseItem && suppliersItem < staff, "Suppliers sits inside the admin branch, after Add purchase");
  const menu = src.slice(src.indexOf("<DropdownMenuContent"), src.indexOf("</DropdownMenuContent>"));
  const order = ["Add purchase", "Log wastage", "Count stock", "<DropdownMenuSeparator />", "Suppliers"].map((label) => menu.indexOf(label));
  assert.ok(order.every((at) => at >= 0) && order.every((at, i) => i === 0 || at > order[i - 1]), "menu order: purchase, wastage, count, separator, Suppliers");
  assert.ok(src.includes('const SUPPLIERS_PATH = "/inventory/suppliers"'), "the link goes to the real route");
  const staffBranch = src.slice(staff, src.indexOf("const body = ()"));
  assert.ok(staffBranch.includes('openAdjust("waste")'), "landmark: staff's branch is the Log wastage button");
  assert.ok(!staffBranch.includes("openPurchase") && !staffBranch.includes("SUPPLIERS_PATH"), "staff's branch never opens a purchase or Suppliers");
});

test("PIN: Add purchase is disabled with no stock items, and the sheet mounts only for an admin, by its own key", () => {
  const src = readSrc(VIEW);
  assert.ok(src.includes("disabled={!hasItems} onSelect={openPurchase}"), "disabled until a stock item exists");
  assert.ok(src.includes("{data && isAdmin && ("), "landmark: the gate in front of the sheets");
  const gate = src.indexOf("{data && isAdmin && (");
  const sheet = src.indexOf("<PurchaseSheet");
  assert.ok(gate >= 0 && sheet > gate, "the purchase sheet is inside the admin gate");
  assert.equal(count(src, "<PurchaseSheet"), 1, "mounted once");
  assert.ok(src.includes("key={purchase.key}") && src.includes("key: p.key + 1"), "remounted with a new key on every open");
  assert.ok(src.includes("useSuppliers(isAdmin)"), "suppliers are fetched for an admin only");
});

test("PIN: the purchase sheet's clientRef comes from a useState initializer, never minted per render or per save", () => {
  const src = readSrc(PURCHASE_SHEET);
  assert.ok(src.includes("const [clientRef] = useState(() => crypto.randomUUID());"), "minted once, in a lazy state initializer");
  assert.equal(count(src, "randomUUID"), 1, "randomUUID appears nowhere else in the sheet");
  assert.ok(src.includes("buildPurchaseInput(values, clientRef)"), "landmark: the save sends that clientRef");
  assert.ok(src.includes("create.mutateAsync("), "landmark: the save is a mutation");
  assert.ok(src.includes("saving={create.isPending}"), "the footer disables while pending");
});

test("PIN: the purchase preview comes from the shared purchase helpers, never hand-rolled maths", () => {
  const form = readSrc(PURCHASE_FORM);
  assert.match(form, /import \{[^}]*\bpurchaseLineAmountPaise\b[^}]*\bpurchaseTotalPaise\b[^}]*\} from "@pos\/shared\/inventory"/, "both helpers come from @pos/shared/inventory");
  assert.ok(form.includes("purchaseLineAmountPaise(parsed.qtyMilli, parsed.ratePaise)") && form.includes("purchaseTotalPaise(values.lines.flatMap("), "landmark: they are called");
  assert.ok(form.includes("rupeesTextToPaise") && form.includes("parseQtyText"), "the boxes read through the shared codecs");
  for (const file of [PURCHASE_FORM, PURCHASE_SHEET, PURCHASE_LINE]) {
    const src = readSrc(file);
    assert.ok(!/qtyMilli\s*\*\s*ratePaise/.test(src) && !src.includes("Math.round("), `${file}: no hand-rolled line maths`);
  }
  assert.ok(readSrc(PURCHASE_LINE).includes("lineAmountPaise(line)"), "the row shows the form's amount");
});

test("PIN: the purchase sheet picks a supplier with a Select that has a named no-supplier value, and a dropdown date", () => {
  const src = readSrc(PURCHASE_SHEET);
  assert.ok(src.includes('const NO_SUPPLIER_VALUE = "none"'), "Radix cannot hold an empty item value");
  assert.ok(!src.includes('<SelectItem value="">'), "no empty-valued item");
  assert.ok(src.includes("<DatePicker") && src.includes("Add another item") && src.includes("Purchases are not added to Expenses."), "landmarks: the picker, Add another item, the Expenses hint");
  assert.ok(src.includes("PURCHASE_MAX_LINES"), "the line cap is enforced");
  assert.ok(src.includes("owed > 0 && supplier") && src.includes("Still to pay {supplier.name}"), "the owed hint shows only when something is owed to a picked supplier");
});

test("PIN: the item editor shows the last purchase price only when the server sent one", () => {
  const src = readSrc(`${DIR}/StockItemSheet.tsx`);
  assert.ok(src.includes('typeof item.lastRatePaise === "number"'), "gated on a number (0 is a real price)");
  assert.ok(src.includes("Last bought at ${inrPaise(item.lastRatePaise)} / ${item.unit}"), "the hint words");
  assert.ok(src.includes("Archive stock item"), "landmark: the editor still ends with Archive");
});

// Review s117 (LOW): an editor left open when the screen locks and a STAFF member unlocks with a PIN would keep showing
// the admin's "Last bought at" line (component state survives the switch). The editor only ever opens for an admin, so
// it is only ever MOUNTED for one: losing admin unmounts it.
test("PIN: the item editor is mounted only for an admin", () => {
  const src = readSrc(VIEW);
  const sheet = src.indexOf("<StockItemSheet");
  assert.ok(sheet >= 0, "landmark: the editor is mounted in the view");
  assert.equal(count(src, "<StockItemSheet"), 1, "mounted once");
  const gate = src.lastIndexOf("{isAdmin && (", sheet);
  assert.ok(gate >= 0 && src.slice(gate, sheet).trim() === "{isAdmin && (", "the editor sits directly inside an isAdmin gate");
});

test("PIN: SuppliersView fetches only for an admin, behind the page guard", () => {
  const view = readSrc(SUPPLIERS_VIEW);
  assert.ok(view.includes("useSuppliers(isAdmin)"), "gated by isAdmin");
  assert.equal(count(view, "useSuppliers("), 1, "the only call is the gated one");
  assert.ok(view.includes("const { isAdmin, isLoading: authLoading } = useAuth();"), "landmark: isAdmin comes from the session");
  const page = readSrc(SUPPLIERS_PAGE);
  const guard = page.indexOf("<AdminGuard>");
  const body = page.indexOf("<SuppliersView />");
  assert.ok(guard >= 0 && body > guard && page.indexOf("</AdminGuard>") > body, "the view is inside AdminGuard");
  assert.ok(view.includes('href={INVENTORY_PATH}') && view.includes('const INVENTORY_PATH = "/inventory"'), "the eyebrow links back to Inventory");
  assert.ok(view.includes("<SupplierSheet") && view.includes("<ConfirmDialog") && view.includes('title="Suppliers"'), "landmarks: the editor, the archive confirm, the title");
});

test("PIN: /inventory/suppliers is an admin route and has a page title, while /inventory stays open", () => {
  const routes = ADMIN_ROUTES as readonly string[];
  assert.ok(routes.includes("/staff"), "landmark: the list still holds the owner pages");
  assert.ok(routes.includes("/inventory/suppliers"), "staff are fenced out of Suppliers");
  assert.ok(!routes.includes("/inventory"), "staff may still open /inventory");
  assert.equal(pageTitleFor("/inventory/suppliers"), "Suppliers");
  assert.equal(pageTitleFor("/inventory"), "Inventory", "landmark: the parent title is unchanged");
});

test("PIN: the hooks refresh suppliers on success AND on error, for purchases, deletes and supplier edits", () => {
  const src = readSrc(HOOK);
  assert.ok(src.includes('suppliers: ["inventory", "suppliers"] as const'), "the suppliers key");
  const helper = src.slice(src.indexOf("const refreshStockAndEntries"), src.indexOf("const ENTRY_SAVED_TOAST"));
  assert.ok(helper.includes("INVENTORY_KEYS.items") && helper.includes("INVENTORY_KEYS.suppliers"), "the shared refresh helper includes suppliers");
  for (const name of ["useCreateStockEntry", "useDeleteStockEntry"]) {
    const body = hookBody(src, name);
    const onError = body.indexOf("onError");
    assert.ok(onError > body.indexOf("onSuccess"), `${name}: onError follows onSuccess`);
    assert.ok(body.slice(onError).includes("refreshStockAndEntries(qc)"), `${name}: the error path refreshes the lists, suppliers included`);
  }
  const update = hookBody(src, "useUpdateSupplier");
  assert.ok(update.slice(update.indexOf("onError")).includes("INVENTORY_KEYS.suppliers"), "a failed supplier update refreshes the list");
  assert.ok(update.includes('"Supplier archived" : "Supplier updated"'), "landmark: the toasts follow the input");
  assert.ok(hookBody(src, "useCreateSupplier").includes('"Supplier added"'), "landmark: the add toast");
  assert.ok(src.includes('purchase: "Purchase saved"'), "the purchase toast");
  assert.ok(src.includes("export function useSuppliers(enabled: boolean)") && src.includes("    enabled,\n"), "gated by the caller");
});

test("PIN: a purchase row names its supplier, total and dues; its delete confirm says what comes out of stock and what dues go", () => {
  const src = readSrc(ENTRY_LIST);
  assert.ok(src.includes("entry.supplierName") && src.includes("entry.totalPaise") && src.includes("to pay"), "the row's sub line parts");
  assert.ok(src.includes("comes out of ${line.name}'s stock."), "the purchase delete sentence");
  assert.ok(src.includes("owed to ${entry.supplierName") && src.includes("is removed."), "the dues sentence");
  assert.ok(src.includes('title="No entries yet"') && src.includes("Purchases, wastage and counts show here."), "the empty state");
  assert.ok(src.includes("useDeleteStockEntry") && src.includes("onConfirm={confirmDelete}"), "landmark: delete still goes through its confirm");
});

test("PIN: every button in the new files is type=button, and no native pickers or number inputs", () => {
  let landmarks = 0;
  for (const file of [PURCHASE_SHEET, PURCHASE_LINE, SUPPLIERS_VIEW, SUPPLIER_SHEET]) {
    const src = readSrc(file);
    const all = src.match(/<[bB]utton\b/g)?.length ?? 0;
    const typed = src.match(/<[bB]utton\s+type="button"/g)?.length ?? 0;
    landmarks += all;
    assert.equal(typed, all, `${file}: every <button / <Button starts with type="button"`);
    for (const t of ["number", "date", "time", "datetime-local", "month", "week", "color"]) assert.ok(!src.includes(`type="${t}"`), `${file}: no type="${t}"`);
    assert.ok(!/<select\b/.test(src), `${file}: no bare select`);
  }
  assert.ok(landmarks >= 4, "landmark: the new files have buttons");
  assert.ok(readSrc(PURCHASE_LINE).includes('inputMode="decimal"') && readSrc(SUPPLIER_SHEET).includes('inputMode="tel"'), "landmarks: decimal and tel keyboards");
});

test("PIN: the new files stay under the line budget", () => {
  for (const file of [PURCHASE_SHEET, PURCHASE_LINE, SUPPLIERS_VIEW, SUPPLIER_SHEET, ENTRY_LIST, VIEW, PURCHASE_FORM, "apps/cafe/lib/inventory/supplier-form.ts"]) {
    const lines = readFileSync(path.join(REPO_ROOT, file), "utf8").split("\n").length - 1;
    assert.ok(lines > 0 && lines <= MAX_LINES - 1, `${file}: ${lines} lines`);
  }
});
