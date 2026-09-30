// Source pins for the Areas manager sheet (Tables batch 2, slice B1, 2026-09-30):
// the sheet's exact copy, the in-use dialog that has NO delete action, the
// kept-last dialog copy, the add row's guards, the inline rename, and the
// arrange list's rollback. No React test framework here by design, so each pin is
// a checker over a source string; every pin runs on the real file AND is proven
// to FAIL on a deliberately broken copy (the MUTATION tests). Negative pins carry
// a positive landmark; needles that could match this file are built by
// concatenation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rawOf = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readSrc = (rel: string): string => stripComments(rawOf(rel));

const DIR = "apps/cafe/components/tables";
const SHEET = `${DIR}/AreasSheet.tsx`;
const LIST = `${DIR}/AreaArrangeList.tsx`;
const ROW = `${DIR}/AreaRow.tsx`;
const ALL = [SHEET, LIST, ROW];

const count = (src: string, needle: string): number => src.split(needle).length - 1;
const norm = (s: string): string => s.replace(/\s+/g, " ");

function bodyOf(src: string, header: string): string {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `landmark: ${header} must exist`);
  const open = src.indexOf("{", start + header.length - 1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error("bodyOf: unbalanced braces");
}

/** The opening tag around `idx`, brace-aware (an arrow's `=>` does not end it). */
function tagAround(src: string, idx: number): string {
  const start = src.lastIndexOf("<", idx);
  assert.ok(start >= 0, "landmark: an opening tag precedes the needle");
  let depth = 0;
  for (let end = start; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}") depth--;
    else if (src[end] === ">" && depth === 0) return src.slice(start, end + 1);
  }
  throw new Error("tagAround: unterminated tag");
}

/** Whitespace-tolerant replace; the anchor must match exactly once. */
function mutate(src: string, from: string, to: string): string {
  const pattern = new RegExp(
    from
      .split(/(\s+)/)
      .map((p) => (/^\s+$/.test(p) ? "\\s+" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join(""),
    "g",
  );
  assert.equal(src.match(pattern)?.length ?? 0, 1, `mutation anchor must match exactly once: ${from}`);
  return src.replace(pattern, () => to);
}

/** The `<AlertDialog ...>` block whose title is `title`. */
function alertBlock(src: string, title: string): string {
  const at = src.indexOf(title);
  assert.ok(at >= 0, `landmark: ${title}`);
  const opens = [...src.slice(0, at).matchAll(/<AlertDialog\s/g)];
  assert.ok(opens.length > 0, "landmark: an <AlertDialog opens before the title");
  return src.slice(opens[opens.length - 1].index, src.indexOf("</AlertDialog>", at));
}

// 1. touch-none: once across the feature, on the grip that carries the activator ref
function checkTouchNone(files: readonly string[], row: string): void {
  assert.equal(count(row, "ref={setActivatorNodeRef}"), 1, "landmark: one activator element");
  const needle = "touch" + "-none";
  assert.equal(files.reduce((n, f) => n + count(f, needle), 0), 1, "touch-action none appears exactly once - a row-wide one makes the sheet unscrollable by touch");
  assert.ok(tagAround(row, row.indexOf(needle)).includes("ref={setActivatorNodeRef}"), "and it sits on the grip button");
}
test("PIN: touch-none sits once, on the grip", () => {
  checkTouchNone(ALL.map(readSrc), readSrc(ROW));
});

// 2. tap targets + Lucide icons (no emoji glyphs)
function checkRowControls(row: string): void {
  for (const label of ["Drag to reorder ${area.name}", "Move ${area.name} up", "Move ${area.name} down", "Rename ${area.name}", "Delete ${area.name}"]) {
    const at = row.indexOf(label);
    assert.ok(at >= 0, `landmark: the control labelled ${label}`);
    const tag = tagAround(row, at);
    assert.match(tag, /(^|[\s"])h-11 w-11([\s"]|$)/, `${label}: 44px on a phone`);
    assert.match(tag, /(^|[\s"])md:h-10 md:w-10([\s"]|$)/, `${label}: 40px from md`);
  }
  assert.match(row, /import \{[^}]*\bPencil\b[^}]*\bTrash2\b[^}]*\} from "lucide-react"|import \{[^}]*\bTrash2\b[^}]*\bPencil\b[^}]*\} from "lucide-react"/, "Lucide Pencil + Trash2");
  assert.ok(row.includes("<Pencil") && row.includes("<Trash2"), "the icons are rendered");
  const glyphs = [0x25b2, 0x25bc, 0x270e, 0x1f5d1].map((c) => String.fromCodePoint(c));
  for (const g of glyphs) assert.ok(!row.includes(g), "no emoji or arrow glyph stands in for an icon");
}
test("PIN: grip, arrows, Rename and Delete are 44px / 40px from md, and use Lucide icons", () => checkRowControls(readSrc(ROW)));

