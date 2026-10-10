import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./source-pin-utils";

// Expenses UI v2 - source pins (spec: .claude/plan/v2/_research/expense-ui-v2-spec.md,
// "After" + E2/E3). The browser smoke (_research/expense-smoke/expense-smoke.mjs)
// proves the rendered behaviour; these pins keep the structure from drifting:
//   1. the chip group is gone (file and every importer),
//   2. Category / Paid by are Selects whose Labels point at the trigger ids,
//   3. exactly one submit button (Add expense); "Save & add another" is a button,
//   4. the idempotency key is renewed ONLY by the add-another success path,
//   5. the header is title-only; Categories + Expense report are menu links,
//   6. table from md up, phone list below md.
// Every pin is a predicate over the comment-stripped source. Each one is also run
// on a MUTATED in-memory copy and must flip, so a pin can never go vacuous (the
// real files are never edited). Needles of the retired component are built by
// concatenation so this file never matches its own scan.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAFE_ROOT = path.join(HERE, "..");
const EXPENSES_DIR = "components/expenses";
const SHEET = `${EXPENSES_DIR}/ExpenseFormSheet.tsx`;
const FIELDS = `${EXPENSES_DIR}/ExpenseFormFields.tsx`;
const VIEW = `${EXPENSES_DIR}/ExpensesView.tsx`;
const TABLE = `${EXPENSES_DIR}/ExpenseTable.tsx`;
const RETIRED = "Expense" + "ChipGroup";
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".turbo"]);
const SCAN_EXTENSIONS = /\.(tsx?|mjs|cjs|js|jsx|json)$/;

const read = (rel: string) => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8")).replace(/\r\n/g, "\n");
const count = (src: string, needle: string) => src.split(needle).length - 1;

/** The `<Tag ...>` opening tag starting at `from` - ends at the first `>` outside quotes and braces. */
function openingTag(src: string, from: number): string {
  let depth = 0;
  let quote = "";
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0 && src[i - 1] !== "=") return src.slice(from, i + 1);
  }
  throw new Error("unterminated tag at " + from);
}

/** The balanced `{ ... }` or `( ... )` group opening at the first `open` char at/after `from`. */
function balanced(src: string, from: number, open: "{" | "("): string {
  const close = open === "{" ? "}" : ")";
  const start = src.indexOf(open, from);
  if (start === -1) throw new Error("no " + open + " after " + from);
  let depth = 0;
  let quote = "";
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced " + open + " after " + from);
}

const tagsNamed = (src: string, pattern: RegExp): string[] => [...src.matchAll(pattern)].map((m) => openingTag(src, m.index ?? 0));

/** Swap exactly one occurrence; throws if the needle is missing (a stale mutation must not pass silently). */
function mutate(src: string, from: string, to: string): string {
  assert.equal(count(src, from), 1, `mutation needle must occur once: ${from}`);
  return src.replace(from, to);
}

/** Run a pin on the real source (must hold) and on each mutated copy (must NOT hold). */
function pin(name: string, holds: (src: string) => boolean, src: string, mutants: ReadonlyArray<[string, string]>) {
  assert.equal(holds(src), true, `${name}: holds on the real source`);
  for (const [label, mutated] of mutants) assert.equal(holds(mutated), false, `${name}: must flip when ${label}`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (SCAN_EXTENSIONS.test(entry.name)) out.push(path.join(dir, entry.name));
  }
  return out;
}

// ---- 1. the chip group is gone --------------------------------------------------------------------------------

test("PIN 1: the retired chip group is gone - file absent, nothing under apps/cafe mentions it", () => {
  assert.equal(existsSync(path.join(CAFE_ROOT, EXPENSES_DIR, RETIRED + ".tsx")), false, "the file is deleted");
  const files = walk(CAFE_ROOT);
  // Vision guard: the walk really covered the app (it sees the sheet and many files), so "no hits" is not an empty scan.
  assert.ok(files.length > 500, `scanned a real tree, got ${files.length} files`);
  assert.ok(
    files.some((f) => f.endsWith("ExpenseFormSheet.tsx")),
    "the scan reaches the form sheet",
  );
  const hits = files.filter((f) => f !== fileURLToPath(import.meta.url) && readFileSync(f, "utf8").includes(RETIRED));
  assert.deepEqual(hits, [], "no importer or reference remains");
  // The guard itself flips: a file that does name it is found by the same predicate.
  assert.equal(("import { x } from '@/components/expenses/" + RETIRED + "';").includes(RETIRED), true);
});

