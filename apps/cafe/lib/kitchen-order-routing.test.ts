import { test } from "node:test";
import assert from "node:assert/strict";

import { billPrintJob, cancelNoticePrintJob, kotPrintJob, movedPrintJob } from "@/lib/print-routing";
import { routePrintRequest, type PrintRouting } from "@/lib/print-printer-routing";
import { kitchenOrderOf } from "@/lib/kitchen-lines";
import { printOrderSnapshot } from "@pos/shared/print-job";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import type { PrinterConfig, StationConfig } from "@pos/shared/print-printers";
import type { Order, OrderItem } from "@/types";

// KOT kitchen order, the PRINT half: the write-time `kotRank` stamp turns into a kitchen-ordered KOT / moved /
// cancel snapshot (kitchenOrderOf inside the builders), the rank never reaches the snapshot, and the station
// split (routePrintRequest -> routeKot) keeps that order per station, per full copy and on the fallback slip.
// Pure and DB-free: the REAL builders and the REAL router over in-memory fixtures (shape from
// lib/print-printer-routing.test.ts).

const KITCHEN: StationConfig = { id: "st-kitchen", name: "Kitchen", order: 0, isDefault: true };
const BAR: StationConfig = { id: "st-bar", name: "Bar", order: 1, isDefault: false };
const STATIONS = [KITCHEN, BAR];
const NONE = { bill: false, kotStations: [] as string[], kotAll: false, notices: false, eod: false };