// 3. inline rename
function checkInlineRename(row: string): void {
  assert.ok(row.includes('aria-label="Area name"'), 'the rename input is labelled "Area name"');
  assert.ok(row.includes("<form data-area-rename="), "landmark: the rename is a form (Enter saves)");
  assert.match(row, /<form[^>]*onSubmit=\{saveRename\}/, "Enter submits through saveRename");
  const save = bodyOf(row, "const saveRename = async (event: FormEvent) => {");
  assert.ok(save.includes("event.preventDefault()"), "the form submit is intercepted");
  assert.ok(save.includes("areaNameSchema.safeParse("), "inline error comes from areaNameSchema");
  assert.equal(count(save, "rename.mutateAsync("), 1, "one rename write");
  assert.ok(save.includes("rename.isPending"), "no second submit while a rename is pending");
  assert.match(bodyOf(row, "const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {"), /event\.key === "Escape"[\s\S]*cancelRename\(\)/, "Escape cancels");
  assert.ok(row.includes("disabled={rename.isPending}"), "Save is disabled while pending");
  assert.ok(/\bSave\s*<\/Button>/.test(row) && /\bCancel\s*<\/Button>/.test(row), "Save and Cancel buttons");
  assert.ok(norm(row).includes('tableCount === 0 ? "No tables" : tableCountText(tableCount)'), "sub-line: count text, or No tables");
}
test("PIN: rename is inline - Input 'Area name', Save/Cancel, Enter saves, Esc cancels", () => checkInlineRename(readSrc(ROW)));

