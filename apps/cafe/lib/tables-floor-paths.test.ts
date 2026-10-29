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

import { FLOOR_PILLS_ROW_CLASS } from "@/lib/floor-layout";
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
const INDICATOR = "apps/cafe/components/tables/FloorRefreshStrip.tsx";
const DIALOGS = "apps/cafe/components/tables/FloorDialogs.tsx";
const FLOOR_LIB = "apps/cafe/lib/floor-tiles.ts";
const SECTIONS = "apps/cafe/components/tables/FloorAreaSections.tsx";
// U3 Task 1 (2026-10-28): the Floor's frame classes and route (the page, the scroller, the body; isFloorPath).
const LAYOUT_LIB = "apps/cafe/lib/floor-layout.ts";
// U3 Task 2 (2026-10-28): the area tabs, the rows' fades, and the area rules (tabs, the shown area, the sections).
const AREA_TABS = "apps/cafe/components/tables/FloorAreaTabs.tsx";
const SCROLL_FADES = "apps/cafe/hooks/use-scroll-fades.ts";
const AREAS_LIB = "apps/cafe/lib/floor-areas.ts";
// U3 Task 3 (2026-10-28): the tile's view (tone, words, accessible name) and the tile / section classes (ruling F1).
const VIEW_LIB = "apps/cafe/lib/floor-view.ts";
const TILE_CLASSES_LIB = "apps/cafe/lib/floor-tile-classes.ts";
// U3 Task 4 fix round 2 (2026-10-28): the rise cascade's window and each table's first index (re-review M1).
const RISE_LIB = "apps/cafe/lib/floor-rise.ts";
const STATES = "apps/cafe/components/tables/FloorStates.tsx"; // U3 Task 6: the skeleton and the two empty states
const LIVE_PANEL = "apps/cafe/components/dashboard/LiveFloorPanel.tsx";
const TABLES_DIR = "apps/cafe/components/tables";

// Every file that makes up the Floor screen.
const FLOOR_FILES = [
  PAGE, STATUS_HOOK, ACTIONS_HOOK, TILE, TILE_MENU, CHIPS, INDICATOR, DIALOGS, FLOOR_LIB, SECTIONS, LAYOUT_LIB, AREA_TABS, SCROLL_FADES, AREAS_LIB,
  VIEW_LIB, TILE_CLASSES_LIB, RISE_LIB, STATES,
];

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

// U3 Task 6 (P4's needles moved on purpose, the meaning kept): FloorEmptyState moved to FloorStates.tsx (a Next page
// exports only its default, so it could not be rendered in tests) in the HTML's empty style (design 6.7).
test("PIN: the Floor has no role-dependent controls outside the empty state", () => {
  const src = readStripped(STATES);
  const empty = bodyAfter(src, "export function FloorEmptyState()");
  assert.ok(empty.includes('data-ui="floor-empty"'), "landmark: the empty-state block");
  assert.ok(empty.includes("isAdmin"), "landmark: the empty state is where the role split lives");
  assert.ok(empty.includes("authLoading"), "the empty state waits for the session");
  const rest = src.replace(empty, "");
  // Any role read, not just the isAdmin name: `user.role === "admin"` or a
  // destructured `role` would make a Floor control role-dependent just the same.
  const roleRead = /\bisAdmin\b|\.role\b|\brole\s*[!=]==|\{\s*[^}]*\brole\b[^}]*\}\s*=\s*useAuth/;
  assert.ok(!roleRead.test(rest), "a role read outside FloorEmptyState would make a Floor control role-dependent");
  for (const f of FLOOR_FILES.filter((x) => x !== STATES)) {
    assert.ok(!roleRead.test(readStripped(f)), `${f} must not branch on the role`);
  }
});

test("PIN: the Floor runs exactly one shared clock", () => {
  let total = 0;
  for (const f of FLOOR_FILES) total += count(readStripped(f), "useNow(");
  assert.equal(total, 1, "one useNow across the Floor files");
  assert.equal(count(readStripped(PAGE), "useNow(FLOOR_CLOCK_TICK_MS)"), 1);
});

