// Source pins for the live Floor (Tables redesign, slice B, 2026-09-30): the
// status hook's stale-view fence, per-tile pending, the error/empty branches,
// the open-bill pre-send check, the status vocabulary and the hand-off (the
// table never rides in the URL). Same readSrc + stripComments idiom as the
// sibling *-paths suites. Every negative pin carries a positive landmark, and
// every needle is built by concatenation so it cannot match this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readStripped = (rel: string): string => stripComments(readSrc(rel));

const PAGE = "apps/cafe/app/(dashboard)/tables/page.tsx";
const STATUS_HOOK = "apps/cafe/hooks/use-table-status-action.ts";
const ACTIONS_HOOK = "apps/cafe/hooks/use-floor-actions.ts";
const TILE = "apps/cafe/components/tables/FloorTile.tsx";
const TILE_MENU = "apps/cafe/components/tables/FloorTileMenu.tsx";
const CHIPS = "apps/cafe/components/tables/FloorStatusChips.tsx";
const INDICATOR = "apps/cafe/components/tables/FloorLiveIndicator.tsx";
const DIALOGS = "apps/cafe/components/tables/FloorDialogs.tsx";
const FLOOR_LIB = "apps/cafe/lib/floor-tiles.ts";
const LIVE_PANEL = "apps/cafe/components/dashboard/LiveFloorPanel.tsx";
const TABLES_DIR = "apps/cafe/components/tables";

// Every file that makes up the Floor screen.
const FLOOR_FILES = [PAGE, STATUS_HOOK, ACTIONS_HOOK, TILE, TILE_MENU, CHIPS, INDICATOR, DIALOGS, FLOOR_LIB];

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The `{ ... }` body that starts at the first `{` after `needle`. */
function bodyAfter(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at >= 0, `${needle} must exist`);
  const open = src.indexOf("{", at + needle.length);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  assert.fail(`unbalanced braces after ${needle}`);
}

test("PIN: the status hook echoes the order pointer the tile SAW (stale-view fence)", () => {
  const src = readStripped(STATUS_HOOK);
  assert.ok(src.includes('apiSend<Table>(`/api/tables/${encodeURIComponent(table.tableNo)}`, "PUT", body)'), "landmark: the hook is the PUT writer");
  assert.ok(
    src.includes('expectedCurrentOrderId: table.currentOrderId ?? ""'),
    "the PUT body must send expectedCurrentOrderId from the Table object the tile rendered",
  );
});

test("PIN: pending is per tile with a ref guard; the Floor never uses the shared-pending POS mutation", () => {
  const hook = readStripped(STATUS_HOOK);
  assert.equal(count(hook, "pendingRef.current.has("), 1, "the same-frame double-tap guard");
  assert.ok(hook.includes("pendingRef.current.add(") && hook.includes("pendingRef.current.delete("));
  assert.ok(readStripped(ACTIONS_HOOK).includes("useTableStatusAction("), "landmark: the Floor uses the per-tile hook");
  const banned = "useUpdate" + "Table(";
  for (const f of FLOOR_FILES) assert.ok(!readStripped(f).includes(banned), `${f} must not use the shared-pending mutation`);
});

test("PIN: the full error screen shows only when there is no list to keep showing", () => {
  const src = readStripped(PAGE);
  assert.equal(count(src, "<ErrorState"), 1, "landmark: one ErrorState");
  const at = src.indexOf("<ErrorState");
  const condition = src.slice(src.lastIndexOf("if (", at), at);
  assert.ok(condition.includes("tables.isError"), "the branch keys on the tables query failing");
  assert.ok(condition.includes("data === undefined"), "…and only when no data is cached");
});

test("PIN: the Floor has no role-dependent controls outside the empty state", () => {
  const src = readStripped(PAGE);
  const empty = bodyAfter(src, "function FloorEmptyState()");
  assert.ok(empty.includes("<EmptyState"), "landmark: the empty-state block");
  assert.ok(empty.includes("isAdmin"), "landmark: the empty state is where the role split lives");
  assert.ok(empty.includes("authLoading"), "the empty state waits for the session");
  const rest = src.replace(empty, "");
  // Any role read, not just the isAdmin name: `user.role === "admin"` or a
  // destructured `role` would make a Floor control role-dependent just the same.
  const roleRead = /\bisAdmin\b|\.role\b|\brole\s*[!=]==|\{\s*[^}]*\brole\b[^}]*\}\s*=\s*useAuth/;
  assert.ok(!roleRead.test(rest), "a role read outside FloorEmptyState would make a Floor control role-dependent");
  for (const f of FLOOR_FILES.filter((x) => x !== PAGE)) {
    assert.ok(!roleRead.test(readStripped(f)), `${f} must not branch on the role`);
  }
});

test("PIN: the Floor runs exactly one shared clock", () => {
  let total = 0;
  for (const f of FLOOR_FILES) total += count(readStripped(f), "useNow(");
  assert.equal(total, 1, "one useNow across the Floor files");
  assert.equal(count(readStripped(PAGE), "useNow(FLOOR_CLOCK_TICK_MS)"), 1);
});

test("PIN: every tile shows its status as TEXT, not colour alone", () => {
  const src = readStripped(TILE);
  assert.ok(src.includes("const meta = TABLE_STATUS_META[table.status];"), "the tile reads the shared vocabulary");
  assert.match(src, /aria-hidden \/>\s*\{meta\.label\}\s*<\/span>/, "the chip renders the status label right after its dot");
});

