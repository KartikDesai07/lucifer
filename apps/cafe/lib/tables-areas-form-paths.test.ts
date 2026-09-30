// Source pins for Tables batch 2, slice B2 (2026-09-30), part 2: the table form's
// area handling (reset inside the open effect, one saving flag, create-then-save
// ordering, the retry that never re-creates), the Setup page wiring, and the
// create-area hook the form leans on. Part 1 (the grouped list and the field) is
// tables-areas-setup-paths.test.ts. Each pin runs on the real file AND is proven
// to FAIL on a broken copy; negative pins carry a positive landmark.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rawOf = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readSrc = (rel: string): string => stripComments(rawOf(rel));

const FORM = "apps/cafe/components/tables/TableFormSheet.tsx";
const PAGE = "apps/cafe/app/(dashboard)/tables/setup/page.tsx";
const HOOK = "apps/cafe/hooks/use-areas.ts";

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

/** Every needle exists exactly once and they appear in the given order. */
function inOrder(src: string, label: string, needles: readonly string[]): void {
  let last = -1;
  for (const needle of needles) {
    assert.equal(count(src, needle), 1, `${label}: landmark must appear exactly once: ${needle}`);
    const at = src.indexOf(needle);
    assert.ok(at > last, `${label}: out of order at: ${needle}`);
    last = at;
  }
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

const bareLink = (src: string): boolean => new RegExp("\\b" + "area" + "Id\\b").test(src);

// ── 1. the form resets its area state with the rest, inside the open effect ──
function checkFormReset(form: string): void {
  assert.equal(count(form, "useEffect("), 1, "landmark: one effect (the open/reset effect)");
  const effect = bodyOf(form, "useEffect(() => {");
  for (const part of ["reset(", "setChoice(initialAreaChoice(table ?? undefined));", 'setNewName("");', "setAreaError(undefined);", "setCreatedArea(undefined);"]) {
    assert.ok(effect.includes(part), `the open effect must reset: ${part}`);
  }
  assert.ok(norm(form).includes("}, [open, table, reset]);"), "keyed on open/table");
}
test("PIN: choice, new name, area error and the created area reset INSIDE the open effect, next to reset()", () => checkFormReset(readSrc(FORM)));

// ── 2. one saving flag covers all three writes ──────────────────────────────
function checkSaving(form: string): void {
  assert.ok(norm(form).includes("const saving = createArea.isPending || createTable.isPending || patchTable.isPending;"), "saving covers the area create, the table create and the table patch");
  assert.ok(norm(form).includes("saving={saving}"), "landmark: the sheet's submit is disabled by it");
  assert.ok(norm(form).includes("disabled={saving}"), "and the area field is frozen while it is set");
}
test("PIN: saving = createArea.isPending || createTable.isPending || patchTable.isPending", () => checkSaving(readSrc(FORM)));

// ── 3. submit: resolve, create the area, THEN save the table ─────────────────
function checkSubmit(form: string): void {
  const submit = bodyOf(form, "const onSubmit = async (values: TableFormValues) => {");
  inOrder(submit, "submit", [
    "resolveAreaChoice(choice, newName, areasQuery.data, createdArea)",
    'resolved.kind === "invalid"',
    "createArea.mutateAsync(",
    "setCreatedArea({ id: created._id, name: created.name });",
    "setChoice(created._id);",
    "patchTable.mutateAsync(",
    "createTable.mutateAsync(",
  ]);
  const invalidAt = submit.indexOf('resolved.kind === "invalid"');
  assert.ok(/^[^}]*setAreaError\(resolved\.message\);\s*return;/.test(submit.slice(invalidAt)), "an invalid pick shows its message and stops before any write");
  assert.ok(norm(submit).includes("...areaPatchOf(initialAreaChoice(table), nextAreaId)"), "edit sends only the area change (nothing / clear / move)");
  assert.equal(count(submit, "...(nextAreaId ? { areaId: nextAreaId } : {})"), 1, "create sends an area only when one is set");
  assert.ok(norm(submit).includes('resolved.kind === "create"'), "landmark: only a typed new name creates an area");
  assert.equal(count(form, "zodResolver(createTableSchema)"), 1, "the table schema still validates the form");
}
test("PIN: submit resolves the pick, creates a new area once, remembers it, and only then saves the table", () => checkSubmit(readSrc(FORM)));

