// Pure-rule tests for the live Floor (lib/floor-tiles.ts): the tap table row by
// row, long stay at its boundary, summary / freshness strings, filters. The area
// tabs and the sections are lib/floor-areas.test.ts's (U3 Task 2, ruling F1).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FLOOR_EMPTY_FILTER_TEXT,
  FLOOR_FILTERS,
  FLOOR_GRID_CLASS,
  FLOOR_PRIMARY_LABEL,
  filterTiles,
  floorCounts,
  floorFilterOf,
  floorSummaryText,
  formatStayMinutes,
  itemCountOf,
  longStay,
  minutesOpen,
  reservationForTable,
  updatedLabel,
  type FloorTileModel,
} from "@/lib/floor-tiles";
import { MIN, NOW, build, printed, reservation, tab, table } from "@/lib/floor-tiles.fixtures";
import type { TableStatus } from "@/lib/constants";

function only(tiles: FloorTileModel[]): FloorTileModel {
  assert.equal(tiles.length, 1);
  return tiles[0];
}

test("the grid class keeps auto-fill with a 9.5rem floor (6 wide on a PC, 2 on a phone)", () => {
  assert.match(FLOOR_GRID_CLASS, /repeat\(auto-fill,minmax\(9\.5rem,1fr\)\)/);
});

test("tap rules: Occupied with an open bill opens it", () => {
  const t = only(build([table("T-1", "Occupied", { currentOrderId: "ORD-T-1" })], [tab("T-1", 10)]));
  assert.equal(t.primary, "open");
  assert.deepEqual(t.menu, []);
});

test("tap rules: Occupied whose bill is gone (Pay Now left the pointer) offers Free table", () => {
  const t = only(build([table("T-1", "Occupied", { currentOrderId: "ORD-DONE" })], []));
  assert.equal(t.primary, "free");
  assert.equal(FLOOR_PRIMARY_LABEL[t.primary], "Free table");
  assert.deepEqual(t.menu, []);
});

test("tap rules: Occupied with the bills not loaded yet opens (never Free)", () => {
  const t = only(build([table("T-1", "Occupied")], undefined));
  assert.equal(t.primary, "open");
  assert.equal(t.tabsKnown, false);
});

test("tap rules: Available with no bill starts a new order and can be reserved", () => {
  const t = only(build([table("T-2", "Available")], []));
  assert.equal(t.primary, "new-order");
  assert.deepEqual(t.menu, ["reserve"]);
});

test("tap rules: Available with the bills unknown starts a new order, no Reserve", () => {
  const t = only(build([table("T-2", "Available")], undefined));
  assert.equal(t.primary, "new-order");
  assert.deepEqual(t.menu, []);
});

test("tap rules (R18): Available WITH a matching open bill opens it, no Reserve / Free", () => {
  const t = only(build([table("T-2", "Available")], [tab("T-2", 5)]));
  assert.equal(t.primary, "open");
  assert.deepEqual(t.menu, []);
});

test("tap rules: Reserved with no bill = Seat now, with Free in the menu", () => {
  const t = only(build([table("T-4", "Reserved")], []));
  assert.equal(t.primary, "seat-now");
  assert.deepEqual(t.menu, ["free"]);
});

test("Free / Seat now / Reserve are never offered when the bills are unknown or a bill matches", () => {
  const statuses: TableStatus[] = ["Occupied", "Available", "Reserved"];
  for (const status of statuses) {
    for (const tabs of [undefined, [tab("T-9", 5)]]) {
      const t = only(build([table("T-9", status)], tabs));
      assert.notEqual(t.primary, "free", `${status}/${tabs ? "tab" : "unknown"}`);
      assert.notEqual(t.primary, "seat-now", `${status}/${tabs ? "tab" : "unknown"}`);
      assert.deepEqual(t.menu, [], `${status}/${tabs ? "tab" : "unknown"}`);
    }
  }
});

test("a bill on another table never counts for this table", () => {
  const t = only(build([table("T-2", "Occupied")], [tab("T-1", 5)]));
  assert.equal(t.tab, undefined);
  assert.equal(t.primary, "free");
});