function printer(id: string, slips: Partial<PrinterConfig["slips"]>, over: Partial<PrinterConfig> = {}): PrinterConfig {
  return {
    id,
    name: `${id} printer`,
    connection: { kind: "device", deviceId: `${id}-device`, transport: "bt-classic", address: "00:11:22:33:44:55" },
    order: 0,
    paper: 80,
    slips: { ...NONE, ...slips },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

const KITCHEN_P = printer("kitchen", { kotStations: [KITCHEN.id], notices: true }, { order: 1 });
const BAR_P = printer("bar", { kotStations: [BAR.id], notices: true }, { order: 2 });
const COUNTER_P = printer("counter", { bill: true, kotAll: true, notices: true, eod: true }, { order: 0 });

// The kitchen order the admin saved: Beverages 0, Food 1, Dessert 2. "Chips" sits in a category created after
// the order was saved: no rank, so it prints after every placed line.
function line(productId: string, name: string, kotRound: number, extra: Partial<OrderItem> = {}): OrderItem {
  return { productId, name, price: 100, qty: 1, modifiers: [], instructions: "", kotRound, ...extra };
}
const ADDED = [
  line("p-chips", "Chips", 1),
  line("p-brownie", "Brownie", 1, { kotRank: 2 }),
  line("p-pizza", "Pizza", 1, { kotRank: 1 }),
  line("p-mojito", "Mojito", 1, { kotRank: 0 }),
  line("p-water", "Water", 1, { noKot: true }),
  line("p-pasta", "Pasta", 1, { kotRank: 1 }),
  line("p-naan", "Naan", 2, { kotRank: 1 }),
  line("p-lassi", "Lassi", 2, { kotRank: 0 }),
];
const ROUND_1_SORTED = ["Mojito", "Pizza", "Pasta", "Brownie", "Chips"]; // ties (Pizza, Pasta) in the order added
const ROUND_2_SORTED = ["Lassi", "Naan"];
// The bar station also takes the snack and the dessert, so ONE station slip has more than one line to reorder.
const ITEM_STATIONS = new Map([
  ["p-mojito", BAR.id],
  ["p-lassi", BAR.id],
  ["p-brownie", BAR.id],
  ["p-chips", BAR.id],
  ["p-pizza", KITCHEN.id],
  ["p-pasta", KITCHEN.id],
  ["p-naan", KITCHEN.id],
]);

function order(items: readonly OrderItem[] = ADDED): Order {
  return {
    _id: "665f0a0000000000000000a1",
    orderId: "ORD-0001",
    customerName: "Walk-in",
    items: [...items],
    subtotal: 800,
    discount: 0,
    total: 800,
    paidAmount: 0,
    payment: "Cash",
    status: "Pending",
    receiver: "Staff",
    tableNo: "4",
    kotRounds: 2,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
  };
}

function routing(printers: PrinterConfig[]): PrintRouting {
  return { printers, stations: STATIONS, itemStations: ITEM_STATIONS };
}

function itemsOf(payload: PrintJobPayload): Array<Record<string, unknown>> {
  assert.ok("snapshot" in payload, "a payload that carries an order snapshot");
  return "snapshot" in payload ? payload.snapshot.items.map((i) => ({ ...i })) : [];
}
const namesOf = (payload: PrintJobPayload): string[] => itemsOf(payload).map((i) => String(i.name));

test("kotPrintJob round 1: the snapshot is in kitchen order, skip line gone, and no item carries a kotRank key", () => {
  // landmark: the INPUT really has ranks and a skip line, added in a different order than the kitchen wants.
  assert.deepEqual(ADDED.filter((l) => l.kotRound === 1).map((l) => l.name), ["Chips", "Brownie", "Pizza", "Mojito", "Water", "Pasta"]);
  assert.ok(ADDED.some((l) => l.kotRank === 0) && ADDED.some((l) => l.noKot === true));
  const { payload } = kotPrintJob(order(), 1);
  const items = itemsOf(payload);
  // Round 2's lines ride the snapshot too (routing filters by round); round 1's block must read in kitchen order.
  assert.deepEqual(items.filter((i) => i.kotRound === 1).map((i) => i.name), ROUND_1_SORTED);
  assert.ok(!items.some((i) => i.name === "Water"), "the noKot line never reaches a KOT snapshot");
  assert.equal(items.length, ROUND_1_SORTED.length + ROUND_2_SORTED.length);
  for (const i of items) {
    assert.ok("productId" in i && "name" in i && "kotRound" in i, "landmark: the whitelisted keys are present on the item");
    assert.ok(!("kotRank" in i), `${String(i.name)}: kotRank never reaches the snapshot`);
  }
  assert.ok(JSON.stringify(payload).indexOf("kotRank") === -1, "raw JSON of the whole payload holds no kotRank");
  assert.equal(printJobPayloadSchema.safeParse(payload).success, true, "the payload still parses");
});

test("kotPrintJob(order, null): a whole-tab reprint keeps the rounds grouped, each in kitchen order", () => {
  const { payload } = kotPrintJob(order(), null);
  assert.deepEqual(namesOf(payload), [...ROUND_1_SORTED, ...ROUND_2_SORTED]);
  assert.deepEqual(itemsOf(payload).map((i) => i.kotRound), [1, 1, 1, 1, 1, 2, 2]);
  assert.equal(JSON.stringify(payload).indexOf("kotRank"), -1);
});

test("an order with NO ranks snapshots exactly as before: lines in the order added, deepEqual to the plain snapshot", () => {
  const plain = [
    line("p-chips", "Chips", 1),
    line("p-brownie", "Brownie", 1),
    line("p-pizza", "Pizza", 1),
    line("p-mojito", "Mojito", 1),
    line("p-pasta", "Pasta", 1),
    line("p-naan", "Naan", 2),
    line("p-lassi", "Lassi", 2),
  ];
  const unranked = order(plain);
  // landmark: the fixture has no rank anywhere, and an order with no skip and no rank flows through untouched.
  assert.ok(!unranked.items.some((l) => "kotRank" in l));
  assert.equal(kitchenOrderOf(unranked), unranked, "no skip, no rank: the very same object");
  const { payload } = kotPrintJob(unranked, null);
  assert.deepEqual(namesOf(payload), ["Chips", "Brownie", "Pizza", "Mojito", "Pasta", "Naan", "Lassi"], "added order");
  assert.deepEqual("snapshot" in payload ? payload.snapshot : null, printOrderSnapshot(unranked));
  // a skip line alone (no rank anywhere) is dropped and the rest keeps the order added
  const skipOnly = kotPrintJob(order([...plain, line("p-water", "Water", 1, { noKot: true })]), null).payload;
  assert.deepEqual(namesOf(skipOnly), ["Chips", "Brownie", "Pizza", "Mojito", "Pasta", "Naan", "Lassi"]);
});

test("movedPrintJob and cancelNoticePrintJob snapshots are in kitchen order too, without the skip line or any kotRank", () => {
  const moved = movedPrintJob(order(), { from: "T-2", movedBy: "Staff", movedAt: "2026-11-01T10:05:00.000Z" }, { reprint: false });
  const cancel = cancelNoticePrintJob(order(), "Customer left");
  for (const request of [moved, cancel]) {
    assert.deepEqual(namesOf(request.payload), [...ROUND_1_SORTED, ...ROUND_2_SORTED], request.payload.kind);
    assert.equal(JSON.stringify(request.payload).indexOf("kotRank"), -1, `${request.payload.kind}: no kotRank`);
  }
  assert.equal(moved.payload.kind, "moved");
  assert.equal(cancel.payload.kind, "cancel-notice");
});

test("a BILL is not a kitchen slip: its snapshot keeps every line in the order added", () => {
  const { payload } = billPrintJob(order(), { reprint: false });
  assert.deepEqual(namesOf(payload), ["Chips", "Brownie", "Pizza", "Mojito", "Water", "Pasta", "Naan", "Lassi"]);
});

test("routing, one full-copy printer: today's KOT, the very same request, lines in kitchen order", () => {
  const request = kotPrintJob(order(), 1);
  const jobs = routePrintRequest(request, routing([COUNTER_P]));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].request, request, "the same request object");
  assert.deepEqual(namesOf(jobs[0].request.payload).filter((n) => ROUND_1_SORTED.includes(n)), ROUND_1_SORTED);
});