function checkFormCopy(form: string): void {
  const n = norm(form);
  assert.ok(n.includes(`"Change this table's name, seats, area or charge."`), "edit description");
  inOrder(form, "layout", ['label="Seats"', "<TableAreaField", 'label="Extra charge (optional)"']);
  assert.ok(n.includes("setChoice(next); setAreaError(undefined);"), "picking clears a stale area error");
  assert.ok(n.includes("setNewName(name); setAreaError(undefined);"), "typing clears a stale area error");
  assert.ok(n.includes("resolveAreaChoice(") && !n.includes("localeCompare"), "duplicate matching is the helper's, not the form's");
}
test("PIN: the form's copy and the Area field sits between Seats and the charge", () => checkFormCopy(readSrc(FORM)));

// ── 4. Setup page wiring ────────────────────────────────────────────────────
function checkPage(page: string): void {
  const n = norm(page);
  assert.equal(count(page, "useTableAreas(tables.data)"), 1, "the page reads areas through useTableAreas (with the self-heal)");
  assert.ok(n.includes('import { AreasSheet } from "@/components/tables/AreasSheet";'), "landmark: the sheet is imported");
  assert.ok(n.includes("<AreasSheet open={areasOpen} onOpenChange={setAreasOpen} tables={list} />"), "and rendered with the loaded tables");
  inOrder(page, "header", ["flex flex-wrap gap-2", '<Layers className="mr-2 h-4 w-4" /> Areas', "Print QR codes"]);
  assert.ok(n.includes('<Button variant="outline" onClick={() => setAreasOpen(true)}'), "Areas is an outline button that opens the sheet");
  // The sheet's in-use counts come from the tables list: the button waits for it.
  assert.ok(n.includes('<Button variant="outline" onClick={() => setAreasOpen(true)} disabled={tables.data === undefined}> <Layers'), "Areas is disabled until the tables have loaded");
  assert.ok(n.includes("tables.data === undefined || areas.data === undefined ? ("), "skeleton while tables or areas are undefined");
  inOrder(page, "loading", ["tables.data === undefined || areas.data === undefined ? (", "<Skeleton", "list.length === 0 ? ("]);
  assert.ok(n.includes("<TableSetupList tables={list} areas={areas.data}"), "the list gets the areas");
  assert.ok(!bareLink(page), "the page never reads a table's area link itself");
}
test("PIN: Setup renders <AreasSheet> from a header Areas button before Print QR codes; skeleton until areas load", () => checkPage(readSrc(PAGE)));

function checkPageErrors(page: string): void {
  assert.equal(count(page, "<ErrorState"), 2, "landmark: a tables error screen and an areas error screen");
  inOrder(page, "errors", [
    "tables.isError && tables.data === undefined",
    "Couldn't load the tables",
    "areas.isError && areas.data === undefined",
    "Couldn't load the areas",
    "onRetry={() => areas.refetch()}",
  ]);
  assert.ok(norm(page).includes('retryLabel="Try again"'), "landmark: retry copy");
}
test("PIN: Setup's tables error comes first; an areas-only failure has its own copy", () => checkPageErrors(readSrc(PAGE)));

function checkPageCopy(page: string): void {
  const n = norm(page);
  assert.equal(count(page, "showAreaHeadings("), 1, "headings gate is the helper");
  assert.equal(count(page, "namedAreaCount("), 1, "the area count is the helper's (Other tables not counted)");
  assert.ok(n.includes('`${tableCountText(list.length)} in ${areaCount} ${areaCount === 1 ? "area" : "areas"} · drag within an area, or move a table to another area from Edit`'), "description with headings");
  assert.ok(n.includes("drag to arrange"), "landmark: today's description survives for the flat list");
  assert.ok(n.includes('{headings ? "Drag the handle, or use the up and down arrows, to arrange tables within their area. Changes save at once." : "Drag the handle, or use the up and down arrows. Changes save at once."}'), "footnote by mode");
}
test("PIN: Setup's description and footnote change only when area headings show", () => checkPageCopy(readSrc(PAGE)));