// ---- 2. two Selects with labelled ids -------------------------------------------------------------------------

const selectsLabelled = (sheet: string, fields: string): boolean => {
  const fieldTags = tagsNamed(sheet, /<ExpenseSelectField(?=\s)/g);
  const ids = fieldTags.map((t) => /\bid="([^"]+)"/.exec(t)?.[1]);
  const labelsHaveHtmlFor = count(fields, "<Label htmlFor={id}") === 1;
  // The wrapper hands ONE `id` to both the Label (via ExpenseField) and the trigger.
  const sameId = count(fields, "<ExpenseField id={id} label={label}") === 1 && count(fields, "<SelectTrigger id={id}") === 1;
  const noChips = !sheet.includes("role=\"group\"") && !fields.includes("role=\"group\"");
  return ids.length === 2 && ids[0] === "expense-category" && ids[1] === "expense-mode" && labelsHaveHtmlFor && sameId && noChips;
};

test("PIN 2: Category and Paid by are Selects (ids expense-category / expense-mode) with Labels whose htmlFor matches", () => {
  const sheet = read(SHEET);
  const fields = read(FIELDS);
  // Landmarks: the labels' text and the primitives are really there.
  assert.ok(sheet.includes('label="Category"') && sheet.includes('label="Paid by"'), "labels present");
  assert.ok(fields.includes('from "@/components/ui/select"') && fields.includes("<SelectContent>"), "the Select primitive is used");
  pin("selects labelled", (s) => selectsLabelled(s, fields), sheet, [
    ["the category id drifts", mutate(sheet, 'id="expense-category"', 'id="expense-cat"')],
    ["the mode id drifts", mutate(sheet, 'id="expense-mode"', 'id="expense-paid"')],
  ]);
  pin("selects labelled (fields)", (f) => selectsLabelled(sheet, f), fields, [
    ["the trigger stops carrying the shared id", mutate(fields, "<SelectTrigger id={id}", "<SelectTrigger")],
    ["the Label stops pointing at it", mutate(fields, "<Label htmlFor={id}", "<Label")],
  ]);
  // Every Select item is a 44 px target on a touch pointer.
  assert.ok(fields.includes('"pointer-coarse:min-h-11"') && fields.includes("className={SELECT_ITEM_CLASS}"), "items are 44 px on touch");
});

// ---- 3. exactly one submit button -----------------------------------------------------------------------------

const oneSubmitAndAddAnotherIsButton = (sheet: string, fields: string): boolean => {
  const both = sheet + "\n" + fields;
  const buttons = tagsNamed(both, /<(?:Button|button)(?=[\s>])/g);
  const typed = buttons.every((t) => /\btype="(?:button|submit)"/.test(t)); // an untyped button inside a form IS a submit
  const submits = buttons.filter((t) => t.includes('type="submit"'));
  const label = fields.indexOf("Save &amp; add another");
  if (label === -1) return false;
  const addAnother = openingTag(fields, fields.lastIndexOf("<Button", label));
  const submitLabel = fields.indexOf('"Add expense"');
  const submitTag = openingTag(fields, fields.lastIndexOf("<Button", submitLabel));
  return (
    typed &&
    submits.length === 1 &&
    count(both, 'type="submit"') === 1 &&
    submitTag.includes('type="submit"') &&
    addAnother.includes('type="button"') &&
    !addAnother.includes('type="submit"') &&
    sheet.includes("<form onSubmit={submit}") &&
    /const submit = \(event: FormEvent\) => \{\s*event\.preventDefault\(\);\s*save\("close"\);\s*\}/.test(sheet)
  );
};

