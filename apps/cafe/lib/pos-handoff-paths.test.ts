// Tables -> New Order hand-off SOURCE pins (Tables redesign B1 Slice D, ruling
// R9: a one-shot session-store hand-off, never a URL parameter). Raw
// readFileSync pins, like lib/pos-header-paths.test.ts. Every needle is built by
// concatenation so this file never matches its own source line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { OPEN_TABS_FILTERS } from "@/lib/table-pick";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readCode = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const POS_HEADER = "apps/cafe/components/pos/PosHeader.tsx";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const HANDOFF = "apps/cafe/components/pos/PosTableHandoff.tsx";
const TABLE_SELECTOR = "apps/cafe/components/pos/TableSelector.tsx";

const count = (src: string, needle: string): number => src.split(needle).length - 1;

// The resolver's own body: from its declaration to the outer component's props.
function resolverBody(src: string): string {
  const start = src.indexOf("function " + "HandoffResolver(");
  const end = src.indexOf("interface " + "PosTableHandoffProps");
  assert.ok(start >= 0 && end > start, "landmark: HandoffResolver must exist before PosTableHandoffProps");
  return src.slice(start, end);
}

test("PIN: PosHeader renders exactly one hand-off component and the page never does", () => {
  const header = readCode(POS_HEADER);
  assert.match(header, /<TableSelector\b/, "landmark: PosHeader must still render <TableSelector");
  assert.equal(count(header, "<" + "PosTableHandoff"), 1, "PosHeader must render exactly one hand-off component");
  assert.match(header, /import \{ PosTableHandoff \} from "@\/components\/pos\/PosTableHandoff"/);
  const page = readCode(POS_PAGE);
  assert.ok(count(page, "<" + "PosHeader") === 1, "landmark: the page must render <PosHeader once");
  assert.ok(!page.includes("PosTable" + "Handoff"), "pos/page.tsx is pinned at 299 lines — the hand-off lives in PosHeader");
});

test("PIN: the hand-off is taken once, in a mount effect, and never from the URL", () => {
  const src = readCode(HANDOFF);
  const body = src.replace(/import[^;]*;/g, "");
  const takes = count(body, "takePosTableHandoff" + "(");
  assert.equal(takes, 1, "landmark: exactly one takePosTableHandoff( call");
  assert.match(body, /useEffect\(\(\) => \{\s*const \w+ = takePosTableHandoff\(Date\.now\(\)\);\s*if \(\w+\) setWanted\(\w+\);\s*\}, \[\]\);/,
    "the take must sit in a mount effect that only ever sets a table (StrictMode-safe)");
  for (const banned of ["useSearch" + "Params", "replace" + "State", "location" + ".search", "history" + ".", "?table" + "="]) {
    assert.ok(!src.includes(banned), `the hand-off must not touch the URL (${banned})`);
  }
});

test("PIN: the resolver decides with handoffPickAction and acts through onResume / onSelect", () => {
  const src = readCode(HANDOFF);
  assert.equal(count(src, "handoffPickAction" + "("), 1);
  assert.equal(count(src, "onResume" + "(tab)"), 1, "resume must go through the page's requestResume");
  assert.equal(count(src, "onSelect" + "(t)"), 1);
  assert.equal(count(src, "refreshTablesNow" + "("), 1);
  assert.match(src, /DEEP_LINK_MAX_WAIT_MS = 15_000;/);
  const body = resolverBody(src);
  assert.match(body, /useOrders\(OPEN_TABS_FILTERS, OPEN_TABS_QUERY_OPTIONS\)/, "same open-tabs key as the page's own query");
  assert.match(body, /tablesReady = tables\.data !== undefined && tables\.fetchStatus === "idle"/);
  assert.match(body, /tabsSettled = tabs\.isFetchedAfterMount && tabs\.fetchStatus === "idle"/);
  assert.match(body, /tabsReady = tabsSettled && !tabs\.isError/);
  assert.match(body, /tabsFailed = tabsSettled && tabs\.isError/);
});

test("PIN: every refusal passes the one fresh floor read before its toast (R12)", () => {
  const body = resolverBody(readCode(HANDOFF));
  const gate = body.indexOf('verdict.kind === "refuse" && fresh === null');
  const refresh = body.indexOf("refreshTablesNow" + "(");
  const toastAt = body.indexOf("toast." + "error(");
  assert.equal(count(body, "toast." + "error("), 1, "one toast site, so no refusal can bypass the gate");
  assert.equal(count(body, "refreshTablesNow" + "("), 1);
  assert.ok(gate >= 0 && refresh >= 0 && toastAt >= 0, "gate, refresh and toast must all exist");
  assert.ok(gate < refresh && refresh < toastAt, "gate -> refresh -> toast, in that order");
  assert.ok(toastAt - gate < 1500, "the toast stays within the gate's own block (upper bound)");
  // The refusal copy lives in judge() and is only ever surfaced through the verdict.
  for (const copy of ["is not on the floor plan", "is reserved", "has no open bill", "Free it on the Tables floor first."]) {
    assert.equal(count(readCode(HANDOFF), copy), 1, `refusal copy present once: ${copy}`);
  }
});

test("PIN: TableSelector uses the shared pick rule, not its old inline lookup", () => {
  const src = readCode(TABLE_SELECTOR);
  assert.match(src, /<button\b/, "landmark: the tile button must still render");
  assert.equal(count(src, "tablePickAction" + "("), 1);
  assert.ok(!src.includes("tabs?.find((o) => o.tableNo === t.tableNo)"), "the old inline find must be gone");
  assert.match(src, /pick\.kind !== "select"/);
});

test("PIN: the page's open-tabs filter literal equals OPEN_TABS_FILTERS", () => {
  const page = readCode(POS_PAGE);
  const m = page.match(/useOrders\((\{[^}]*\}), OPEN_TABS_QUERY_OPTIONS\)/);
  assert.ok(m, "landmark: the page's open-tabs useOrders call must exist");
  const literal: unknown = JSON.parse(m![1].replace(/(\w+):/g, '"$1":'));
  assert.deepEqual(literal, OPEN_TABS_FILTERS);
  assert.deepEqual(Object.keys(OPEN_TABS_FILTERS).sort(), ["payment", "status"]);
});