test("long stay flips exactly at the threshold (59 no, 60 yes)", () => {
  assert.equal(only(build([table("A", "Occupied")], [tab("A", 59)])).longStay, false);
  assert.equal(only(build([table("A", "Occupied")], [tab("A", 60)])).longStay, true);
  assert.equal(longStay(60, 60), true);
  assert.equal(longStay(59, 60), false);
  assert.equal(longStay(null, 60), false);
});

test("before the clock exists there is no stay text and no long stay", () => {
  const t = only(build([table("A", "Occupied")], [tab("A", 500)], undefined, null));
  assert.equal(t.minutesOpen, null);
  assert.equal(t.longStay, false);
  assert.equal(formatStayMinutes(t.minutesOpen), "—");
});

test("minutesOpen: clock skew reads Just now, a bad date is null", () => {
  assert.equal(minutesOpen(new Date(NOW + 5 * MIN).toISOString(), NOW), 0);
  assert.equal(formatStayMinutes(minutesOpen(new Date(NOW + 5 * MIN).toISOString(), NOW)), "Just now");
  assert.equal(minutesOpen("not a date", NOW), null);
  assert.equal(minutesOpen(new Date(NOW - 90 * 1000).toISOString(), NOW), 1);
});

test("formatStayMinutes", () => {
  assert.equal(formatStayMinutes(0), "Just now");
  assert.equal(formatStayMinutes(38), "38 min");
  assert.equal(formatStayMinutes(59), "59 min");
  assert.equal(formatStayMinutes(60), "1 h");
  assert.equal(formatStayMinutes(72), "1 h 12 min");
  assert.equal(formatStayMinutes(120), "2 h");
  assert.equal(formatStayMinutes(Number.NaN), "—");
});

test("item count sums the quantities, not the lines", () => {
  assert.equal(itemCountOf([{ qty: 2 }, { qty: 1 }, { qty: 4 }]), 7);
  assert.equal(itemCountOf([]), 0);
  assert.equal(only(build([table("A", "Occupied")], [tab("A", 5)])).itemCount, 3);
});

test("reservation: earliest Booked booking for THAT table; Seated, Cancelled and other tables ignored", () => {
  const list = [
    reservation("T-4", "20:00"),
    reservation("T-4", "13:30"),
    reservation("T-4", "09:00", { status: "Seated" }),
    reservation("T-4", "10:00", { status: "Cancelled" }),
    reservation("T-5", "08:00"),
  ];
  assert.equal(reservationForTable("T-4", list)?.time, "13:30");
  assert.equal(reservationForTable("T-6", list), undefined);
  assert.equal(reservationForTable("T-4", undefined), undefined);
  assert.equal(only(build([table("T-4", "Reserved")], [], list)).reservation?.time, "13:30");
  // Only a Reserved tile carries the booking line.
  assert.equal(only(build([table("T-4", "Available")], [], list)).reservation, undefined);
});

test("summary text: plural, singular, running total rules", () => {
  const tables = [table("A", "Occupied"), table("B", "Occupied"), table("C", "Available")];
  const tabs = [tab("A", 5, { total: 640 }), tab("B", 5, { total: 4740 })];
  assert.equal(floorSummaryText(build(tables, tabs), true), "3 tables · 2 occupied · ₹5,380 running");
  assert.equal(floorSummaryText(build(tables, undefined), false), "3 tables · 2 occupied");
  assert.equal(floorSummaryText(build([table("C", "Available")], []), true), "1 table · 0 occupied");
  // A tab on an Available table is not "running" money.
  assert.equal(
    floorSummaryText(build([table("A", "Occupied"), table("C", "Available")], [tab("A", 1, { total: 100 }), tab("C", 1, { total: 900 })]), true),
    "2 tables · 1 occupied · ₹100 running",
  );
});