test("PIN 3: the form has ONE submit button (Add expense, closes); Save & add another is type=button", () => {
  const sheet = read(SHEET);
  const fields = read(FIELDS);
  assert.ok(count(sheet + fields, "<Button") === 3, "landmark: the add/edit form's three buttons (delete, add another, submit) are in the scanned text");
  pin("one submit", (f) => oneSubmitAndAddAnotherIsButton(sheet, f), fields, [
    ["add-another becomes a submit", mutate(fields, '<Button type="button" variant="outline" disabled={isPending} onClick={onAddAnother}', '<Button type="submit" variant="outline" disabled={isPending} onClick={onAddAnother}')],
    ["add-another loses its type (defaults to submit in a form)", mutate(fields, '<Button type="button" variant="outline" disabled={isPending} onClick={onAddAnother}', '<Button variant="outline" disabled={isPending} onClick={onAddAnother}')],
    ["the primary stops being the submit", mutate(fields, '<Button type="submit" disabled={isPending}', '<Button type="button" disabled={isPending}')],
  ]);
  pin("one submit (sheet)", (s) => oneSubmitAndAddAnotherIsButton(s, fields), sheet, [
    ["the Delete button loses its type", mutate(sheet, '<Button\n              type="button"\n              variant="ghost"', "<Button\n              variant=\"ghost\"")],
    ["Enter would save-and-keep-open", mutate(sheet, 'event.preventDefault();\n    save("close");', 'event.preventDefault();\n    save("again");')],
  ]);
});

// ---- 4. the idempotency key is renewed only by the add-another success path -------------------------------------

const RENEW = "setClientRef(crypto.randomUUID())";
const WIRE = 'onSuccess: mode === "again" ? startNextExpense : onClose,';

const clientRefRenewedOnlyOnAgainSuccess = (src: string): boolean => {
  const startIdx = src.indexOf("const startNextExpense = () =>");
  if (startIdx === -1) return false;
  const startBody = balanced(src, startIdx, "{");
  const createCall = balanced(src, src.indexOf("create.mutate("), "(");
  const staleIdx = src.indexOf("const closeIfStale =");
  const staleBody = staleIdx === -1 ? "" : balanced(src, staleIdx, "{");
  return (
    count(src, "setClientRef(") === 1 && // the only setter call in the file
    startBody.includes(RENEW) &&
    count(src, "crypto.randomUUID()") === 2 && // the initial key + that one renewal
    count(src, "startNextExpense") === 2 && // declaration + the single wiring below
    count(src, "create.mutate(") === 1 &&
    createCall.includes(WIRE) &&
    createCall.includes("buildCreateInput(values, check.amountPaise, clientRef)") &&
    !createCall.includes("onError") &&
    !createCall.includes("setClientRef") &&
    staleBody.length > 0 &&
    !staleBody.includes("setClientRef") &&
    !staleBody.includes("randomUUID") &&
    count(src, "onError:") === 2 && // update + delete only (both closeIfStale), never the create
    count(src, "onError: closeIfStale") === 2
  );
};

test("PIN 4: setClientRef(crypto.randomUUID()) is reachable only from the create's onSuccess in the 'again' mode; no onError renews it", () => {
  const sheet = read(SHEET);
  // Landmarks: the idempotency state and the create call exist.
  assert.ok(sheet.includes("const [clientRef, setClientRef] = useState(() => crypto.randomUUID());"), "the key is minted once per open");
  assert.ok(sheet.includes("const save = (mode: SaveMode) =>"), "save takes the pressed mode");
  pin("clientRef renewal", clientRefRenewedOnlyOnAgainSuccess, sheet, [
    ["an onError on the create renews the key", mutate(sheet, WIRE, WIRE + "\n        onError: () => setClientRef(crypto.randomUUID()),")],
    ["the close path also renews it", mutate(sheet, WIRE, 'onSuccess: mode === "again" ? startNextExpense : () => { setClientRef(crypto.randomUUID()); onClose(); },')],
    ["the add-another success stops renewing it", mutate(sheet, "    " + RENEW + ";\n", "")],
    ["the update's stale handler renews it", mutate(sheet, "const closeIfStale = (error: Error) => {", "const closeIfStale = (error: Error) => {\n    setClientRef(crypto.randomUUID());")],
    ["the key is reused (no renewal wiring)", mutate(sheet, WIRE, "onSuccess: onClose,")],
  ]);
  // The success path also keeps the sheet open and resets only what changes bill to bill.
  const next = balanced(sheet, sheet.indexOf("const startNextExpense = () =>"), "{");
  assert.ok(next.includes('amountText: "", name: "", note: ""'), "amount / name / note cleared");
  assert.ok(!next.includes("date:") && !next.includes("categoryId") && !next.includes("paymentMode") && !next.includes("onClose"), "date / category / paid by kept, sheet stays open");
  assert.ok(next.includes("setSavedCount((n) => n + 1)") && next.includes("refocusAmount.current = true"), "counter bumped, amount refocused");
});

