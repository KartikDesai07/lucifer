// Pure-rule tests for the live Floor (lib/floor-tiles.ts): the tap table row by
// row, long stay at its boundary, summary / freshness strings, filters.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FLOOR_GRID_CLASS,
  FLOOR_PRIMARY_LABEL,
  buildFloorTiles,
  emptyFilterText,
  filterTiles,
  floorSummaryText,
  formatStayMinutes,
  itemCountOf,
  longStay,
  minutesOpen,
  reservationForTable,
  statusCounts,
  updatedLabel,
  type FloorTileModel,
} from "@/lib/floor-tiles";
import type { TableStatus } from "@/lib/constants";
import type { Order, Reservation, Table } from "@/types";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const MIN = 60_000;
const LONG_STAY = 60;

function table(tableNo: string, status: TableStatus, extra: Partial<Table> = {}): Table {
  return { _id: `id-${tableNo}`, tableNo, status, capacity: 4, ...extra } as Table;
}

function tab(tableNo: string, minutesAgo: number, extra: Partial<Order> = {}): Order {
  return {
    _id: `o-${tableNo}`,
    orderId: `ORD-${tableNo}`,
    tableNo,
    customerName: "Rahul",
    total: 640,
    items: [{ qty: 2 }, { qty: 1 }],
    createdAt: new Date(NOW - minutesAgo * MIN).toISOString(),
    ...extra,
  } as Order;
}

function reservation(tableNo: string, time: string, extra: Partial<Reservation> = {}): Reservation {
  return { _id: `r-${tableNo}-${time}`, name: "Asha", tableNo, time, status: "Booked", ...extra } as Reservation;
}

function build(tables: Table[], tabs: Order[] | undefined, reservations?: Reservation[], nowMs: number | null = NOW) {
  return buildFloorTiles({ tables, tabs, reservations, nowMs, longStayMinutes: LONG_STAY });
}

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

test("counts and filter", () => {
  const tiles = build([table("A", "Occupied"), table("B", "Available"), table("C", "Available"), table("D", "Reserved")], []);
  assert.deepEqual(statusCounts(tiles.map((t) => t.table)), { all: 4, Occupied: 1, Available: 2, Reserved: 1 });
  assert.equal(filterTiles(tiles, "all").length, 4);
  assert.deepEqual(filterTiles(tiles, "Available").map((t) => t.table.tableNo), ["B", "C"]);
  assert.equal(emptyFilterText("Occupied"), "No occupied tables right now.");
});

test("updatedLabel", () => {
  assert.equal(updatedLabel(NOW, NOW), "Live · updated just now");
  assert.equal(updatedLabel(NOW - 59_999, NOW), "Live · updated just now");
  assert.equal(updatedLabel(NOW + 5_000, NOW), "Live · updated just now");
  assert.equal(updatedLabel(NOW - 60_000, NOW), "Updated 1 min ago");
  assert.equal(updatedLabel(NOW - 59 * MIN, NOW), "Updated 59 min ago");
  assert.equal(updatedLabel(NOW - 60 * MIN, NOW), "Updated over an hour ago");
});
