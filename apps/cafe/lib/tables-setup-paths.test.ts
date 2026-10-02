// Source pins for the Tables Setup / QR / sidebar slice (Tables redesign,
// batch 1, 2026-09-30). There is no React test framework in this repo, by
// design, so these read the REAL source (readFileSync) — the same technique as
// table-flow-paths.test.ts. Every pin is a small checker over a source string:
// the tests run it on the real file AND (for the hook file, which this slice
// does not own) prove it FAILS on a deliberately broken copy of that source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const ROW = "apps/cafe/components/tables/TableSetupRow.tsx";
const HOOK = "apps/cafe/hooks/use-tables.ts";
const SETUP_PAGE = "apps/cafe/app/(dashboard)/tables/setup/page.tsx";
const QR_PAGE = "apps/cafe/app/(dashboard)/tables/qr/page.tsx";
const TABLES_GROUP = "apps/cafe/components/layout/SidebarTablesGroup.tsx";
const APP_SIDEBAR = "apps/cafe/components/layout/AppSidebar.tsx";

// ── helpers ─────────────────────────────────────────────────────────────────

/** Index of the `}` matching the `{` at `openIdx`. */
function matchingBraceEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingBraceEnd: no matching closing brace");
}

/** The body (braces included) of the function/handler whose header starts with `header`. */
function bodyOf(src: string, header: string): string {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `landmark: ${header} must exist`);
  const open = src.indexOf("{", start + header.length - 1);
  return src.slice(open, matchingBraceEnd(src, open) + 1);
}

/** The JSX opening tag that starts at the last `<` before `idx`, brace-aware
 *  (a `>` inside `{…}` — an arrow's `=>` — does not end it). */
function tagAround(src: string, idx: number): string {
  const start = src.lastIndexOf("<", idx);
  assert.ok(start >= 0, "landmark: an opening tag precedes the needle");
  let depth = 0;
  for (let end = start; end < src.length; end++) {
    const ch = src[end];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return src.slice(start, end + 1);
  }
  throw new Error("tagAround: unterminated tag");
}

const count = (src: string, needle: string): number => src.split(needle).length - 1;

