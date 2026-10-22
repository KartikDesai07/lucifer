// U1 Task 11: the rules of the HTML's "Choose a table" sheet (lib/table-sheet.ts; values 9 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.12). The New Order table picker (TableSelector) and the
// Move / Assign dialog (MoveTablePicker, shared with the Orders page and the dashboard) draw every tile from these two
// functions, so the restyle cannot change which tile a cashier can tap or what a tap does.
import { test } from "node:test";
import assert from "node:assert/strict";

import { TABLE_STATUSES, type TableStatus } from "@/lib/constants";
import { isFreeTable } from "@/lib/table-status";
import {
  MOVE_LEGEND,
  SELECTOR_DESCRIPTION,
  SELECTOR_LEGEND,
  TABLE_SHEET_TITLE,
  WALK_IN_TABLE_LABEL,
  freeText,
  freeTileCount,
  moveTile,
  seatsText,
  selectorTile,
  tileDelay,
} from "@/lib/table-sheet";
import type { Order, Table } from "@/types";

const TABLE_NO = "T-1";

function tabFor(tableNo: string, orderId: string, total = 1090, customerName = "Manan Shroff"): Order {
  // Only tableNo / total / customerName are read by the rules under test.
  return { _id: `id-${orderId}`, orderId, tableNo, total, customerName } as unknown as Order;
}

function table(status: TableStatus, extra: Partial<Table> = {}): Table {
  // Only tableNo / status / capacity / currentOrderId are read by the rules under test.
  return { _id: "t-1", tableNo: TABLE_NO, status, capacity: 4, ...extra } as Table;
}

// The rule TableSelector ran inline before this restyle (and lib/table-pick.test.ts's oracle): which tile is disabled,
// and what a tap does. Copied, not imported, so a change on either side shows here.
function todaysSelectorRule(
  t: Table,
  tabs: readonly Order[] | undefined,
  isSelected: boolean,
  hasOnResume: boolean,
): { disabled: boolean; resume: Order | undefined } {
  const tab = tabs?.find((o) => o.tableNo === t.tableNo);
  const resumable = t.status === "Occupied" && !!tab && hasOnResume;
  const disabled = !isSelected && !resumable && t.status !== "Available";
  return { disabled, resume: tab && resumable ? tab : undefined };
}

test("EQUIVALENCE: selectorTile keeps today's taps for status x tabs x chosen x onResume (resume, select, disabled)", () => {
  const mine = tabFor(TABLE_NO, "ORD-1");
  const tabsVariants: ReadonlyArray<readonly [string, readonly Order[] | undefined]> = [
    ["undefined", undefined],
    ["empty", []],
    ["other table only", [tabFor("T-2", "ORD-2")]],
    ["this table", [mine]],
    ["this table among others", [tabFor("T-2", "ORD-2"), mine, tabFor("T-3", "ORD-3")]],
  ];
  assert.equal(TABLE_STATUSES.length, 3, "landmark: the matrix covers every status");
  let combos = 0;
  for (const status of TABLE_STATUSES) {
    for (const [tabsName, tabs] of tabsVariants) {
      for (const selected of [false, true]) {
        for (const canResume of [true, false]) {
          const t = table(status);
          const tile = selectorTile(t, { selected, tabs, canResume });
          const today = todaysSelectorRule(t, tabs, selected, canResume);
          const where = `${status} / tabs ${tabsName} / chosen ${selected} / onResume ${canResume}`;
          assert.equal(tile.disabled, today.disabled, `${where}: disabled`);
          assert.equal(tile.resume, today.resume, `${where}: a tap resumes this tab (else it selects the table)`);
          combos += 1;
        }
      }
    }
  }
  assert.equal(combos, 3 * 5 * 2 * 2, "every combination was compared");
});

test("selectorTile: an occupied table holding an open tab still resumes it, reads the HTML's '₹x open' and keeps the customer's name", () => {
  const tab = tabFor(TABLE_NO, "ORD-9", 1090, "Manan Shroff");
  const tile = selectorTile(table("Occupied"), { selected: false, tabs: [tab], canResume: true });
  assert.equal(tile.kind, "open", "the HTML's 'has an order' tile");
  assert.equal(tile.disabled, false, "tappable");
  assert.equal(tile.resume, tab, "a tap resumes that very tab");
  assert.equal(tile.label, "₹1,090 open", "the HTML's label with our total");
  assert.ok(tile.title.includes("Manan Shroff"), "the customer's name stays on the tile (its title), as today's tile showed it");
  assert.ok(tile.title.includes(TABLE_NO), "the title names the table in full (a long name truncates on the tile)");
});