test("PIN: Free, Seat now and Reserve re-read the open bills first and fail closed", () => {
  const src = readStripped(ACTIONS_HOOK);
  assert.equal(count(src, ".refetch("), 1, "one pre-send read");
  assert.equal(count(src, "action.run("), 2, "Reserve and the confirm path are the only writers");
  assert.ok(src.includes("withTimeout(openTabs.refetch(), OPEN_TABS_CHECK_TIMEOUT_MS)"), "the read is bounded");
  assert.match(src, /OPEN_TABS_CHECK_TIMEOUT_MS = 8_000;/);
  assert.ok(src.includes("res.isError"), "a failed refetch resolves (does not throw): its verdict is res.isError");
  assert.ok(src.includes("res.data === undefined"), "a missing result is a failed check");
  assert.ok(src.indexOf(".refetch(") < src.indexOf("action.run("), "the read is defined before any write");
  // The verdict must GATE the write — `await cleared(table);` with the result
  // ignored would still satisfy an ordering-only needle (review C-2).
  const gate = "if (!(await cleared(table))) " + "return;";
  for (const [name, head] of [["confirm", "const confirm = async () =>"], ["reserve", "const reserve = async (table: Table) =>"]] as const) {
    const body = bodyAfter(src, head);
    assert.equal(count(body, "await cleared("), 1, `${name}: one open-bill check`);
    assert.equal(count(body, gate), 1, `${name}: the check's verdict stops the write`);
    assert.ok(body.indexOf(gate) < body.indexOf("action.run("), `${name}: the check runs before the write`);
  }
});

test("PIN: table status colours come only from the shared vocabulary", () => {
  const banned = /bg-(green|red|amber)-500/;
  const files = readdirSync(path.join(REPO_ROOT, TABLES_DIR)).filter((f) => f.endsWith(".tsx"));
  assert.ok(files.length >= 5, "landmark: the tables components directory is populated");
  for (const f of files) assert.ok(!banned.test(readSrc(`${TABLES_DIR}/${f}`)), `${f} carries a raw status colour`);
  assert.ok(!banned.test(readSrc(LIVE_PANEL)), "LiveFloorPanel carries a raw status colour");
  assert.ok(readSrc(LIVE_PANEL).includes("TABLE_STATUS_META"), "landmark: LiveFloorPanel uses the shared vocabulary");
  assert.ok(readSrc(TILE).includes("TABLE_STATUS_META"), "landmark: the tile uses the shared vocabulary");
});

test("PIN: the tile link offers the hand-off only for a plain primary click", () => {
  const src = readStripped(TILE);
  assert.equal(count(src, "offerPosTable("), 1, "landmark: the only place a tap offers the table");
  const handler = bodyAfter(src, "function offerOnPlainClick(");
  assert.ok(handler.includes("e.button !== 0"), "a non-primary click must not offer the table");
  assert.ok(handler.includes("e.metaKey") && handler.includes("e.ctrlKey") && handler.includes("e.shiftKey") && handler.includes("e.altKey"));
  assert.ok(handler.indexOf("e.button") < handler.indexOf("offerPosTable("), "the button check comes first");
  assert.ok(src.includes("onClick={(e) => offerOnPlainClick(e, table.tableNo)}"), "the Link uses the guarded handler");
});

test("PIN: the table never rides in the URL (a query string costs a round trip per tap)", () => {
  const needle = /[?"'`&]table=/;
  for (const f of FLOOR_FILES) assert.ok(!needle.test(readSrc(f)), `${f} builds a URL that carries the table`);
  assert.ok(readStripped(TILE).includes("offerPosTable("), "landmark: the hand-off is the mechanism");
  assert.ok(readStripped(ACTIONS_HOOK).includes("offerPosTable("), "landmark: Seat now hands off too");
  assert.ok(readStripped(TILE).includes("href={FLOOR_POS_PATH}"), "the link is the plain New Order path");
  assert.match(readStripped(FLOOR_LIB), /FLOOR_POS_PATH = "\/pos";/);
});

test("PIN: chips wrap (never scroll sideways) and the ⋯ menu is a 40 px sibling of the tile link", () => {
  const chips = readStripped(CHIPS);
  assert.ok(chips.includes('role="group" aria-label="Filter tables by status"'));
  assert.ok(chips.includes("flex flex-wrap gap-2"));
  assert.ok(!chips.includes("overflow-x"), "a scrolling chip row hides the last state");
  assert.ok(chips.includes("aria-pressed") && chips.includes("min-h-10"));
  assert.ok(readStripped(TILE_MENU).includes("h-10 w-10"), "the menu trigger is a 40 px target");
  const tile = readStripped(TILE);
  assert.ok(tile.indexOf("{surface}") < tile.indexOf("<FloorTileMenu"), "the menu is rendered after (beside) the link, not inside it");
});

test("PIN: the old card and arrange list are gone and the grid uses the shared class", () => {
  assert.ok(!existsSync(path.join(REPO_ROOT, TABLES_DIR, "TableCard.tsx")));
  assert.ok(!existsSync(path.join(REPO_ROOT, TABLES_DIR, "TableArrangeList.tsx")));
  assert.ok(readStripped(PAGE).includes("className={FLOOR_GRID_CLASS}"));
});
