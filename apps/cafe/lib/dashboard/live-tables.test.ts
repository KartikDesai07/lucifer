// U0 match Task 7 (values 3.6, rulings R15, R16): the dashboard's Live tables as a pure model — our table states
// mapped onto the HTML's Free / Eating / Bill printed / Reserved, the sub line, our areas as zones, each tile's line.
import { test } from "node:test";
import assert from "node:assert/strict";

import { billFirstPrintFresh } from "@/lib/bill-first-print";
import { NO_AREA_LABEL } from "@/lib/table-areas";
import { billPrintedNow, liveTablesModel, stayText } from "@/lib/dashboard/live-tables";
import { LIVE_AREAS, LIVE_ORDERS, LIVE_RESERVATIONS, LIVE_TABLES, liveOrder, liveTable } from "@/lib/dashboard/live-tables.fixtures";

const NOW = Date.parse("2026-10-16T06:41:30.000Z");

test("liveTablesModel: the sub line, the four states' counts, our areas as zones, each tile's second line", () => {
  const m = liveTablesModel({ tables: LIVE_TABLES, orders: LIVE_ORDERS, areas: LIVE_AREAS, reservations: LIVE_RESERVATIONS, nowMs: NOW });
  assert.equal(m.sub, "3 of 7 in use · 1 reserved", "the HTML's '{inUse} of {total} in use · {reserved} reserved' (in use = eating + bill printed)");
  assert.deepEqual(
    m.segments.map((s) => [s.label, s.n]),
    [["Free", 3], ["Eating", 2], ["Bill printed", 1], ["Reserved", 1]],
    "the HTML's four states in its order",
  );
  assert.deepEqual(m.zones.map((z) => z.label), ["AC Hall", "Garden", NO_AREA_LABEL], "our areas in their order, then the tables in none under 'Other tables'");
  assert.deepEqual(m.zones.map((z) => z.tiles.map((t) => t.table.tableNo)), [["T-1", "T-2", "T-4"], ["T-5", "T-7", "T-8"], ["T-9"]], "each zone holds its tables in our order");
  const tiles = m.zones.flatMap((z) => z.tiles);
  assert.deepEqual(tiles.map((t) => t.state), ["reserved", "free", "eating", "free", "eating", "billed", "free"], "each table's state");
  assert.deepEqual(
    tiles.map((t) => t.line),
    ["7:00 PM", "4 seats", "₹768 · 41m", "4 seats", "Occupied", "Bill printed", "2 seats"],
    "free: seats; eating: the running bill and its stay (a settled order is not running); bill printed; reserved: the booking's time",
  );
  assert.equal(tiles[2].title, "T-4 · 6 seats · Occupied", "the HTML's tile title: name · seats · status");
  assert.equal(tiles[5].title, "T-8 · 4 seats · Bill printed", "…with the HTML's status words");
  assert.equal(tiles[2].order?.orderId, "ORD-5", "an occupied tile carries its order (it opens the detail sheet)");
  assert.equal(tiles[4].order?.orderId, "ORD-4", "…a settled one too, as before");
  assert.equal(tiles[5].order?.orderId, "ORD-8", "…and a printed one");
  assert.equal(tiles[1].order, undefined, "a free tile has no order");
});

test("liveTablesModel: a fresh first bill print makes Bill printed; a stale or missing one stays Eating", () => {
  const tables = [liveTable("A", "Occupied", 4, undefined, "o1"), liveTable("B", "Occupied", 4, undefined, "o2"), liveTable("C", "Occupied", 4, undefined, "o3")];
  const orders = [
    liveOrder("o1", "Pending", 500, { at: "2026-10-16T06:10:00.000Z", total: 500 }),
    liveOrder("o2", "Pending", 650, { at: "2026-10-16T06:10:00.000Z", total: 500 }),
    liveOrder("o3", "Pending", 500),
  ];
  const m = liveTablesModel({ tables, orders, areas: undefined, reservations: undefined, nowMs: NOW });
  assert.deepEqual(m.zones[0].tiles.map((t) => t.state), ["billed", "eating", "eating"], "printed for this total: billed; a round added since (stale): eating; never printed: eating");
  assert.deepEqual(m.zones[0].tiles.map((t) => t.line), ["Bill printed", "₹650 · 41m", "₹500 · 41m"], "the lines follow");
  const settled = liveTablesModel({
    tables: [liveTable("D", "Occupied", 2, undefined, "o4")],
    orders: [liveOrder("o4", "Completed", 300, { at: "2026-10-16T06:10:00.000Z", total: 300 })],
    areas: undefined,
    reservations: undefined,
    nowMs: NOW,
  });
  assert.equal(settled.zones[0].tiles[0].state, "eating", "a settled order's printed bill is not a running bill: the table is just occupied");
});

test("billPrintedNow is the server's billFirstPrintFresh rule on the list API's JSON", () => {
  const at = "2026-10-16T06:10:00.000Z";
  const cases = [
    { total: 500, billFirstPrintedAt: at, billFirstPrintedTotal: 500 },
    { total: 650, billFirstPrintedAt: at, billFirstPrintedTotal: 500 },
    { total: 500 },
    { total: 500, billFirstPrintedTotal: 500 },
  ];
  for (const c of cases) {
    const server = billFirstPrintFresh({
      total: c.total,
      billFirstPrintedAt: c.billFirstPrintedAt ? new Date(c.billFirstPrintedAt) : undefined,
      billFirstPrintedTotal: c.billFirstPrintedTotal,
    });
    assert.equal(billPrintedNow(c), server, `the client agrees with the server on ${JSON.stringify(c)}`);
  }
  assert.equal(billPrintedNow(cases[0]), true, "landmark: a fresh stamp is printed");
});

test("ruling R16: a running bill's stay reads {m}m under an hour, {h}h {m}m from 60 minutes", () => {
  assert.equal(stayText(0), "0m", "just opened");
  assert.equal(stayText(41), "41m", "the HTML's 41m");
  assert.equal(stayText(59), "59m", "the last minute under an hour");
  assert.equal(stayText(60), "1h 0m", "an hour");
  assert.equal(stayText(624), "10h 24m", "a tab open ten hours (was 624m)");
});

test("liveTablesModel: zones - 'Other tables' beside named areas, 'Tables' when there are none; the clock and the booking", () => {
  const noAreas = liveTablesModel({ tables: LIVE_TABLES, orders: [], areas: undefined, reservations: undefined, nowMs: null });
  assert.deepEqual(noAreas.zones.map((z) => [z.label, z.tiles.length]), [["Tables", 7]], "no areas loaded: one 'Tables' zone");
  const unknown = liveTablesModel({ tables: LIVE_TABLES, orders: [], areas: [], reservations: undefined, nowMs: null });
  assert.deepEqual(unknown.zones.map((z) => z.label), ["Tables"], "no named area at all: 'Tables'");
  const flat = liveTablesModel({ tables: LIVE_TABLES, orders: LIVE_ORDERS, areas: LIVE_AREAS, reservations: [], nowMs: null }).zones.flatMap((z) => z.tiles);
  assert.equal(flat[2].line, "₹768", "before the clock is known: the bill alone");
  assert.equal(flat[0].line, "Reserved", "a reserved table with no booking today says Reserved");
});