// Mutation helper: each anchor must match exactly once (a no-op replace would
// make a checker pass and hide a dead mutation); the tests below also match the
// failure MESSAGE so a checker cannot fail for an unrelated reason.
// Whitespace-tolerant (review C-9): every whitespace run in the anchor matches
// any whitespace run in the source, so a re-indent or line wrap of the real
// file does not break these mutation proofs — only a real change of the code.
function mutate(src: string, from: string, to: string): string {
  const pattern = new RegExp(
    from
      .split(/(\s+)/)
      .map((part) => (/^\s+$/.test(part) ? "\\s+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join(""),
    "g",
  );
  assert.equal(src.match(pattern)?.length ?? 0, 1, `mutation anchor must match exactly once: ${from}`);
  return src.replace(pattern, () => to);
}

// ── 1. touch-none only on the grip ──────────────────────────────────────────

function checkTouchNoneOnGripOnly(src: string): void {
  // Vision guard: the row really is a sortable with an activator ref.
  assert.equal(count(src, "ref={setActivatorNodeRef}"), 1, "landmark: exactly one element carries the activator ref");
  assert.ok(src.includes("useSortable("), "landmark: the row uses useSortable");
  const needle = "touch" + "-none";
  assert.equal(count(src, needle), 1, "touch-action none must appear exactly once — the rest of the row has to scroll on a phone");
  const tag = tagAround(src, src.indexOf(needle));
  assert.ok(tag.includes("ref={setActivatorNodeRef}"), "and it must sit on the grip button that carries the activator ref");
}

test("PIN: touch-none sits once, on the grip button that carries setActivatorNodeRef — a row-wide touch-none would make the list unscrollable by touch", () => {
  checkTouchNoneOnGripOnly(readSrc(ROW));
});

// ── 2. tap targets ──────────────────────────────────────────────────────────

function checkTapTargets(src: string): void {
  // Anchored on each control's accessible label (the label text is the landmark).
  const labels = ["Drag to reorder ${t}", "Move ${t} up", "Move ${t} down", "More actions for ${t}"];
  for (const label of labels) {
    const at = src.indexOf(label);
    assert.ok(at >= 0, `landmark: the control labelled "${label}" must exist`);
    const tag = tagAround(src, at);
    assert.match(tag, /(^|[\s"])h-11 w-11([\s"]|$)/, `"${label}": 44px on a phone (h-11 w-11)`);
    assert.match(tag, /(^|[\s"])md:h-10 md:w-10([\s"]|$)/, `"${label}": 40px from md (md:h-10 md:w-10)`);
  }
}

test("PIN: the grip, both arrows and the ⋯ trigger are 44px on a phone and 40px from md (R20)", () => {
  checkTapTargets(readSrc(ROW));
});

// ── 3. useReorderTables: no settle-invalidate, refresh on error ─────────────

function checkReorderHook(src: string): void {
  const body = bodyOf(src, "export function useReorderTables() {");
  // Vision guards: we are reading the real body.
  assert.ok(body.includes("mutationFn"), "landmark: useReorderTables has a mutationFn");
  assert.ok(body.includes("onSuccess: (fresh) => commitTables(qc, fresh)"), "landmark: success commits the response");
  // A settle invalidate's refetch can land on a stale server instance and paint the old order back.
  assert.equal(count(body, "onSettled"), 0, "useReorderTables must not have an onSettled invalidate");
  const errAt = body.indexOf("onError");
  assert.ok(errAt >= 0, "useReorderTables must have an onError");
  assert.match(body.slice(errAt), /(refreshQuietly|refreshTablesNow)\(qc\)/, "onError must re-read the live list");
}

test("PIN: useReorderTables has no onSettled and re-reads the live list in onError", () => {
  checkReorderHook(readSrc(HOOK));
});

// ── 4. use-tables.ts never setQueryData ─────────────────────────────────────

function checkNoSetQueryData(src: string): void {
  assert.ok(src.includes("commitTables("), "landmark: the commit path exists");
  assert.equal(count(src, "setQueryData" + "("), 0, "a plain setQueryData never reaches the device's stored copy of the floor — write through commitTables");
}

test("PIN: hooks/use-tables.ts writes the list only through commitTables — no setQueryData call", () => {
  checkNoSetQueryData(readSrc(HOOK));
});

// ── 5. commitTables order ───────────────────────────────────────────────────

function checkCommitOrder(src: string): void {
  const body = bodyOf(src, "export async function commitTables(qc: QueryClient, list: Table[]): Promise<Table[]> {");
  for (const needle of ["cancelQueries(", "invalidateQueries(", "fetchQuery("]) {
    assert.equal(count(body, needle), 1, `commitTables calls ${needle} exactly once`);
  }
  const cancel = body.indexOf("cancelQueries(");
  const invalidate = body.indexOf("invalidateQueries(");
  const fetchAt = body.indexOf("fetchQuery(");
  assert.ok(cancel < invalidate && invalidate < fetchAt, "order: cancelQueries, then invalidateQueries, then fetchQuery");
  assert.ok(body.slice(invalidate, fetchAt).includes('refetchType: "none"'), 'the invalidate must not refetch (refetchType: "none")');
  assert.ok(body.slice(fetchAt).includes("staleTime: 0"), "the fetchQuery must be forced (staleTime: 0) so it lands in the cache");
}

test('PIN: commitTables cancels, then invalidates with refetchType "none", then fetchQuery with staleTime 0', () => {
  checkCommitOrder(readSrc(HOOK));
});

// Mutation proof for the three hook pins: the hook file belongs to another
// slice, so instead of editing it these run the SAME checkers on broken copies.
test("MUTATION: the hook pins fail on broken copies of use-tables.ts", () => {
  const real = readSrc(HOOK);
  // (a) a settle invalidate added to useReorderTables
  assert.throws(
    () => checkReorderHook(mutate(real, "onSuccess: (fresh) => commitTables(qc, fresh),", "onSuccess: (fresh) => commitTables(qc, fresh),\n    onSettled: () => qc.invalidateQueries({ queryKey: TABLE_KEYS.all }),")),
    /onSettled/,
  );
  // (b) onError no longer re-reads the list (anchor scoped to the reorder hook's own onError)
  const errAt = real.indexOf("onError: async (err: Error) => {", real.indexOf("export function useReorderTables"));
  assert.ok(errAt >= 0, "landmark: the reorder onError");
  assert.throws(
    () => checkReorderHook(real.slice(0, errAt) + mutate(real.slice(errAt, errAt + 200), "await refreshQuietly(qc);", "") + real.slice(errAt + 200)),
    /re-read the live list/,
  );
  // (c) the old write path restored
  assert.throws(() => checkNoSetQueryData(real + "\nexport const oldWrite = (qc: QueryClient, tables: Table[]) => qc.setQueryData(TABLE_KEYS.all, tables);\n"), /setQueryData/);
  // (d) staleTime dropped, (e) refetchType dropped, (f) cancel moved after the invalidate
  assert.throws(() => checkCommitOrder(mutate(real, "staleTime: 0,", "staleTime: 30_000,")), /staleTime: 0/);
  assert.throws(() => checkCommitOrder(mutate(real, 'refetchType: "none"', 'refetchType: "active"')), /refetchType/);
  const cancelLine = "await qc.cancelQueries({ queryKey: TABLE_KEYS.all, exact: true });";
  const swapped = mutate(mutate(real, cancelLine, ""), "return qc.fetchQuery({", `${cancelLine}\n  return qc.fetchQuery({`);
  assert.throws(() => checkCommitOrder(swapped), /order:/);
});

// ── 6. AdminGuard on both pages ─────────────────────────────────────────────

function checkAdminGuarded(src: string): void {
  assert.ok(src.includes("export default function"), "landmark: the page default export exists");
  assert.equal(count(src, "<AdminGuard>"), 1, "the page renders <AdminGuard> once");
  const guard = src.indexOf("<AdminGuard>");
  const shell = src.indexOf("<MenuPageShell>");
  assert.ok(shell > guard, "the guard wraps the page shell, not the other way round");
  assert.ok(src.includes('from "@/components/shared/AdminGuard"'), "AdminGuard is imported from the shared component");
}

test("PIN: the Setup and QR pages are wrapped in <AdminGuard> (the second layer behind the ADMIN_ROUTES edge fence)", () => {
  checkAdminGuarded(readSrc(SETUP_PAGE));
  checkAdminGuarded(readSrc(QR_PAGE));
  // The QR page's old content-level "Admin only" branch is gone (the guard replaces it).
  assert.equal(count(readSrc(QR_PAGE), "Admin " + "only"), 0, "no content-level admin branch on the QR page");
});

// ── 7. sidebar group ────────────────────────────────────────────────────────

function checkTablesGroup(src: string): void {
  assert.match(src, /import\s*\{[^}]*\bTABLES_MANAGE_SECTIONS\b[^}]*\}\s*from\s*"@\/lib\/table-sections"/, "the group imports TABLES_MANAGE_SECTIONS");
  // Re-anchored 2026-10-02: the drop-down holds only Setup + QR (the Floor is its own sidebar row), so no role filter.
  assert.match(src, /TABLES_MANAGE_SECTIONS\.map\(/, "the sub-rows are built from TABLES_MANAGE_SECTIONS (Setup + QR codes only)");
  assert.match(src, /const active = isTableSectionActive\(pathname, section\.href\);/, "each sub-row's flag comes from isTableSectionActive (Floor is an exact match)");
  assert.match(src, /isActive=\{active\}/, "each sub-row lights from its own `active` flag");
  assert.match(src, /aria-current=\{active \? "page" : undefined\}/, "and announces it with aria-current");
  const branchAt = src.indexOf("if (collapsed) {");
  assert.ok(branchAt >= 0, "landmark: the collapsed branch exists");
  const branch = src.slice(branchAt, src.indexOf("\n  }\n", branchAt));
  assert.ok(branch.includes("isActive={onManage}"), "the plain Link lights on ANY manage page (isActive={onManage}), never on the Floor");
  assert.ok(branch.includes("href={TABLES_SETUP_PATH}"), "the collapsed Link points at Setup (the Floor has its own row)");
}

test("PIN: the Tables sidebar group renders from TABLE_SECTIONS, lights and announces each sub-row, and the collapsed Link lights on any Tables page", () => {
  checkTablesGroup(readSrc(TABLES_GROUP));
});

test("PIN: AppSidebar renders <SidebarTablesGroup for the /tables entry", () => {
  const app = readSrc(APP_SIDEBAR);
  const caseAt = app.indexOf('case "/tables/setup":');
  const renderAt = app.indexOf("<SidebarTablesGroup");
  assert.ok(caseAt >= 0 && renderAt > caseAt, 'a case "/tables/setup": precedes the group render');
  assert.equal(count(app, "<SidebarTablesGroup"), 1, "the group is rendered once");
});

// ── 8. Setup page ───────────────────────────────────────────────────────────

function checkSetupHeaderWraps(src: string): void {
  // The LAST PageHeader is the main render's (the first belongs to the error screen, which has no actions).
  const at = src.lastIndexOf("<PageHeader");
  assert.ok(at >= 0, "landmark: the Setup page renders a PageHeader");
  const tag = tagAround(src, at + 1);
  assert.ok(tag.includes("actions={"), "landmark: the whole PageHeader tag (with its actions) was read");
  assert.ok(tag.includes('<div className="flex flex-wrap gap-2">'), "the header actions wrap (flex flex-wrap) so two buttons never overflow a phone");
}

function checkSetupErrorOnlyWithoutData(src: string): void {
  const at = src.indexOf("<ErrorState");
  assert.ok(at >= 0, "landmark: the Setup page has an ErrorState");
  const before = src.slice(Math.max(0, at - 200), at);
  assert.ok(before.includes("tables.data === undefined"), "the full error screen shows only when no list is on screen (data === undefined)");
}

test("PIN: the Setup header actions wrap, and its ErrorState shows only when there is no data to keep showing", () => {
  const src = readSrc(SETUP_PAGE);
  checkSetupHeaderWraps(src);
  checkSetupErrorOnlyWithoutData(src);
});

// ── 9. checkers are not vacuous: they fail on broken copies of the owned files

test("MUTATION: the source pins fail on broken copies of the files this slice owns", () => {
  const row = readSrc(ROW);
  const grip = "touch" + "-none";
  assert.throws(() => checkTouchNoneOnGripOnly(mutate(row, "shrink-0 " + grip + " ", "shrink-0 ")), /exactly once/);
  assert.throws(
    () => checkTouchNoneOnGripOnly(mutate(row, "<li\n      ref={setNodeRef}", '<li\n      ref={setNodeRef} data-x="' + grip + '"')),
    /exactly once/,
  );
  assert.throws(
    () => checkTapTargets(mutate(row, 'aria-label={`Move ${t} up`}\n          className="flex h-11 w-11', 'aria-label={`Move ${t} up`}\n          className="flex h-9 w-9')),
    /Move .* up/,
  );
  assert.throws(
    () => checkTapTargets(mutate(row, 'md:h-10 md:w-10"\n            aria-label={`More actions', '"\n            aria-label={`More actions')),
    /More actions/,
  );

  const group = readSrc(TABLES_GROUP);
  assert.throws(() => checkTablesGroup(mutate(group, "isActive={onManage}", "isActive={exact}")), /isActive=\{onManage\}/);
  assert.throws(() => checkTablesGroup(mutate(group, "href={TABLES_SETUP_PATH}", "href={TABLES_FLOOR_PATH}")), /Floor has its own row/);
  assert.throws(() => checkTablesGroup(mutate(group, 'aria-current={active ? "page" : undefined}', "")), /aria-current/);
  assert.throws(() => checkTablesGroup(mutate(group, "TABLES_MANAGE_SECTIONS.map(", "[].map(")), /Setup \+ QR codes only/);

  const setup = readSrc(SETUP_PAGE);
  assert.throws(() => checkAdminGuarded(mutate(setup, "<AdminGuard>", "<div>")), /<AdminGuard> once/);
  assert.throws(() => checkSetupHeaderWraps(mutate(setup, "flex flex-wrap gap-2", "flex gap-2")), /flex-wrap/);
  assert.throws(
    () => checkSetupErrorOnlyWithoutData(mutate(setup, "tables.isError && tables.data === undefined", "tables.isError")),
    /data === undefined/,
  );
});