// U3 Task 3 (P6 moved on purpose, design 6.5 / values 4.2): the tile's look is the HTML's per-state tone (a Floor map in
// lib/floor-view.ts, never TABLE_STATUS_META, which Setup and the dashboard read) and its word the pills' word, Bill
// printed included. Kept: the status is TEXT next to its colour, the tint and the word from the same tone entry.
test("PIN: every tile shows its status as TEXT, not colour alone", () => {
  const src = readStripped(TILE);
  assert.ok(src.includes("const view = floorTileView(tile, tabsFailed);"), "the tile reads its view (tone, word, detail)");
  assert.ok(src.includes("const tone = FLOOR_TILE_TONES[view.tone];"), "the tile reads the Floor's tone map");
  assert.match(
    src,
    /className=\{cn\(FLOOR_TILE_STATUS_CLASS, tone\.label, slotRoom\)\}>[\s\S]*?className=\{FLOOR_TILE_WORD_CLASS\}>\s*\{view\.label\}\s*<\/span>/,
    "the status word renders as text inside the line that wears the state's ink",
  );
  assert.ok(src.includes("cn(FLOOR_TILE_CLASS, tone.tile"), "the tint comes from the same tone entry as the word's ink");
  assert.ok(readStripped(VIEW_LIB).includes("const tone = floorFilterOf(tile);"), "the tone is the pill the tile counts in (counts and tiles agree)");
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
  // U3 Task 3 (P8 landmark moved on purpose, design 6.5): the tile's colours are the Floor's tone map of status tokens.
  assert.ok(readSrc(TILE).includes("FLOOR_TILE_TONES"), "landmark: the tile uses the Floor's tone map");
  assert.ok(!banned.test(readSrc(VIEW_LIB)), "the tone map carries no raw status colour");
  assert.ok(readSrc(VIEW_LIB).includes("bg-status-info-tint"), "landmark: the tone map is status tokens");
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

// U3 Task 2 (P11 moved on purpose, owner Q4 / design 6.3): the pills scroll sideways as the HTML's row, with an edge fade
// and the chosen pill scrolled into view ("chips never hide a state off-screen" is retired by Q4). Kept: the group label,
// the pressed state, the ⋯ beside (never inside) the tile; U3 Task 4 moves its 40px needle to 44 / 32 (design 6.5), its
// fix round 1 to a base 44 px with 32 only for a fine pointer (logic-4: the same boxes, and 44 under (pointer: none)).
test("PIN: the pills scroll sideways with the group label and aria-pressed; the area tabs name their group; the ⋯ menu is a 44 / 32 px sibling of the tile link", () => {
  const chips = readStripped(CHIPS);
  assert.ok(chips.includes('role="group" aria-label="Filter tables by status"'), "the pills' group label");
  assert.ok(chips.includes("className={FLOOR_PILLS_ROW_CLASS}"), "the row wears the pills row class");
  assert.ok(FLOOR_PILLS_ROW_CLASS.split(/\s+/).includes("overflow-x-auto"), "the HTML's sideways row (Q4)");
  assert.ok(chips.includes("aria-pressed={on}"), "each pill says whether it is chosen");
  const tabs = readStripped(AREA_TABS);
  assert.ok(tabs.includes('role="group" aria-label="Filter tables by area"'), "the area tabs' group label");
  assert.ok(tabs.includes("aria-pressed={on}"), "each tab says whether it is chosen");
  assert.ok(readStripped(TILE_MENU).includes("className={FLOOR_TILE_TRIGGER_CLASS}") && /\ssize-11 pointer-fine:size-8\s/.test(readStripped(TILE_CLASSES_LIB)), "the menu trigger is 44 px, 32 px with a fine pointer");
  const tile = readStripped(TILE);
  assert.ok(tile.indexOf("{surface}") < tile.indexOf("<FloorTileMenu"), "the menu is rendered after (beside) the link, not inside it");
});

// Q4: the chosen tab / pill is revealed by its row's own scrollLeft; scrollIntoView would scroll the page (and the shell).
test("PIN: no Floor file scrolls the page to reveal a control", () => {
  const banned = "scrollInto" + "View(";
  for (const f of FLOOR_FILES) assert.ok(!readStripped(f).includes(banned), `${f} must not call ${banned}`);
  assert.ok(readStripped(SCROLL_FADES).includes("revealScrollLeft("), "landmark: the reveal is the row's own scrollLeft");
  // Fix round 1 (logic-1, pin moved on purpose): the pills' reveal is keyed on the area shown too.
  assert.ok(readStripped(AREA_TABS).includes("useRevealPressed(rowRef, value)"), `landmark: ${AREA_TABS} reveals through its row`);
  assert.ok(readStripped(CHIPS).includes("useRevealPressed(rowRef, `${value}|${revealKey}`)"), `landmark: ${CHIPS} reveals through its row`);
  assert.ok(readStripped(SCROLL_FADES).includes('addEventListener("focusin", '), "landmark: keyboard focus reveals through the row too");
});

// Review Focus 1 (design 6.3): the chosen area is kept as a choice, but the page shows only the area it still holds.
test("PIN: the page groups, counts and filters by shownArea (effectiveArea), never the raw choice; Show all tables resets both", () => {
  const page = readStripped(PAGE);
  assert.equal(count(page, "const [area, setArea] = useState(FLOOR_ALL_AREAS);"), 1, "the choice resets on every visit");
  assert.equal(count(page, "const areaTabs = floorAreaTabs(tiles, areas.data);"), 1, "the tabs from every tile");
  assert.equal(count(page, "const shownArea = effectiveArea(area, areaTabs);"), 1, "the area shown");
  assert.equal(count(page, "tilesInArea(tiles, areas.data, shownArea)"), 1, "the pills count the area shown");
  assert.equal(count(page, "floorCounts(inArea)"), 1, "landmark: the counts follow the area (design 6.3)");
  // Fix round 1 (logic-2): the empty check and the flat grid read the area shown too, so an area + pill with no match
  // shows the empty line and Show all tables, never a blank body.
  assert.equal(count(page, "const visible = filterTiles(inArea, filter);"), 1, "the empty check and the flat grid filter the area shown");
  assert.ok(page.includes("<FloorStatusChips counts={floorCounts(inArea)} value={filter} revealKey={shownArea} onChange={setFilter} />"), "the pills re-reveal the chosen one per area shown (logic-1)");
  for (const raw of ["floorSections(tiles, areas.data, filter, area)", "tilesInArea(tiles, areas.data, area)", "value={area}"]) {
    assert.ok(!page.includes(raw), `the raw choice never reaches ${raw}`);
  }
  assert.ok(page.includes("{areaTabs.length > 0 && <FloorAreaTabs tabs={areaTabs} value={shownArea} onChange={setArea} />}"), "tabs only with two groups");
  const reset = bodyAfter(page, "const showAllTables = () =>");
  assert.ok(reset.includes('setFilter("all")') && reset.includes("setArea(FLOOR_ALL_AREAS)"), "Show all tables resets the pill and the area");
  const states = readStripped(STATES); // U3 Task 6 (moved on purpose, the meaning kept): FloorFilterEmpty, design 6.7
  assert.ok(page.includes("<FloorFilterEmpty onShowAll={showAllTables} />") && states.includes("{FLOOR_EMPTY_FILTER_TEXT}") && states.includes("onClick={onShowAll}"), "the HTML's line and our reset");
});

test("PIN: area sections - one tile renderer, headings only when floorSections says so, flat grid otherwise", () => {
  const page = readStripped(PAGE);
  const sections = readStripped(SECTIONS);
  assert.equal(count(page, "<FloorTile"), 1, "landmark: ONE tile call site (the renderTile closure) - sections and the flat grid share it");
  assert.equal(count(page, "useTableAreas(tables.data)"), 1, "the page heals/reads areas through the one hook");
  // U3 Task 2 (P12 literal moved on purpose): the sections take the area shown (Review Focus 1).
  assert.equal(count(page, "floorSections(tiles, areas.data, filter, shownArea)"), 1, "the page groups through floorSections");
  assert.equal(count(page, "<FloorAreaSections groups={sections.groups} renderTile={renderTile} />"), 1);
  // Branch order: the empty state comes first, then headings, then today's flat grid.
  const empty = page.indexOf("visible.length === 0");
  const headed = page.indexOf("sections.showHeadings");
  const flat = page.indexOf("<div className={FLOOR_GRID_CLASS}>{visible.map(");
  assert.ok(empty >= 0 && headed > empty && flat > headed, "empty state, then headings, then the flat grid");
  // Each section is a labelled region whose heading is the area name, over the shared grid class.
  assert.ok(sections.includes("aria-labelledby={headingId}") && sections.includes("id={headingId}"));
  assert.ok(sections.includes("<h2") && sections.includes("group.summary") && sections.includes("title={group.name}"));
  assert.equal(count(sections, "className={FLOOR_GRID_CLASS}"), 1, "every section reuses the one grid class");
  // U3 Task 3 (P12's divider needle retired on purpose, design 6.4 / values 3.1): the HTML's sections have no divider;
  // the body's 16px gap parts them.
  assert.ok(sections.includes("className={FLOOR_SECTION_CLASS}"), "landmark: each section wears the HTML's section class");
  assert.ok(!/border-t|divide-|brand-rule/.test(sections), "no divider between sections");
  // The screen never reads a table's area link itself: grouping is lib/table-areas + floorSections.
  const bare = /\bareaId\b/;
  for (const f of [PAGE, SECTIONS, TILE, AREA_TABS]) assert.ok(!bare.test(readStripped(f)), `${f} must not read the area link`);
  // U3 Task 2 (ruling F1): the grouping moved with floorSections to lib/floor-areas.ts, same helpers.
  assert.ok(readStripped(AREAS_LIB).includes("groupByArea(tiles, (tile) => tableAreaIdOf(tile.table), areas)"), "landmark: floorSections groups via the shared helpers");
});

// Review finding (2026-10-02), MEASURED at 360 px: "Available" + "New order ›" was 3 px wider than the tile, so the
// status word — the tile's only text signal — truncated to an ellipsis. U3 Task 3 (P13 moved on purpose, design 6.5):
// the action word left the tile; the meaning stays — the status word never wraps and is never cut.
test("PIN: the tile's status word is never clipped", () => {
  const src = readStripped(TILE);
  assert.ok(src.includes("{view.label}"), "landmark: the status word is in the tile");
  assert.ok(src.includes("<span data-ui=\"floor-tile-word\" className={FLOOR_TILE_WORD_CLASS}>"), "the word wears its own class");
  const classes = readStripped(TILE_CLASSES_LIB);
  assert.match(classes, /export const FLOOR_TILE_WORD_CLASS = "whitespace-nowrap";/, "the word never wraps");
  const line = /export const FLOOR_TILE_STATUS_CLASS = "([^"]*)";/.exec(classes)?.[1] ?? "";
  assert.ok(line.includes("flex"), "landmark: the status line's class");
  assert.ok(!/\btruncate\b|overflow-hidden|text-ellipsis/.test(line), "the status line never cuts the word");
});

