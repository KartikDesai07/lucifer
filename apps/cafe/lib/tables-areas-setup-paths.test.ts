// Source pins for Tables batch 2, slice B2 (2026-09-30): the Setup list grouped by
// area (one drag context per area, guards, group-local announcements), the table
// form's Area field, and the Setup page wiring. No React test framework here by
// design, so each pin is a checker over a source string; every pin runs on the
// real file AND is proven to FAIL on a deliberately broken copy (MUTATION tests).
// Negative pins carry a positive landmark; ordering pins assert existence and
// uniqueness of each needle before comparing positions. The form, page and hook
// pins live in tables-areas-form-paths.test.ts (this file kept under 300 lines).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rawOf = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readSrc = (rel: string): string => stripComments(rawOf(rel));

const LIST = "apps/cafe/components/tables/TableSetupList.tsx";
const FIELD = "apps/cafe/components/tables/TableAreaField.tsx";

const ELLIPSIS = "…";

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

// The link field is read only through lib/table-areas helpers (the bare
// identifier is banned outside the form/field/hooks that must name it).
const bareLink = (src: string): boolean => new RegExp("\\b" + "area" + "Id\\b").test(src);

// ── 1. TableSetupList: order, re-seed, rollback ref ─────────────────────────
function checkListOrder(list: string): void {
  const n = norm(list);
  assert.ok(n.includes("useState<string[]>(() => composeAreaOrder(tables, areas))"), "order starts as the area-contiguous flat list");
  assert.match(n, /useEffect\(\(\) => \{ setOrder\(composeAreaOrder\(tables, areas\)\);[^}]*\}, \[areaSignature\]\);/, "re-seed effect is keyed on areaSignature");
  assert.ok(n.includes("const areaSignature = areaOrderSignature(tables, areas);"), "the key is areaOrderSignature");
  assert.equal(count(list, "latestServerIdsRef.current = composeAreaOrder(tables, areas);"), 1, "the rollback ref is refreshed from composeAreaOrder every render");
  assert.equal(count(list, "tables.map((t) => t.tableNo)"), 0, "no flat re-derivation of the order");
  assert.equal(count(list, "groupTablesByArea("), 1, "landmark: grouping goes through groupTablesByArea");
  assert.ok(!bareLink(list), "the list never reads a table's area link itself");
  assert.ok(n.includes("setOrder(next); reorder.mutate(next, { onError: () => setOrder(latestServerIdsRef.current) });"), "the pinned save body is unchanged");
}
test("PIN: Setup order is composeAreaOrder, re-seeded on areaOrderSignature, rolled back to the latest composed order", () => checkListOrder(readSrc(LIST)));

// ── 2. one DndContext + SortableContext + ul PER group, one shared sensors ───
function checkGroupedDnd(list: string): void {
  for (const tag of ["<DndContext", "<SortableContext", "<ul", "useSensors(", "sensors={sensors}"]) assert.equal(count(list, tag), 1, `exactly one ${tag} (per-group via the map, sensors shared)`);
  const mapAt = list.indexOf("groups.map((group) =>");
  assert.ok(mapAt >= 0, "landmark: the group map");
  const [dnd, sortable, ul] = ["<DndContext", "<SortableContext", "<ul"].map((t) => list.indexOf(t));
  assert.ok(mapAt < dnd && dnd < sortable && sortable < ul, "the drag context, sortable context and list are built INSIDE the groups map");
  assert.ok(list.indexOf("</DndContext>") > ul, "landmark: the context closes after its list");
  const n = norm(list);
  assert.ok(n.includes("total={group.items.length}") && n.includes("group.items.map((table, index) =>"), "arrows are guarded per group (index/total of the group)");
  assert.equal(count(list, "order.length"), 0, "no whole-list position/total anywhere");
  assert.ok(n.includes("accessibility={{ announcements: groupAnnouncements(ids) }}"), "announcements are group-local");
  assert.ok(!bodyOf(list, "function groupAnnouncements(ids: readonly string[]): Announcements {").includes("order"), "and never read the whole order");
  assert.equal(count(list, 'className="divide-y rounded-lg border bg-background"'), 1, "the list keeps today's classes");
}
test("PIN: each area is its own DndContext + SortableContext + ul; sensors shared; arrows and announcements group-local", () => checkGroupedDnd(readSrc(LIST)));

// ── 3. group guards sit inside the pinned bodies, in order ───────────────────
function checkGuards(list: string): void {
  const move = bodyOf(list, "const move = (tableNo: string, delta: -1 | 1) => {");
  inOrder(move, "move", ["if (saving) return;", "sameAreaGroup(groupKeys, tableNo, neighbour)", "const next = moveId(order, tableNo, delta);", "save(next);"]);
  const drag = bodyOf(list, "const handleDragEnd = (event: DragEndEvent) => {");
  inOrder(drag, "drag", ["if (from < 0 || to < 0) return;", "sameAreaGroup(groupKeys, String(active.id), String(over.id))", "save(arrayMove(order, from, to));"]);
}
test("PIN: sameAreaGroup guards the arrow step (after the saving guard, before moveId) and the drag end (before the save)", () => checkGuards(readSrc(LIST)));