// ---- 5. the header ----------------------------------------------------------------------------------------------

const headerIsTitleOnlyWithMenuLinks = (view: string): boolean => {
  const header = openingTag(view, view.indexOf("<PageHeader"));
  const items = tagsNamed(view, /<DropdownMenuItem(?=\s)/g);
  const adminGate = /\{isAdmin && \(\s*<DropdownMenu>/.test(view);
  const categories = /<DropdownMenuItem asChild[^>]*>\s*<Link href=\{EXPENSE_CATEGORIES_PATH\}[^>]*>\s*<Tags aria-hidden \/> Categories\s*<\/Link>/.test(view);
  const report = /<DropdownMenuItem asChild[^>]*>\s*<Link href=\{EXPENSE_REPORT_PATH\}[^>]*>\s*<BarChart3 aria-hidden \/> Expense report\s*<\/Link>/.test(view);
  return (
    header.includes('title="Expenses"') &&
    !header.includes("description=") &&
    !header.includes("eyebrow=") &&
    count(view, "<PageHeader") === 1 &&
    items.length === 2 &&
    items.every((t) => t.includes("asChild")) &&
    adminGate &&
    categories &&
    report &&
    view.includes('aria-label="More"')
  );
};

test("PIN 5: /expenses header has no description= / eyebrow=; Categories + Expense report are DropdownMenu link items (admin only)", () => {
  const view = read(VIEW);
  const page = read("app/(dashboard)/expenses/page.tsx");
  // Landmarks: the header and both menu links exist; the paths are the shared constants (value-pinned below).
  assert.ok(view.includes("<PageHeader") && view.includes("<DropdownMenuContent"), "header + menu present");
  pin("header", headerIsTitleOnlyWithMenuLinks, view, [
    ["a description is added", mutate(view, 'title="Expenses"', 'title="Expenses" description="Track spending"')],
    ["an eyebrow is added", mutate(view, 'title="Expenses"', 'title="Expenses" eyebrow="Money"')],
    ["the Categories link is dropped", mutate(view, "href={EXPENSE_CATEGORIES_PATH}", "href={EXPENSE_REPORT_PATH}")],
    ["the Report item stops being a link item", mutate(view, "<DropdownMenuItem asChild className={MENU_ITEM_CLASS}>\n                    <Link href={EXPENSE_REPORT_PATH}", "<DropdownMenuItem className={MENU_ITEM_CLASS}>\n                    <Link href={EXPENSE_REPORT_PATH}")],
    ["the menu loses its admin gate", mutate(view, "{isAdmin && (\n              <DropdownMenu>", "{true && (\n              <DropdownMenu>")],
  ]);
  assert.ok(!page.includes("PageHeader"), "the route file adds no second header");
  const shared = read("../../packages/shared/src/expense.ts");
  assert.ok(shared.includes('EXPENSE_CATEGORIES_PATH = "/expenses/categories"') && shared.includes('EXPENSE_REPORT_PATH = "/reports/expenses"'), "the link targets are the real routes the smoke visits");
});

// ---- 6. table from md up, phone list below md -------------------------------------------------------------------

const tableAndListSplit = (table: string, view: string): boolean => {
  const panel = /const PANEL_CLASS = cn\("([^"]+)"/.exec(table)?.[1]?.split(/\s+/) ?? [];
  const wrappers = [...view.matchAll(/<div className="md:hidden">/g)].map((m) => view.slice(m.index ?? 0, view.indexOf("</div>", m.index)));
  return (
    panel.includes("hidden") &&
    panel.includes("md:block") &&
    !panel.includes("md:hidden") &&
    count(table, "cn(PANEL_CLASS,") === 2 && // the skeleton and the table share the one breakpoint
    wrappers.length === 2 &&
    wrappers.some((w) => w.includes("<ExpenseListSkeleton />")) &&
    wrappers.some((w) => w.includes("<ExpenseList rows={data.rows}")) &&
    wrappers.every((w) => !w.includes("<ExpenseTable")) &&
    count(view, "<ExpenseTable rows={data.rows}") === 1 &&
    count(view, "<ExpenseTableSkeleton />") === 1
  );
};

test("PIN 6: ExpenseTable is hidden md:block (and its skeleton); the phone list wrapper is md:hidden", () => {
  const table = read(TABLE);
  const view = read(VIEW);
  assert.ok(table.includes("<Table>") && table.includes("export function ExpenseTable("), "landmark: the table component is real");
  assert.ok(view.includes("<ExpenseList rows={data.rows}"), "landmark: the phone list is still rendered");
  pin("table split", (t) => tableAndListSplit(t, view), table, [
    ["the table is shown at every width", mutate(table, '"hidden overflow-hidden rounded-xl border md:block"', '"overflow-hidden rounded-xl border"')],
    ["the table hides from md up", mutate(table, '"hidden overflow-hidden rounded-xl border md:block"', '"hidden overflow-hidden rounded-xl border md:hidden"')],
  ]);
  pin("list split", (v) => tableAndListSplit(table, v), view, [
    ["the phone list is shown at every width", mutate(view, '<div className="md:hidden">\n          <ExpenseList rows', "<div>\n          <ExpenseList rows")],
    ["the table lands inside the phone wrapper", mutate(view, '<ExpenseTable rows={data.rows} categories={categories.data} onOpen={isAdmin ? openEdit : undefined} updating={list.isPlaceholderData} />', "")],
  ]);
});

// ---- 7. no native date popup anywhere (owner rule, s89c) ------------------------------------------------------

// The owner (twice): the browser's own date popup must never open anywhere in the app — every date field uses the
// app's DatePicker (components/shared/DatePicker.tsx). The needle is built by concatenation so it is never a literal.
const NATIVE_DATE = "type=" + '"date"';
const nativeDateFiles = (files: string[]): string[] =>
  files.filter((file) => /\.tsx$/.test(file) && read(path.relative(CAFE_ROOT, file)).includes(NATIVE_DATE));

test("PIN 7: no component renders a native date input; the expense Date field is the app's DatePicker", () => {
  const scanned = [...walk(path.join(CAFE_ROOT, "app")), ...walk(path.join(CAFE_ROOT, "components"))].filter(
    (file) => !file.includes(`${path.sep}ui${path.sep}`),
  );
  // Vision guard: the scan really covered the screens (the expense sheet and the shared picker are in it).
  assert.ok(scanned.length > 100, `the scan saw only ${scanned.length} files`);
  assert.ok(scanned.some((file) => file.endsWith("ExpenseFormSheet.tsx")), "the scan reaches the expense sheet");
  assert.deepEqual(nativeDateFiles(scanned).map((file) => path.relative(CAFE_ROOT, file)), [], "no native date inputs");
  assert.equal(("<Input " + NATIVE_DATE + " />").includes(NATIVE_DATE), true, "vision guard: the needle matches a native date input");

  const sheet = read(EXPENSES_DIR + "/ExpenseFormSheet.tsx");
  assert.match(sheet, /<DatePicker\s+id="expense-date"/, "the Date field is the app's DatePicker");
  assert.ok(sheet.includes('import { DatePicker } from "@/components/shared/DatePicker";'), "imported from its single home");
});