// U3 Task 2 (design 6.3, values 2.4 / 5.2; pins moved on purpose, P25: the chips' three statuses become the HTML's five
// pills, statusCounts → floorCounts, emptyFilterText → the HTML's one line). The P25 meaning stays: every table counts
// in exactly one state, and a filter shows the tiles of that state.
test("FLOOR_FILTERS: the HTML's pills, in its order and words (values 2.4)", () => {
  assert.deepEqual(
    FLOOR_FILTERS.map((f) => [f.key, f.label]),
    [["all", "All"], ["free", "Available"], ["occupied", "Occupied"], ["billed", "Bill printed"], ["reserved", "Reserved"]],
    "values 2.4: All, Available, Occupied, Bill printed, Reserved",
  );
});

// One tile of each kind the pills sort (inventory K1-K8): K1 with a bill printed for its total, K1 not printed, K1
// printed before the bill grew (a new round), K2 (no bill), K5, K7 (Available holding a bill), K8.
const KINDS = build(
  [
    table("K1", "Occupied"), table("K1P", "Occupied"), table("K1S", "Occupied"), table("K2", "Occupied"),
    table("K5", "Available"), table("K7", "Available"), table("K8", "Reserved"),
  ],
  [tab("K1", 5), printed(tab("K1P", 5)), { ...printed(tab("K1S", 5)), total: 900 }, tab("K7", 5)],
);

test("floorFilterOf: Bill printed only when the server knows of the print (billPrintedNow); K7 is Available", () => {
  assert.deepEqual(
    KINDS.map((t) => [t.table.tableNo, floorFilterOf(t)]),
    [["K1", "occupied"], ["K1P", "billed"], ["K1S", "occupied"], ["K2", "occupied"], ["K5", "free"], ["K7", "free"], ["K8", "reserved"]],
    "Occupied → billed with a print for this total (U2 Q11), else occupied; Available → free (K7 too); Reserved → reserved",
  );
  // Bills not loaded yet (K3, K6, K9): the table's own status.
  const unknown = build([table("K3", "Occupied"), table("K6", "Available"), table("K9", "Reserved")], undefined);
  assert.deepEqual(unknown.map(floorFilterOf), ["occupied", "free", "reserved"], "no bill known: the status alone");
});

test("floorCounts: every table counts once, a printed bill under Bill printed only; filterTiles keeps the order", () => {
  assert.deepEqual(floorCounts(KINDS), { all: 7, free: 2, occupied: 3, billed: 1, reserved: 1 }, "K1P is billed, not occupied too");
  assert.deepEqual(floorCounts([]), { all: 0, free: 0, occupied: 0, billed: 0, reserved: 0 }, "an empty floor counts zeros");
  assert.deepEqual(filterTiles(KINDS, "all"), KINDS, "All shows every tile, in order");
  assert.notEqual(filterTiles(KINDS, "all"), KINDS, "a copy, never the caller's array");
  const nos = (filter: Parameters<typeof filterTiles>[1]) => filterTiles(KINDS, filter).map((t) => t.table.tableNo);
  assert.deepEqual(nos("occupied"), ["K1", "K1S", "K2"], "Occupied: without a printed bill");
  assert.deepEqual(nos("billed"), ["K1P"], "Bill printed: the printed one alone");
  assert.deepEqual(nos("free"), ["K5", "K7"], "Available: K7 with its bill too");
  assert.deepEqual(nos("reserved"), ["K8"], "Reserved");
});

test("FLOOR_EMPTY_FILTER_TEXT: the HTML's empty line (values 5.2)", () => {
  assert.equal(FLOOR_EMPTY_FILTER_TEXT, "No tables match this filter.", "values 5.2, design 11");
});

test("updatedLabel", () => {
  assert.equal(updatedLabel(NOW, NOW), "Live · updated just now");
  assert.equal(updatedLabel(NOW - 59_999, NOW), "Live · updated just now");
  assert.equal(updatedLabel(NOW + 5_000, NOW), "Live · updated just now");
  assert.equal(updatedLabel(NOW - 60_000, NOW), "Updated 1 min ago");
  assert.equal(updatedLabel(NOW - 59 * MIN, NOW), "Updated 59 min ago");
  assert.equal(updatedLabel(NOW - 60 * MIN, NOW), "Updated over an hour ago");
});