test("selectorTile: occupied without a tab and reserved stay disabled; Available is Free; the chosen table is Current and tappable", () => {
  const occupied = selectorTile(table("Occupied"), { selected: false, tabs: [], canResume: true });
  assert.deepEqual([occupied.kind, occupied.label, occupied.disabled], ["occupied", "Occupied", true], "occupied, no tab");
  const noResume = selectorTile(table("Occupied"), { selected: false, tabs: [tabFor(TABLE_NO, "ORD-1")], canResume: false });
  assert.deepEqual([noResume.kind, noResume.disabled], ["occupied", true], "a tab but no way to resume it: occupied, as today");
  const reserved = selectorTile(table("Reserved"), { selected: false, tabs: [], canResume: true });
  assert.deepEqual([reserved.kind, reserved.label, reserved.disabled], ["reserved", "Reserved", true], "reserved");
  const free = selectorTile(table("Available"), { selected: false, tabs: [], canResume: true });
  assert.deepEqual([free.kind, free.label, free.disabled, free.resume], ["free", "Free", false, undefined], "available");
  for (const status of TABLE_STATUSES) {
    const chosen = selectorTile(table(status), { selected: true, tabs: [], canResume: true });
    assert.deepEqual([chosen.kind, chosen.label, chosen.disabled], ["current", "Current", false], `the chosen ${status} table`);
  }
  const chosenWithTab = selectorTile(table("Occupied"), { selected: true, tabs: [tabFor(TABLE_NO, "ORD-1")], canResume: true });
  assert.equal(chosenWithTab.kind, "open", "a chosen table now holding another tab reads what a tap does: it opens that tab");
});

test("moveTile: only a free table that is not the tab's own can be tapped (today's rule), each in its look", () => {
  const cases: ReadonlyArray<readonly [string, Table, string | undefined, string, string, boolean]> = [
    ["free", table("Available"), "T-9", "free", "Free", false],
    ["the tab's own table", table("Available"), TABLE_NO, "current", "Current", true],
    ["the tab's own occupied table", table("Occupied"), TABLE_NO, "current", "Current", true],
    ["occupied", table("Occupied"), "T-9", "occupied", "Occupied", true],
    ["available but still holding an order", table("Available", { currentOrderId: "o-1" }), "T-9", "occupied", "Occupied", true],
    ["reserved", table("Reserved"), "T-9", "reserved", "Reserved", true],
    ["free, assigning a walk-in tab", table("Available"), undefined, "free", "Free", false],
  ];
  for (const [what, t, current, kind, label, disabled] of cases) {
    const tile = moveTile(t, current);
    assert.deepEqual([tile.kind, tile.label, tile.disabled], [kind, label, disabled], what);
    assert.equal(tile.disabled, !(t.tableNo !== current && isFreeTable(t)), `${what}: today's tappable = !isCurrent && isFreeTable(t)`);
  }
});

test("the words: the HTML's title and legend; ours for the move legend and the walk-in", () => {
  assert.equal(TABLE_SHEET_TITLE, "Choose a table", "owner Q1: the HTML's title");
  assert.deepEqual(SELECTOR_LEGEND.map((i) => i.label), ["Free", "Has an order · tap to open", "Reserved"], "the HTML's legend");
  assert.deepEqual(SELECTOR_LEGEND.map((i) => i.kind), ["free", "open", "reserved"], "each word beside its tile's dot");
  // The move dialog cannot open another tab (it also opens on the Orders page): its middle word says what its tiles are.
  assert.deepEqual(MOVE_LEGEND.map((i) => i.label), ["Free", "Occupied", "Reserved"], "the move dialog's legend");
  assert.deepEqual(MOVE_LEGEND.map((i) => i.kind), ["free", "occupied", "reserved"], "each word beside its tile's dot");
  assert.ok(SELECTOR_DESCRIPTION.startsWith("Occupied and reserved tables can't take a new order"), "today's description stays as the sub");
  assert.equal(WALK_IN_TABLE_LABEL, "Walk-In (no table)", "today's walk-in words");
});

test("the counts and the stagger: '{n} free' per area (free tiles only), '{n} seat(s)', 20 ms between tiles", () => {
  assert.equal(freeTileCount(["free", "open", "free", "reserved", "current", "occupied"]), 2, "only free tiles count");
  assert.equal(freeTileCount([]), 0, "an empty area");
  assert.equal(freeText(6), "6 free", "upper-cased by its style, as the HTML's");
  assert.equal(seatsText(1), "1 seat", "singular, never the HTML's plural slip");
  assert.equal(seatsText(4), "4 seats", "plural");
  assert.equal(tileDelay(0), "0.00s", "the first tile at once");
  assert.equal(tileDelay(3), "0.06s", "values 9.2: d = k x .02s");
  // Ruling P52 (U1 audit wave, report M4): capped at 0.3s, as the HTML's own Open orders rows (a real floor has 40+ tables).
  assert.equal(tileDelay(14), "0.28s", "under the cap: still k x .02s");
  assert.equal(tileDelay(15), "0.30s", "the cap itself");
  assert.equal(tileDelay(40), "0.30s", "a 40-table area's last tile waits 0.3s, not 0.8s");
  assert.equal(tileDelay(500), "0.30s", "far over the cap: 0.3s");
});
