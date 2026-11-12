// Source pins for the Inventory page (inventory lite, Slice 2): the nav row, the open-to-every-role page, the admin
// gates inside it, and the form-control rules for components/inventory. Read the REAL source, comments stripped.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { ADMIN_ROUTES } from "@pos/shared/constants";
import { visibleNavSections } from "@/components/layout/AppSidebar";
import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const APP_SIDEBAR = "apps/cafe/components/layout/AppSidebar.tsx";
const PAGE = "apps/cafe/app/(dashboard)/inventory/page.tsx";
const COMPONENT_DIR = "apps/cafe/components/inventory";
const VIEW = `${COMPONENT_DIR}/InventoryView.tsx`;
const SHEET = `${COMPONENT_DIR}/StockItemSheet.tsx`;

const componentFiles = (): string[] =>
  readdirSync(path.join(REPO_ROOT, COMPONENT_DIR))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `${COMPONENT_DIR}/${f}`);

/** The Manage section's rows, in source order. */
function manageRows(): Array<{ title: string; url: string; icon: string; adminOnly: boolean }> {
  const src = readSrc(APP_SIDEBAR);
  const start = src.indexOf('label: "Manage"');
  assert.ok(start >= 0, "landmark: the Manage section exists");
  return [...src.slice(start).matchAll(/\{\s*title:\s*"([^"]+)",\s*url:\s*"([^"]+)",\s*icon:\s*(\w+)([^}]*)\}/g)].map((m) => ({
    title: m[1],
    url: m[2],
    icon: m[3],
    adminOnly: /adminOnly:\s*true/.test(m[4]),
  }));
}

test("PIN: the sidebar's Inventory row sits right after Menu, with the Boxes icon, open to every role", () => {
  const rows = manageRows();
  const menu = rows.findIndex((r) => r.title === "Menu");
  assert.ok(menu >= 0, "landmark: Manage still has a Menu row");
  assert.deepEqual(rows[menu + 1], { title: "Inventory", url: "/inventory", icon: "Boxes", adminOnly: false });
  assert.match(readSrc(APP_SIDEBAR), /import \{[^}]*\bBoxes\b[^}]*\} from "lucide-react"/, "Boxes comes from lucide-react");
  const staffUrls = visibleNavSections(false, false).flatMap((s) => s.items.map((i) => i.url));
  assert.ok(staffUrls.includes("/products"), "landmark: staff still see Menu");
  assert.ok(staffUrls.includes("/inventory"), "staff see Inventory");
});

test("PIN: /inventory is not an admin-only route", () => {
  assert.ok(ADMIN_ROUTES.length > 0 && (ADMIN_ROUTES as readonly string[]).includes("/staff"), "landmark: the list still holds the owner pages");
  assert.ok(!(ADMIN_ROUTES as readonly string[]).includes("/inventory"), "staff may open /inventory");
});

test("PIN: the page renders InventoryView inside MenuPageShell, with no admin guard", () => {
  const src = readSrc(PAGE);
  const shell = src.indexOf("<MenuPageShell>");
  const view = src.indexOf("<InventoryView />");
  assert.ok(shell >= 0 && view > shell && src.indexOf("</MenuPageShell>") > view, "the view is inside the shell");
  assert.ok(!src.includes("Admin" + "Guard"), "open to every role");
});

test("PIN: the view gates Add, the row tap and the empty-state action on isAdmin", () => {
  const src = readSrc(VIEW);
  assert.ok(src.includes("Add stock item"), "landmark: the Add button exists");
  assert.ok(src.includes("actions={isAdmin ? addButton(HEADER_ADD_CLASS) : undefined}"), "the header Add is admin-only");
  assert.ok(src.includes("onOpen={isAdmin ? openEdit : undefined}"), "only an admin's rows open the editor");
  assert.ok(src.includes("action={isAdmin ? <div"), "the empty state offers Add to an admin only");
});

test("PIN: every button in components/inventory is type=button, written first", () => {
  let landmarks = 0;
  for (const file of componentFiles()) {
    const src = readSrc(file);
    const all = src.match(/<[bB]utton\b/g)?.length ?? 0;
    const typed = src.match(/<[bB]utton\s+type="button"/g)?.length ?? 0;
    landmarks += all;
    assert.equal(typed, all, `${file}: every <button / <Button starts with type="button"`);
  }
  assert.ok(landmarks > 0, "landmark: the folder has buttons");
});

test("PIN: no native pickers and no number inputs in components/inventory, and no h4 to h6", () => {
  const banned = ["number", "date", "time", "datetime-local", "month", "week", "color"].map((t) => `type="${t}"`);
  const files = componentFiles();
  assert.ok(files.length >= 3 && files.some((f) => readSrc(f).includes('inputMode="decimal"')), "landmark: the three components, with a decimal text input");
  for (const file of files) {
    const src = readSrc(file);
    for (const needle of banned) assert.ok(!src.includes(needle), `${file}: no ${needle}`);
    assert.ok(!/<select\b/.test(src), `${file}: no bare select`);
    assert.ok(!/<h[4-6]\b/.test(src), `${file}: no h4 to h6`);
  }
});

test("PIN: the unit Select renders on create only; an edit shows a read-only line", () => {
  const src = readSrc(SHEET);
  const needle = "<Select ";
  // Anchored on the JSX brace: a bare "isEdit ? (" would also match a flipped "!isEdit ? (" gate.
  const gate = src.indexOf("{" + "isEdit ? (");
  const readOnly = src.indexOf("You can't change it.");
  const select = src.indexOf(needle);
  assert.ok(gate >= 0 && readOnly > gate, "landmark: the edit branch holds the read-only line");
  assert.equal(src.split(needle).length - 1, 1, "exactly one unit Select");
  assert.ok(select > readOnly, "the Select is after the edit branch");
  assert.ok(src.slice(readOnly, select).includes(") : ("), "it is the else branch of the isEdit gate");
});
