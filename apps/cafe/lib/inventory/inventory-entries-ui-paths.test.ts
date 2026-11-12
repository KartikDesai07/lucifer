// Source pins for Inventory lite Slice 4's screens (wastage, stock counts, the History list, delete): what only an admin
// sees, where the editor's Count / Log buttons sit, the form-control rules, the once-per-open clientRef, delete only
// through its confirm, and the hooks refreshing both lists on a failure too. Read the REAL source, comments stripped.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const readRaw = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const DIR = "apps/cafe/components/inventory";
const VIEW = `${DIR}/InventoryView.tsx`;
const ITEM_SHEET = `${DIR}/StockItemSheet.tsx`;
const ADJUST_SHEET = `${DIR}/StockAdjustSheet.tsx`;
const ENTRY_LIST = `${DIR}/EntryList.tsx`;
const QTY_BOX = `${DIR}/QtyBox.tsx`;
const HOOK = "apps/cafe/hooks/use-inventory.ts";
const MAX_LINES = 300;

const count = (src: string, needle: string): number => src.split(needle).length - 1;
/** A line that holds only the close of a JSX gate. */
const GATE_CLOSE = /\n\s*\)\}\n/;

test("PIN: the Count stock header action is inside the admin branch of the header, never staff's", () => {
  const src = readSrc(VIEW);
  const admin = src.indexOf("const headerActions = isAdmin ? (");
  const staff = src.indexOf("hasItems && !authLoading ? (");
  const countOpen = src.indexOf('openAdjust("count")');
  assert.ok(admin >= 0 && staff > admin, "landmark: the header is admin branch, then staff branch");
  assert.equal(count(src, 'openAdjust("count")'), 1, "exactly one place opens a count from the view");
  assert.ok(countOpen > admin && countOpen < staff, "it sits between the admin gate and the staff branch");
  const staffBranch = src.slice(staff, src.indexOf("const body = ()"));
  assert.ok(staffBranch.includes('openAdjust("waste")'), "landmark: staff's branch is the Log wastage button");
  assert.ok(!staffBranch.includes('"count"'), "staff's branch never opens a count");
  assert.ok(src.includes("DropdownMenu"), "landmark: the admin's More menu");
});

test("PIN: a staff row tap logs wastage; nothing in the view hands staff a count or the editor", () => {
  const src = readSrc(VIEW);
  assert.ok(src.includes("onOpen={isAdmin ? openEdit : logWastageFor}"), "the row tap");
  assert.ok(src.includes("const logWastageFor = (item: StockItemDto) => openAdjust(\"waste\", item.id);"), "landmark: it is a wastage");
  assert.ok(src.includes("`Log wastage for ${item.name}`"), "the staff row label");
});

test("PIN: the History tab and the entries list render only under isAdmin", () => {
  const src = readSrc(VIEW);
  const tabs = src.indexOf("{isAdmin && <SegmentedControl");
  const list = src.indexOf('{isAdmin && tab === "history" ? <EntryList /> : body()}');
  assert.ok(tabs >= 0 && src.includes('{ value: "history", label: "History" }'), "landmark: the tab control and its History option");
  assert.ok(list > tabs, "the list is gated on isAdmin and the History tab");
  assert.equal(count(src, "<EntryList"), 1, "EntryList renders in exactly one place");
  assert.ok(!src.includes("useStockEntries"), "the view itself never asks for entries");
  assert.equal(count(readSrc(ENTRY_LIST), "useStockEntries(true)"), 1, "landmark: the list is what asks");
});

test("PIN: the editor's Count stock / Log wastage buttons sit inside the edit-only branch, above Archive", () => {
  const src = readSrc(ITEM_SHEET);
  const gate = src.indexOf("{item && (");
  const countBtn = src.indexOf('onAdjust(item, "count")');
  const wasteBtn = src.indexOf('onAdjust(item, "waste")');
  const archive = src.indexOf("onArchive(item)");
  assert.equal(count(src, "{item && ("), 1, "one edit-only branch");
  assert.ok(!src.includes("{!item && ("), "no flipped gate");
  assert.ok(gate >= 0 && countBtn > gate && wasteBtn > countBtn && archive > wasteBtn, "gate, then Count, then Log wastage, then Archive");
  assert.ok(!GATE_CLOSE.test(src.slice(gate, archive)), "the gate has not closed before Archive");
  assert.ok(GATE_CLOSE.test(src.slice(archive)), "landmark: and it closes right after Archive");
});

test("PIN: QtyBox lives in its own file and both sheets import it", () => {
  assert.ok(readSrc(QTY_BOX).includes('export function QtyBox('), "landmark: the component");
  assert.ok(readSrc(QTY_BOX).includes('inputMode="decimal"'), "a decimal text input");
  for (const file of [ITEM_SHEET, ADJUST_SHEET]) {
    const src = readSrc(file);
    assert.ok(src.includes('import { QtyBox } from "@/components/inventory/QtyBox";'), `${file}: imports it`);
    assert.ok(!src.includes("function QtyBox"), `${file}: no private copy`);
  }
});