// ── 4. headings gated; zero areas keep today's DOM ──────────────────────────
function checkHeadings(list: string): void {
  const n = norm(list);
  assert.equal(count(list, "<h2"), 1, "landmark: one heading element");
  assert.equal(count(n, "{headings && ( <h2"), 1, "the heading renders only when headings show");
  assert.ok(n.includes("const headings = showAreaHeadings(groups);"), "gate is showAreaHeadings");
  assert.ok(n.includes("{group.name}") && n.includes("tableCountText(group.items.length)"), "name plus table count");
  assert.ok(n.includes('return headings ? <div className="space-y-2">{lists}</div> : <>{lists}</>;'), "no wrapper element without headings: the flat list's DOM");
  assert.ok(n.includes("<Fragment key={group.key}>"), "landmark: groups are keyed fragments");
}
test("PIN: headings show only with showAreaHeadings; with none the markup is the bare list", () => checkHeadings(readSrc(LIST)));

// ── 5. the Area field ────────────────────────────────────────────────────────
function checkField(field: string): void {
  const n = norm(field);
  for (const copy of [
    '<FormField label="Area"',
    "<SelectItem value={NO_AREA_CHOICE}>No area</SelectItem>",
    `+ New area${ELLIPSIS}`,
    `<SelectValue>Loading areas${ELLIPSIS}</SelectValue>`,
    "Tables are grouped by area on the floor and in New Order.",
    'aria-label="New area name"',
    'placeholder="e.g. Garden"',
    "maxLength={TABLE_AREA_NAME_MAX_LEN}",
    "const loading = areas === undefined;",
    "disabled={loading || disabled}",
    "{choice === NEW_AREA_CHOICE && (",
  ]) assert.ok(n.includes(copy), `field: ${copy}`);
  assert.equal(count(field, "(areas ?? []).map("), 1, "landmark: areas are listed from the list as given");
  assert.equal(count(field, ".sort("), 0, "and never re-sorted (the arranged order is the server's)");
  assert.equal(count(field, "<Input"), 1, "landmark: one name input");
  // C-9: choosing "+ New area" moves focus to the name box, not back to the trigger.
  assert.ok(n.includes("focusNameRef.current = next === NEW_AREA_CHOICE;"), "the pick arms the focus");
  inOrder(bodyOf(field, "onCloseAutoFocus={(event) => {"), "close focus", ["if (!focusNameRef.current) return;", "event.preventDefault();", "nameRef.current?.focus();"]);
  assert.ok(!bareLink(field), "the field names no link property of its own");
  // A saved area id the list no longer holds must show the placeholder, never a blank box.
  assert.ok(n.includes('<Select value={known ? choice : ""}'), "the Select value is empty when the saved area is not in the list");
  assert.ok(n.includes('<SelectValue placeholder="Pick an area" />'), "and the placeholder reads Pick an area");
  assert.ok(n.includes("(areas !== undefined && areas.some((a) => a._id === choice))"), "known means the id is in the loaded list");
  assert.ok(n.includes("choice === NO_AREA_CHOICE || choice === NEW_AREA_CHOICE ||"), "No area and + New area are always known");
}
test("PIN: the Area field's copy, loading state, list order and the focus hand-off to the new-name box", () => checkField(readSrc(FIELD)));

// ── 6. hygiene ──────────────────────────────────────────────────────────────
function checkHygiene(name: string, src: string, raw: string): void {
  assert.ok(src.length > 500, `landmark: ${name} was read`);
  assert.equal(count(src, "console" + "."), 0, `${name}: console`);
  assert.ok(!/lucifer/i.test(raw), `${name}: cafe name`);
  assert.ok(!/bg-(green|red|amber)-500/.test(raw), `${name}: raw status colour`);
  assert.ok(raw.split("\n").length <= 300, `${name}: under 300 lines`);
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    assert.ok(c >= 0x20 || c === 0x0a || c === 0x09, `${name}: control byte ${c} at ${i}`);
  }
}
test("PIN: the list and the field: no console, cafe name, raw colours, control bytes or CR; under 300 lines", () => {
  for (const f of [LIST, FIELD]) checkHygiene(f, readSrc(f), rawOf(f));
});