// ── 5. the create-area hook the form leans on ───────────────────────────────
function checkCreateAreaHook(hook: string): void {
  const body = bodyOf(hook, "export function useCreateArea() {");
  inOrder(body, "create hook", ["apiSend<Area>(", "await commitAreaChange(qc, (list) => withAreaRow(list, created));", "return created;"]);
  assert.ok(/onError:[\s\S]*toast\.error\(err\.message[\s\S]*void refreshQuietly\(qc\);/.test(body), "a failed create shows the server copy and re-reads the areas (a duplicate then resolves to the existing area)");
}
test("PIN: useCreateArea settles only after its commit, and re-reads the list on error", () => checkCreateAreaHook(readSrc(HOOK)));

// A refused delete may mean the tables list on screen was stale: re-read it, quietly.
function checkDeleteAreaHook(hook: string): void {
  const del = bodyOf(hook, "export function useDeleteArea() {");
  assert.ok(/onError:[\s\S]*toast\.error\(err\.message[\s\S]*void refreshQuietly\(qc\);[\s\S]*void refreshTablesQuietly\(qc\);/.test(del), "a failed delete re-reads the areas AND the tables");
  assert.equal(count(del, "refreshTablesQuietly(qc)"), 1, "landmark: one tables re-read, in onError");
  assert.ok(del.indexOf("refreshTablesQuietly(qc)") > del.indexOf("onError:"), "and not on the success path");
  const quiet = bodyOf(hook, "async function refreshTablesQuietly(qc: QueryClient): Promise<void> {");
  assert.ok(/try \{\s*await refreshTablesNow\(qc\);\s*\} catch \{/.test(quiet), "the re-read is awaited inside a try/catch that swallows an offline error");
  assert.ok(/import \{ refreshTablesNow \} from "@\/hooks\/use-tables";/.test(hook), "landmark: refreshTablesNow comes from the tables hook");
}
test("PIN: useDeleteArea re-reads the tables list too on error (a stale in-use count heals)", () => checkDeleteAreaHook(readSrc(HOOK)));

// ── 6. hygiene ──────────────────────────────────────────────────────────────
function checkHygiene(name: string, src: string, raw: string): void {
  assert.ok(src.length > 500, `landmark: ${name} was read`);
  assert.equal(count(src, "console" + "."), 0, `${name}: console`);
  assert.ok(!/lucifer/i.test(raw), `${name}: cafe name`);
  assert.ok(raw.split("\n").length <= 300, `${name}: under 300 lines`);
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    assert.ok(c >= 0x20 || c === 0x0a || c === 0x09, `${name}: control byte ${c} at ${i}`);
  }
}
test("PIN: form and page: no console, cafe name, control bytes or CR; under 300 lines", () => {
  for (const f of [FORM, PAGE]) checkHygiene(f, readSrc(f), rawOf(f));
});

// ── MUTATION proofs ─────────────────────────────────────────────────────────
test("MUTATION: form pins", () => {
  const form = readSrc(FORM);
  assert.throws(() => checkFormReset(mutate(form, "setCreatedArea(undefined);", "")), /must reset/);
  assert.throws(() => checkFormReset(mutate(form, "setChoice(initialAreaChoice(table ?? undefined));", "")), /must reset/);
  assert.throws(() => checkFormReset(mutate(form, "setAreaError(undefined);\n    setCreatedArea(undefined);\n  }, [open, table, reset]);", "}, [open, table, reset]);\n  useEffect(() => { setAreaError(undefined); setCreatedArea(undefined); }, []);")), /one effect|must reset/);
  assert.throws(() => checkSaving(mutate(form, "createArea.isPending || createTable.isPending", "createTable.isPending")), /saving covers/);
  assert.throws(() => checkSaving(mutate(form, "disabled={saving}", "")), /frozen/);
  // order: create the area only AFTER the table save
  const late = mutate(
    mutate(form, "const created = await createArea.mutateAsync({ name: resolved.name });", "const created = { _id: nextAreaId ?? \"\", name: \"\" };"),
    "onOpenChange(false);\n    } catch",
    "await createArea.mutateAsync({ name: resolved.name });\n      onOpenChange(false);\n    } catch",
  );
  assert.throws(() => checkSubmit(late), /out of order/);
  assert.throws(() => checkSubmit(mutate(form, "setCreatedArea({ id: created._id, name: created.name });", "")), /submit: landmark/);
  assert.throws(() => checkSubmit(mutate(form, "resolveAreaChoice(choice, newName, areasQuery.data, createdArea)", "resolveAreaChoice(choice, newName, areasQuery.data)")), /submit: landmark/);
  assert.throws(() => checkSubmit(mutate(form, "setAreaError(resolved.message);\n      return;", "setAreaError(resolved.message);")), /stops before any write/);
  assert.throws(() => checkSubmit(mutate(form, "...areaPatchOf(initialAreaChoice(table), nextAreaId)", "...(nextAreaId ? { areaId: nextAreaId } : {})")), /exactly once|edit sends/);
  assert.throws(() => checkSubmit(mutate(form, "...(nextAreaId ? { areaId: nextAreaId } : {})", "areaId: nextAreaId")), /landmark|create sends/);
  assert.throws(() => checkSubmit(mutate(form, "zodResolver(createTableSchema)", "zodResolver(z.any())")), /table schema/);
  assert.throws(() => checkFormCopy(mutate(form, "seats, area or charge.", "seats or charge.")), /edit description/);
  assert.throws(() => checkFormCopy(mutate(form, "setChoice(next);\n          setAreaError(undefined);", "setChoice(next);")), /stale area error/);
  assert.throws(() => checkFormCopy(mutate(form, "<TableAreaField", "<div data-x")), /layout|landmark/);
  assert.throws(() => checkHygiene("f", form, rawOf(FORM) + "\r\n"), /control byte/);
});

test("MUTATION: page and hook pins", () => {
  const page = readSrc(PAGE);
  assert.throws(() => checkPage(mutate(page, " disabled={tables.data === undefined}", "")), /disabled until the tables/);
  assert.throws(() => checkPage(mutate(page, "disabled={tables.data === undefined}", "disabled={areas.data === undefined}")), /disabled until the tables/);
  assert.throws(() => checkPage(mutate(page, "useTableAreas(tables.data)", "useAreas()")), /useTableAreas/);
  assert.throws(() => checkPage(mutate(page, "<AreasSheet open={areasOpen} onOpenChange={setAreasOpen} tables={list} />", "")), /rendered/);
  assert.throws(() => checkPage(mutate(page, "onClick={() => setAreasOpen(true)}", "onClick={() => undefined}")), /opens the sheet/);
  assert.throws(() => checkPage(mutate(page, "tables.data === undefined || areas.data === undefined ? (", "tables.data === undefined ? (")), /skeleton/);
  assert.throws(() => checkPage(mutate(page, "areas={areas.data}", "areas={[]}")), /gets the areas/);
  assert.throws(() => checkPage(mutate(page, "Print QR codes", "Areas QR codes")), /header|exactly once/);
  assert.throws(() => checkPageErrors(mutate(page, "Couldn't load the areas", "Couldn't load this")), /Couldn't load the areas/);
  assert.throws(() => checkPageErrors(mutate(page, "areas.isError && areas.data === undefined", "areas.isError")), /errors: landmark/);
  assert.throws(() => checkPageCopy(mutate(page, "const headings = showAreaHeadings(groups);", "const headings = groups.length > 1;")), /helper|headings gate/);
  assert.throws(() => checkPageCopy(mutate(page, "to arrange tables within their area.", "to arrange tables.")), /footnote/);
  assert.throws(() => checkPageCopy(mutate(page, "drag within an area, or move a table to another area from Edit", "drag to arrange")), /description with headings/);
  assert.throws(() => checkPage(`${page}\nconst adHoc = list.filter((t) => t.` + "area" + `Id === "x");\n`), /never reads/);
  assert.throws(() => checkHygiene("p", page + "\nconsole" + ".log(1);\n", rawOf(PAGE)), /console/);

  const hook = readSrc(HOOK);
  const tablesRead = "void refreshQuietly(qc);\n      void refreshTablesQuietly(qc);";
  assert.throws(() => checkDeleteAreaHook(mutate(hook, tablesRead, "void refreshQuietly(qc);")), /AND the tables/);
  assert.throws(() => checkDeleteAreaHook(mutate(hook, tablesRead, "void refreshQuietly(qc);\n      void refreshTablesNow(qc);")), /AND the tables/);
  assert.throws(() => checkDeleteAreaHook(mutate(hook, "try {\n    await refreshTablesNow(qc);\n  } catch {", "try {\n    void refreshTablesNow(qc);\n  } catch {")), /try\/catch/);
  assert.throws(() => checkDeleteAreaHook(mutate(hook, 'import { refreshTablesNow } from "@/hooks/use-tables";', "")), /comes from the tables hook/);
  assert.throws(() => checkCreateAreaHook(mutate(hook, "await commitAreaChange(qc, (list) => withAreaRow(list, created));", "void commitAreaChange(qc, (list) => withAreaRow(list, created));")), /create hook/);
  assert.throws(() => checkCreateAreaHook(mutate(hook, "toast.error(err.message || \"Could not add the area\");\n      void refreshQuietly(qc);", "toast.error(err.message || \"Could not add the area\");")), /re-reads the areas/);
});