test("PIN: every button in the adjust sheet and the entry list is type=button; the footer owns the submit", () => {
  let landmarks = 0;
  for (const file of [ADJUST_SHEET, ENTRY_LIST]) {
    const src = readSrc(file);
    const all = src.match(/<[bB]utton\b/g)?.length ?? 0;
    const typed = src.match(/<[bB]utton\s+type="button"/g)?.length ?? 0;
    landmarks += all;
    assert.equal(typed, all, `${file}: every <button / <Button starts with type="button"`);
    assert.ok(!src.includes('type="submit"'), `${file}: no submit of its own`);
  }
  assert.ok(landmarks >= 2, "landmark: the Delete entry icon and Show older are buttons");
  assert.ok(readSrc(ADJUST_SHEET).includes("<ItemEditorFooter "), "the submit is the shared footer's");
});

test("PIN: no native date or number inputs in the adjust sheet and the entry list; dates use the DatePicker", () => {
  const sheet = readSrc(ADJUST_SHEET);
  assert.ok(sheet.includes("<DatePicker") && sheet.includes("min={bounds.min}") && sheet.includes("max={bounds.max}"), "landmark: the bounded DatePicker");
  assert.ok(!sheet.includes("clearable"), "the date is not clearable");
  for (const file of [ADJUST_SHEET, ENTRY_LIST]) {
    const src = readSrc(file);
    for (const type of ["date", "number", "time", "datetime-local"]) assert.ok(!src.includes(`type="${type}"`), `${file}: no type="${type}"`);
    assert.ok(!/<select\b/.test(src), `${file}: no bare select`);
  }
});

test("PIN: the clientRef is minted once per opened sheet, never re-minted", () => {
  const raw = readSrc(ADJUST_SHEET);
  assert.equal(count(raw, "useState(() => crypto.randomUUID())"), 1, "one useState initializer");
  assert.equal(count(raw, "crypto.randomUUID()"), 1, "and no other mint");
  assert.ok(!raw.includes("setClientRef"), "no setter to replace it");
  assert.ok(raw.includes("buildStockEntryInput(kind, values, clientRef, today)"), "landmark: the same ref goes into every send");
});

test("PIN: delete goes only through the ConfirmDialog", () => {
  const src = readSrc(ENTRY_LIST);
  const confirm = src.indexOf("const confirmDelete = async () => {");
  const dialog = src.indexOf("<ConfirmDialog");
  assert.equal(count(src, "remove.mutate"), 1, "one delete call");
  assert.ok(confirm >= 0 && src.indexOf("remove.mutateAsync(deleting.id)") > confirm && src.indexOf("remove.mutateAsync(deleting.id)") < dialog, "it is inside confirmDelete");
  assert.ok(dialog > confirm && src.indexOf("onConfirm={confirmDelete}") > dialog, "confirmDelete is the dialog's onConfirm");
  assert.ok(src.includes("onClick={() => setDeleting(entry)}"), "the trash button only opens the confirm");
  assert.ok(src.includes('aria-label="Delete entry"') && src.includes("isLoading={remove.isPending}"), "landmarks: the trash button, and the confirm shows pending");
});

test("PIN: the hooks refresh the stock list AND the entries on success and on error", () => {
  const src = readSrc(HOOK);
  assert.ok(src.includes('entries: ["inventory", "entries"] as const'), "the entries key");
  const helper = src.slice(src.indexOf("const refreshStockAndEntries"), src.indexOf("/** The entries history"));
  assert.ok(helper.includes("INVENTORY_KEYS.items") && helper.includes("INVENTORY_KEYS.entries"), "the helper refreshes both keys");
  for (const name of ["useCreateStockEntry", "useDeleteStockEntry"]) {
    const start = src.indexOf(`export function ${name}`);
    assert.ok(start >= 0, `landmark: ${name}`);
    const next = src.indexOf("export function", start + 1);
    const body = src.slice(start, next === -1 ? undefined : next);
    const onError = body.indexOf("onError");
    assert.ok(onError > body.indexOf("onSuccess"), `${name}: onError follows onSuccess`);
    assert.equal(count(body, "refreshStockAndEntries(qc)"), 2, `${name}: once on success, once on error`);
    assert.ok(body.slice(onError).includes("refreshStockAndEntries(qc)"), `${name}: the error path refreshes too`);
    assert.ok(body.slice(onError).includes("toast.error(error.message)"), `${name}: the error toast is the server's message`);
  }
  // Slice 5 moved this on purpose: the toast now comes from a per-kind table (waste, count, purchase).
  assert.ok(src.includes("toast.success(ENTRY_SAVED_TOAST[input.kind])"), "landmark: the success toast follows the kind");
  assert.ok(src.includes('waste: "Wastage logged"') && src.includes('count: "Stock count saved"'), "the wastage and count toasts are unchanged");
});

test("PIN: the entries hook pages by the server's cursor, and staff never enable it", () => {
  const src = readSrc(HOOK);
  assert.ok(src.includes("encodeURIComponent(pageParam)") && src.includes("getNextPageParam: (last: StockEntryPageDto) => last.nextBefore"), "cursor in, cursor out");
  assert.ok(src.includes("export function useStockEntries(enabled: boolean)") && src.includes("    enabled,\n"), "gated by the caller");
});

test("PIN: the new files stay under the line budget", () => {
  for (const file of [VIEW, ITEM_SHEET, ADJUST_SHEET, ENTRY_LIST, QTY_BOX, HOOK, "apps/cafe/lib/inventory/stock-adjust-form.ts"]) {
    assert.ok(readRaw(file).split("\n").length <= MAX_LINES, `${file}: at most ${MAX_LINES} lines`);
  }
});