test("routing, stations plus a full copy: each station slip and the full copy keep kitchen order", () => {
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([COUNTER_P, KITCHEN_P, BAR_P]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", "bar", "counter"], "landmark: station order, then the full copy");
  const [kitchen, bar, counter] = jobs;
  assert.deepEqual(namesOf(kitchen.request.payload), ["Pizza", "Pasta"], "ties keep the order added");
  assert.deepEqual(namesOf(bar.request.payload), ["Mojito", "Brownie", "Chips"], "added Chips, Brownie, Mojito; the kitchen wants Mojito first, the unplaced last");
  assert.deepEqual(namesOf(counter.request.payload), ROUND_1_SORTED, "the full copy: the whole round, in kitchen order");
  for (const j of jobs) assert.equal(JSON.stringify(j.request.payload).indexOf("kotRank"), -1, `${j.printerId}: no kotRank`);
});

test("routing, the '(NO PRINTER SET)' fallback slip keeps kitchen order", () => {
  const bill = printer("bill", { bill: true }, { order: 5 });
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([KITCHEN_P, bill]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", "bill"], "landmark: the bar has no printer, so its slip falls back to the bill printer");
  const fallback = jobs[1].request.payload;
  assert.deepEqual(fallback.kind === "kot" && fallback.station, { name: "Bar", mode: "no-printer" });
  assert.deepEqual(namesOf(fallback), ["Mojito", "Brownie", "Chips"]);
});

test("routing, ONE printer that takes both stations: two slips, each in kitchen order", () => {
  const single = printer("only", { kotStations: [KITCHEN.id, BAR.id] });
  const jobs = routePrintRequest(kotPrintJob(order(), 2), routing([single]));
  assert.deepEqual(jobs.map((j) => j.part), [KITCHEN.id, BAR.id], "landmark: round 2 has a kitchen and a bar line");
  assert.deepEqual(namesOf(jobs[0].request.payload), ["Naan"]);
  assert.deepEqual(namesOf(jobs[1].request.payload), ["Lassi"]);
  const both = routePrintRequest(kotPrintJob(order(), 1), routing([single]));
  assert.deepEqual(both.map((j) => namesOf(j.request.payload)), [["Pizza", "Pasta"], ["Mojito", "Brownie", "Chips"]]);
});

test("routing, a whole-tab reprint (round null) splits by station without losing the round-then-rank order", () => {
  const jobs = routePrintRequest(kotPrintJob(order(), null), routing([COUNTER_P, KITCHEN_P, BAR_P]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", "bar", "counter"]);
  assert.deepEqual(namesOf(jobs[0].request.payload), ["Pizza", "Pasta", "Naan"]);
  assert.deepEqual(namesOf(jobs[1].request.payload), ["Mojito", "Brownie", "Chips", "Lassi"]);
  assert.deepEqual(namesOf(jobs[2].request.payload), [...ROUND_1_SORTED, ...ROUND_2_SORTED]);
});