// keep-4: P17's word left the tile (U3 Task 3); "Free table" stays on the ⋯ menu and the free confirm (design 11).
test("PIN: the word Free table stays on the ⋯ menu and the free confirm", () => {
  assert.ok(readStripped(TILE_MENU).includes('free: "Free table"') && readStripped(DIALOGS).includes('confirmLabel: "Free table"'), "the menu's free label and the free confirm's label read Free table");
});

// Owner, 2026-10-02: the Floor moved into the sidebar's Service group, right under New Order and Orders — the
// eyebrow names the group the page sits in, as on every screen (polish-pages-paths pins the one-header pages).
test("PIN: both Floor headers carry the Service eyebrow and the Floor title", () => {
  const page = readStripped(PAGE);
  assert.equal(count(page, "<PageHeader"), 2, "landmark: the error screen and the live floor each have one header");
  assert.equal((page.match(/<PageHeader\s+eyebrow="Service"\s+title="Floor"/g) ?? []).length, 2);
});

test("PIN: the old card and arrange list are gone and the grid uses the shared class", () => {
  assert.ok(!existsSync(path.join(REPO_ROOT, TABLES_DIR, "TableCard.tsx")));
  assert.ok(!existsSync(path.join(REPO_ROOT, TABLES_DIR, "TableArrangeList.tsx")));
  assert.ok(readStripped(PAGE).includes("className={FLOOR_GRID_CLASS}"));
});