// ── MUTATION proofs ─────────────────────────────────────────────────────────
test("MUTATION: list pins", () => {
  const list = readSrc(LIST);
  assert.throws(() => checkListOrder(mutate(list, "[areaSignature]", "[serverOrder]")), /keyed on areaSignature/);
  assert.throws(() => checkListOrder(mutate(list, "latestServerIdsRef.current = composeAreaOrder(tables, areas);", "")), /rollback ref/);
  assert.throws(() => checkListOrder(mutate(list, "useState<string[]>(() => composeAreaOrder(tables, areas))", "useState<string[]>(() => tables.map((t) => t.tableNo))")), /area-contiguous/);
  assert.throws(() => checkListOrder(`${list}\nconst adHoc = tables.filter((t) => t.` + "area" + `Id === "x");\n`), /never reads/);
  assert.throws(() => checkListOrder(mutate(list, "setOrder(next);", "setOrder(next.slice());")), /pinned save body/);
  // hoist the DndContext out of the map
  const s = list.indexOf("<DndContext");
  const e = list.indexOf("</DndContext>") + "</DndContext>".length;
  const without = list.slice(0, s) + "null" + list.slice(e);
  const at = without.indexOf("const lists = groups.map");
  const hoisted = without.slice(0, at) + "const hoisted = " + list.slice(s, e) + ";\n  " + without.slice(at);
  assert.throws(() => checkGroupedDnd(hoisted), /INSIDE the groups map/);
  assert.throws(() => checkGroupedDnd(mutate(list, "sensors={sensors}", "sensors={useSensors()}")), /exactly one/);
  assert.throws(() => checkGroupedDnd(mutate(list, "total={group.items.length}", "total={ids.length + tables.length}")), /per group/);
  assert.throws(() => checkGroupedDnd(mutate(list, "groupAnnouncements(ids)", "groupAnnouncements(order)")), /group-local/);
  assert.throws(() => checkGroupedDnd(mutate(list, "const ids = group.items.map((t) => t.tableNo);", "const ids = order; const total = order.length;")), /order\.length|whole-list/);
  // guards
  const guard = "if (neighbour === undefined || !sameAreaGroup(groupKeys, tableNo, neighbour)) return;";
  assert.throws(() => checkGuards(mutate(list, guard, "")), /move/);
  assert.throws(() => checkGuards(mutate(list, `${guard}\n    const next = moveId(order, tableNo, delta);`, `const next = moveId(order, tableNo, delta);\n    ${guard}`)), /out of order|exactly once/);
  assert.throws(() => checkGuards(mutate(list, "if (saving) return;", "")), /move/);
  const dragGuard = "if (!sameAreaGroup(groupKeys, String(active.id), String(over.id))) return;";
  assert.throws(() => checkGuards(mutate(list, dragGuard, "")), /drag/);
  assert.throws(() => checkGuards(mutate(list, `${dragGuard}\n    save(arrayMove(order, from, to));`, `save(arrayMove(order, from, to));\n    ${dragGuard}`)), /out of order/);
  // headings
  assert.throws(() => checkHeadings(mutate(list, "{headings && (", "{true && (")), /only when headings show/);
  assert.throws(() => checkHeadings(mutate(list, ": <>{lists}</>", ": <div>{lists}</div>")), /flat list's DOM/);
  assert.throws(() => checkHeadings(mutate(list, "const headings = showAreaHeadings(groups);", "const headings = groups.length > 0;")), /showAreaHeadings/);
  assert.throws(() => checkHygiene("l", list, rawOf(LIST) + "\r\n"), /control byte/);
});

test("MUTATION: field pins", () => {
  const field = readSrc(FIELD);
  assert.throws(() => checkField(mutate(field, `Loading areas${ELLIPSIS}`, "Wait")), /Loading areas/);
  assert.throws(() => checkField(mutate(field, "No area</SelectItem>", "None</SelectItem>")), /No area/);
  assert.throws(() => checkField(mutate(field, "disabled={loading || disabled}", "disabled={disabled}")), /loading/);
  assert.throws(() => checkField(mutate(field, "(areas ?? []).map(", "[...(areas ?? [])].sort().map(")), /as given/);
  assert.throws(() => checkField(mutate(field, "nameRef.current?.focus();", "")), /close focus/);
  assert.throws(() => checkField(mutate(field, "event.preventDefault();", "")), /close focus/);
  assert.throws(() => checkField(mutate(field, "focusNameRef.current = next === NEW_AREA_CHOICE;", "")), /arms the focus/);
  assert.throws(() => checkField(mutate(field, "maxLength={TABLE_AREA_NAME_MAX_LEN}", "maxLength={24}")), /maxLength/);
  assert.throws(() => checkField(mutate(field, 'value={known ? choice : ""}', "value={choice}")), /Select value is empty/);
  assert.throws(() => checkField(mutate(field, 'placeholder="Pick an area"', 'placeholder="Choose"')), /Pick an area/);
  assert.throws(() => checkField(mutate(field, "areas.some((a) => a._id === choice)", "true")), /in the loaded list/);
  assert.throws(() => checkField(mutate(field, "choice === NO_AREA_CHOICE ||", "")), /always known/);
  assert.throws(() => checkField(mutate(field, "Tables are grouped by area on the floor and in New Order.", "Grouped.")), /grouped by area/);
});
