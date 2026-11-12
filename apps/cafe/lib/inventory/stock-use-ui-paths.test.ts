// Source pins for the item editor's "Stock use" section (inventory lite, Slice 3): it sits INSIDE the item form, so every
// button is type="button" and Enter never submits; it is admin-only; it renders before the archive link; the hook's
// URLs are real routes. Read the REAL source, comments stripped.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const FIELD = "apps/cafe/components/products/StockUseField.tsx";
const ROW = "apps/cafe/components/products/StockUseRow.tsx";
const SHEET = "apps/cafe/components/products/ProductFormSheet.tsx";
const HOOK = "apps/cafe/hooks/use-stock-use.ts";
const INVENTORY_VIEW = "apps/cafe/components/inventory/InventoryView.tsx";
const ROUTE = "apps/cafe/app/api/products/[id]/stock-use/route.ts";
const OWN_ROUTE = "apps/cafe/app/api/products/[id]/stock-use/own/route.ts";

const COMPONENT_FILES = [FIELD, ROW];

test("PIN: every button in the Stock use field is type=button, written first", () => {
  let landmarks = 0;
  for (const file of COMPONENT_FILES) {
    const src = readSrc(file);
    const all = src.match(/<[bB]utton\b/g)?.length ?? 0;
    const typed = src.match(/<[bB]utton\s+type="button"/g)?.length ?? 0;
    landmarks += all;
    assert.equal(typed, all, `${file}: every <button / <Button starts with type="button"`);
  }
  assert.ok(landmarks >= 4, "landmark: Try again, Add stock item, Track, Save and the remove icon are all buttons");
  assert.ok(readSrc(FIELD).includes("Save stock use"), "landmark: the Save button is in the field");
});

test("PIN: the Stock use field never submits the item form on Enter", () => {
  const row = readSrc(ROW);
  assert.ok(row.includes('e.key === "Enter"') && row.includes("e.preventDefault()"), "the guard exists and prevents the default");
  const inputs = row.match(/<Input\b/g)?.length ?? 0;
  const guarded = row.match(/onKeyDown=\{blockEnter\}/g)?.length ?? 0;
  assert.ok(inputs >= 2, "landmark: the amount box and the per-size box are inputs");
  assert.equal(guarded, inputs, "every input carries the Enter guard");
  const field = readSrc(FIELD);
  assert.ok(!/<Input\b/.test(field) && !/<input\b/.test(field), "the field file holds no input of its own (the Enter guard lives in the row)");
});

test("PIN: no native number or date inputs, no bare select, no h4 to h6 in the Stock use field", () => {
  const banned = ["number", "date", "time", "datetime-local", "month", "week", "color"].map((t) => `type="${t}"`);
  assert.ok(COMPONENT_FILES.some((f) => readSrc(f).includes('inputMode="decimal"')), "landmark: a decimal text input exists");
  assert.ok(readSrc(ROW).includes('type="text"'), "landmark: the amount boxes are text inputs");
  for (const file of COMPONENT_FILES) {
    const src = readSrc(file);
    for (const needle of banned) assert.ok(!src.includes(needle), `${file}: no ${needle}`);
    assert.ok(!/<select\b/.test(src), `${file}: no bare select`);
    assert.ok(!/<h[4-6]\b/.test(src), `${file}: no h4 to h6`);
  }
});

test("PIN: the field is admin-only, and the editor (all its hooks) renders only behind that gate", () => {
  const src = readSrc(FIELD);
  const gate = src.indexOf("if (!isAdmin) return null;");
  const editor = src.indexOf("<StockUseEditor");
  assert.ok(src.includes("useAuth()") && gate >= 0, "landmark: the isAdmin gate exists");
  assert.ok(editor > gate, "the editor is rendered after the gate");
  assert.ok(src.includes("Save the item first, then set its stock use here."), "create mode says to save the item first");
  assert.ok(src.indexOf("product === null") > gate && src.indexOf("product === null") < editor, "create mode never reaches the editor");
});

test("PIN: the item editor renders StockUseField before the archive link", () => {
  const src = readSrc(SHEET);
  const field = src.indexOf("<StockUseField");
  const archive = src.indexOf("<ItemArchiveLink");
  assert.ok(archive >= 0, "landmark: the archive link is still rendered");
  assert.ok(field >= 0 && field < archive, "StockUseField comes before ItemArchiveLink");
  assert.ok(
    src.includes("<StockUseField product={product} onLeave={() => onOpenChange(false)} />"),
    "it gets the product (null in create mode) and closes the sheet when its Inventory link leaves (R34)",
  );
});

test("PIN: the field's Inventory link is an AppLink that closes the sheet on a plain click (R34)", () => {
  const src = readSrc(FIELD);
  assert.ok(src.includes('href="/inventory"'), "landmark: the field links to the Inventory page");
  assert.ok(src.includes("<AppLink"), "it is an AppLink");
  assert.ok(src.includes("closeOnPlainClick(e, onLeave)"), "a plain click closes the editor sheet");
});

test("PIN: the hook's GET is never reused (staleTime 0); both writes refresh the menu and the stock list", () => {
  const src = readSrc(HOOK);
  const get = src.indexOf("export function useStockUse(");
  const save = src.indexOf("export function useSaveStockUse(");
  assert.ok(get >= 0 && save > get, "landmark: the GET hook comes first");
  assert.ok(/staleTime:\s*0\b/.test(src.slice(get, save)), "the GET hook has staleTime 0");
  assert.ok(src.includes("PRODUCT_KEYS.all") && src.includes("INVENTORY_KEYS.items"), "writes invalidate the menu and the stock items");
  assert.ok(src.includes("setQueryData(stockUseKey(productId), dto)"), "the answer is the new truth");
});

test("PIN: the hook's URLs are routes that exist", () => {
  const src = readSrc(HOOK);
  assert.ok(src.includes("`/api/products/${productId}/stock-use`"), "GET and PUT go to .../stock-use");
  assert.ok(src.includes("`${stockUseUrl(productId)}/own`"), "the one tap goes to .../stock-use/own");
  assert.ok(src.includes('"PUT"') && src.includes('"POST"'), "PUT saves, POST is the one tap");
  assert.ok(existsSync(path.join(REPO_ROOT, ROUTE)), "app/api/products/[id]/stock-use/route.ts exists");
  assert.ok(existsSync(path.join(REPO_ROOT, OWN_ROUTE)), "app/api/products/[id]/stock-use/own/route.ts exists");
});

test("PIN: the admin empty state on Inventory points at Menu and Stock use", () => {
  const src = readSrc(INVENTORY_VIEW);
  assert.ok(src.includes("The owner adds stock items here."), "landmark: the staff line is still there");
  assert.ok(src.includes("Then open Menu, edit an item and set its Stock use."), "the admin line names the next step");
});