// 4. Escape while renaming must not close the sheet
function checkEscapeGuard(sheet: string, row: string): void {
  assert.ok(row.includes('export const AREA_RENAME_SELECTOR = "[data-area-rename]"'), "landmark: the selector");
  assert.ok(row.includes("data-area-rename="), "the rename form carries the mark");
  assert.match(norm(sheet), /onEscapeKeyDown=\{\(e\) => \{ if \(e\.target instanceof Element && e\.target\.closest\(AREA_RENAME_SELECTOR\)\) e\.preventDefault\(\);/, "the sheet keeps open on Escape inside the rename form");
}
test("PIN: Escape inside the rename form cancels the rename, not the sheet", () => checkEscapeGuard(readSrc(SHEET), readSrc(ROW)));

// 5. sheet copy (exact)
function checkSheetCopy(sheet: string): void {
  const s = norm(sheet);
  for (const copy of [
    "<SheetTitle>Areas</SheetTitle>",
    "Group tables by where they are, for example AC Hall, Garden or Rooftop. The floor, New Order and Move table show tables under these headings.",
    "<Label htmlFor={NEW_AREA_INPUT_ID}>New area</Label>",
    'placeholder="e.g. Garden"',
    "Add area",
    'title="No areas yet"',
    'description="Add an area above, then pick it for each table in Edit table."',
    "Drag the handle, or use the up and down arrows. The floor shows areas in this order.",
    "You have reached the limit of {TABLE_AREAS_MAX} areas. Delete one to add another.",
  ]) assert.ok(s.includes(copy), `sheet copy: ${copy}`);
  assert.ok(s.includes("list === undefined ? ( areas.isError ?") && s.includes("<Skeleton"), "a skeleton while the list has not loaded (never the empty state)");
  assert.match(s, /list === undefined \? [\s\S]*: list\.length === 0 \? \( <EmptyState/, "the empty state only for a loaded, empty list");
}
test("PIN: the sheet's exact copy, skeleton before empty state", () => checkSheetCopy(readSrc(SHEET)));

// 6. the in-use dialog offers no delete
function checkInUseDialog(sheet: string): void {
  const block = alertBlock(sheet, "This area is in use");
  const n = norm(block);
  assert.ok(n.includes("open={target !== null && inUseCount > 0}"), "opens only when tables still use the area");
  assert.ok(n.includes("{areaInUseMessage(inUseCount)} Use Edit table on each one to pick another area."), "one copy source + the pick-another-area line");
  assert.equal(count(block, "<AlertDialogAction"), 1, "landmark: exactly one action");
  for (const banned of ["AlertDialogCancel", "mutateAsync", "confirmDelete", "remove.", "Delete"]) assert.equal(count(block, banned), 0, `the in-use dialog must not carry ${banned}`);
  assert.ok(n.includes("<AlertDialogAction>OK</AlertDialogAction>"), "the one action is a plain OK");
  assert.ok(!sheet.includes("This area still has"), "the in-use sentence is never re-typed here");
}
test("PIN: the in-use dialog is information only (OK), copy from areaInUseMessage", () => checkInUseDialog(readSrc(SHEET)));

// 7. unused delete + single writer + kept-last copy
function checkDeleteFlow(sheet: string): void {
  const n = norm(sheet);
  const confirm = n.slice(n.indexOf("<ConfirmDialog"), n.indexOf("/>", n.indexOf("<ConfirmDialog")));
  for (const part of ['open={target !== null && inUseCount === 0}', 'title="Delete area?"', 'description={`"${subjectName}" will be removed. No table uses it.`}', 'confirmLabel="Delete"', "isLoading={remove.isPending}", "onConfirm={confirmDelete}"]) {
    assert.ok(confirm.includes(part), `unused-delete dialog: ${part}`);
  }
  assert.equal(count(sheet, "remove.mutateAsync("), 1, "one delete writer");
  assert.ok(bodyOf(sheet, "const confirmDelete = async () => {").includes("remove.mutateAsync(target._id)"), "and it is confirmDelete");
  assert.equal(count(sheet, "confirmDelete"), 2, "confirmDelete is defined once and handed to the confirm dialog only");
  assert.ok(n.includes("tablesInArea(tables, subject._id).length"), "the count comes from the passed tables via tablesInArea");
  // kept-last dialog: copy reads the subject, never the (nulling) target
  assert.ok(n.includes("useState<Area | null>(target)") && n.includes("if (target && target !== shown) setShown(target);"), "the last shown area is kept in state");
  assert.ok(n.includes("const subject = target ?? shown;"), "copy reads target ?? shown");
  assert.equal(count(sheet, "target.name") + count(sheet, "target?.name"), 0, "copy never reads the target directly");
}
test("PIN: unused-delete confirm, one delete writer, last shown dialog kept", () => checkDeleteFlow(readSrc(SHEET)));

// 8. add row guards
function checkAddRow(sheet: string): void {
  const n = norm(sheet);
  assert.ok(n.includes("disabled={disabled || create.isPending || name.trim() === \"\"}"), "Add area is disabled while pending or empty");
  assert.ok(n.includes("const atMax = ready && count >= TABLE_AREAS_MAX;") && n.includes("const disabled = !ready || atMax;"), "and at the area limit");
  assert.ok(n.includes("areaNameSchema.safeParse(name)") && n.includes("setError(parsed.error.issues[0].message)"), "inline error from areaNameSchema");
  assert.ok(n.includes("create.mutateAsync({ name: parsed.data })"), "the trimmed, parsed name is sent");
  assert.match(sheet, /import \{[^}]*\bTABLE_AREAS_MAX\b[^}]*\} from "@\/lib\/constants"/, "the limit is the named constant");
}
test("PIN: the add row is guarded (pending / empty / limit) and validates with areaNameSchema", () => checkAddRow(readSrc(SHEET)));

// 9. arrange list: whole-list save, rollback, guards, announcements
function checkList(list: string): void {
  assert.ok(list.includes("useState<string[]>(() => areas.map((a) => a._id))"), "ids are Area._id");
  assert.equal(count(list, "latestServerIdsRef.current = areas.map((a) => a._id);"), 1, "the rollback ref is refreshed every render");
  assert.ok(norm(list).includes("reorder.mutate(next, { onError: () => setOrder(latestServerIdsRef.current) });"), "a failed save rolls back to the latest server order");
  assert.ok(list.includes("useReorderAreas()"), "landmark: the reorder hook");
  assert.match(bodyOf(list, "const move = (id: string, delta: -1 | 1) => {"), /if \(saving\) return;[\s\S]*moveId\(/, "the move guard runs before moveId");
  assert.ok(list.includes("save(arrayMove(order, from, to));"), "a drop saves the whole arranged list");
  assert.ok(norm(list).includes("tableCount={tablesInArea(tables, id).length}"), "row counts via tablesInArea");
  assert.equal(count(list, "<DndContext"), 1, "landmark: one DndContext");
  assert.equal(count(list, "useSensors("), 1);
  assert.doesNotMatch(list, /Announcement\(String\(active\.id\)/, "announcements speak the area name, not its id");
  assert.ok(list.includes("pickedUpAnnouncement(nameOf("), "landmark: announcements use nameOf");
}
test("PIN: AreaArrangeList mirrors the categories list (ids, rollback, guard, announcements)", () => checkList(readSrc(LIST)));

// 10. hygiene across the three files
function checkHygiene(name: string, src: string, raw: string): void {
  assert.ok(src.length > 500, `landmark: ${name} was read`);
  assert.ok(!/bg-(green|red|amber)-500/.test(raw), `${name}: raw status colour`);
  assert.equal(count(src, "console" + "."), 0, `${name}: console`);
  assert.ok(!/lucifer/i.test(raw), `${name}: cafe name`);
  assert.ok(!/(?<![\w.-])(24|50)(?![\w-])/.test(src), `${name}: the area limits are named constants`);
  assert.ok(raw.split("\n").length <= 300, `${name}: under 300 lines`);
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    assert.ok(c >= 0x20 || c === 0x0a || c === 0x09, `${name}: control byte ${c} at ${i}`);
  }
}
test("PIN: no raw status colours, console, cafe name, magic limits, control bytes; each file under 300 lines", () => {
  for (const f of ALL) checkHygiene(f, readSrc(f), rawOf(f));
});

// MUTATION proofs: every checker fails on a broken copy, for its own reason.
test("MUTATION: row pins", () => {
  const row = readSrc(ROW);
  const all = ALL.map(readSrc);
  const liNo = "flex items-center gap-1 bg-background px-2 py-3 md:gap-2 md:px-3";
  const withRow = (r: string) => [all[0], all[1], r];
  const rowWide = mutate(row, liNo, `${liNo} touch-none`);
  assert.throws(() => checkTouchNone(withRow(rowWide), rowWide), /exactly once/);
  const noGrip = mutate(row, "shrink-0 touch-none", "shrink-0");
  assert.throws(() => checkTouchNone(withRow(noGrip), noGrip), /exactly once/);
  assert.throws(() => checkRowControls(mutate(row, 'className="h-11 w-11 md:h-10 md:w-10" aria-label={`Rename ${area.name}`}', 'className="h-9 w-9" aria-label={`Rename ${area.name}`}')), /Rename/);
  assert.throws(() => checkRowControls(mutate(row, "<Trash2 className", `<span>${String.fromCodePoint(0x1f5d1)}</span><Trash2 className`)), /glyph/);
  assert.throws(() => checkInlineRename(mutate(row, 'aria-label="Area name"', 'aria-label="Name"')), /Area name/);
  assert.throws(() => checkInlineRename(mutate(row, 'event.key === "Escape"', 'event.key === "Esc"')), /Escape/);
  assert.throws(() => checkInlineRename(mutate(row, "onSubmit={saveRename}", "onClick={saveRename}")), /Enter submits/);
  assert.throws(() => checkInlineRename(mutate(row, "disabled={rename.isPending}", "")), /Save is disabled/);
  assert.throws(() => checkInlineRename(mutate(row, "areaNameSchema.safeParse(draft)", "{ success: true, data: draft }")), /areaNameSchema/);
  assert.throws(() => checkInlineRename(mutate(row, '"No tables"', '"0 tables"')), /No tables/);
  assert.throws(() => checkEscapeGuard(readSrc(SHEET), mutate(row, 'data-area-rename=""', "")), /the mark/);
});

test("MUTATION: sheet pins", () => {
  const sheet = readSrc(SHEET);
  assert.throws(() => checkEscapeGuard(mutate(sheet, ".closest(AREA_RENAME_SELECTOR)) e.preventDefault();", ".closest(AREA_RENAME_SELECTOR)) e.stopPropagation();"), readSrc(ROW)), /keeps open/);
  assert.throws(() => checkSheetCopy(mutate(sheet, 'title="No areas yet"', 'title="Nothing"')), /No areas yet/);
  assert.throws(() => checkSheetCopy(mutate(sheet, "list === undefined ? (", "list === null ? (")), /skeleton/);
  assert.throws(() => checkSheetCopy(mutate(sheet, "<SheetTitle>Areas</SheetTitle>", "<SheetTitle>Zones</SheetTitle>")), /SheetTitle/);
  assert.throws(() => checkHygiene("s", sheet, sheet.replace("Areas", "Lucifer areas")), /cafe name/);
  const ok = "<AlertDialogAction>OK</AlertDialogAction>";
  assert.throws(() => checkInUseDialog(mutate(sheet, ok, "<AlertDialogAction onClick={confirmDelete}>OK</AlertDialogAction>")), /confirmDelete/);
  assert.throws(() => checkInUseDialog(mutate(sheet, ok, "<AlertDialogCancel>Back</AlertDialogCancel><AlertDialogAction>OK</AlertDialogAction>")), /AlertDialogCancel/);
  assert.throws(() => checkInUseDialog(mutate(sheet, "{areaInUseMessage(inUseCount)}", "This area still has tables.")), /one copy source|re-typed/);
  assert.throws(() => checkInUseDialog(mutate(sheet, "open={target !== null && inUseCount > 0}", "open={target !== null}")), /opens only/);
  assert.throws(() => checkDeleteFlow(mutate(sheet, "open={target !== null && inUseCount === 0}", "open={target !== null}")), /unused-delete dialog/);
  assert.throws(() => checkDeleteFlow(mutate(sheet, "if (target && target !== shown) setShown(target);", "")), /last shown area/);
  assert.throws(() => checkDeleteFlow(mutate(sheet, "const subject = target ?? shown;", "const subject = target;")), /target \?\? shown/);
  assert.throws(() => checkDeleteFlow(mutate(sheet, '"${subjectName}" will be removed.', '"${target?.name}" will be removed.')), /unused-delete dialog/);
  assert.throws(() => checkDeleteFlow(`${sheet}\nconst again = () => remove.mutateAsync("x");\n`), /one delete writer/);
  assert.throws(() => checkAddRow(mutate(sheet, "disabled || create.isPending || name.trim() === \"\"", "disabled || name.trim() === \"\"")), /pending or empty/);
  assert.throws(() => checkAddRow(mutate(sheet, "count >= TABLE_AREAS_MAX", "count > TABLE_AREAS_MAX")), /area limit/);
  assert.throws(() => checkAddRow(mutate(sheet, "areaNameSchema.safeParse(name)", "{ success: true, data: name }")), /areaNameSchema/);
  assert.throws(() => checkHygiene("s", sheet.replace("SKELETON_ROWS = 3", "SKELETON_ROWS = 50"), sheet), /named constants/);
});

test("MUTATION: list pins", () => {
  const list = readSrc(LIST);
  assert.throws(() => checkList(mutate(list, "onError: () => setOrder(latestServerIdsRef.current)", "onError: () => setOrder(order)")), /rolls back/);
  assert.throws(() => checkList(mutate(list, "latestServerIdsRef.current = areas.map((a) => a._id);", "")), /refreshed every render/);
  assert.throws(() => checkList(mutate(list, "if (saving) return;", "")), /move guard/);
  assert.throws(() => checkList(mutate(list, "pickedUpAnnouncement(nameOf(String(active.id))", "pickedUpAnnouncement(String(active.id)")), /announcements speak/);
  assert.throws(() => checkList(mutate(list, "tableCount={tablesInArea(tables, id).length}", "tableCount={0}")), /tablesInArea/);
  assert.throws(() => checkList(mutate(list, "save(arrayMove(order, from, to));", "")), /whole arranged list/);
  assert.throws(() => checkHygiene("l", list, rawOf(LIST) + "\r\n"), /control byte/);
  assert.throws(() => checkHygiene("l", list, rawOf(LIST) + "\nconst c = 'bg-" + "red-500';\n"), /raw status colour/);
});
