// Printing Phase 5 (spec 2026-11-03 §5.3), Task 6: which lines of an offline KOT print on this device. The round is
// routed with the server's own pure routing over the device's last read of the setup, so every line the device keeps
// is a line the server would make (it matches them by printer and part); a line prints here only when its printer is
// one this device can print now. Pure fixtures, no DB, no React.

import { test } from "node:test";
import assert from "node:assert/strict";

import { offlineHereIds, offlineKotPlan, offlineLineSlip, offlineLinesOf, offlineRoutingOf, type OfflineLinePlan } from "@/lib/offline-lines";
import { offlineKotSlip } from "@/lib/offline-kot-order";
import { kotPrintJob } from "@/lib/print-routing";
import { routePrintRequest, type PrintRouting } from "@/lib/print-printer-routing";
import { offlineLineSchema } from "@pos/shared/offline-kot";
import type { PrinterConfig, StationConfig } from "@pos/shared/print-printers";
import type { Order, OrderItem } from "@/types";

const KITCHEN: StationConfig = { id: "st-kitchen", name: "Kitchen", order: 0, isDefault: true };
const BAR: StationConfig = { id: "st-bar", name: "Bar", order: 1, isDefault: false };
const STATIONS = [KITCHEN, BAR];

const NONE = { bill: false, kotStations: [] as string[], kotAll: false, notices: false, eod: false };

function devicePrinter(id: string, slips: Partial<PrinterConfig["slips"]>, over: Partial<PrinterConfig> = {}): PrinterConfig {
  return {
    id,
    name: `${id} printer`,
    connection: { kind: "device", deviceId: "this-device", transport: "bt-classic", address: "00:11:22:33:44:55" },
    order: 0,
    paper: 80,
    slips: { ...NONE, ...slips },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

function networkPrinter(id: string, slips: Partial<PrinterConfig["slips"]>, writer: string): PrinterConfig {
  return devicePrinter(id, slips, { connection: { kind: "lan", host: "192.168.1.50", port: 9100 }, primaryDeviceId: writer, order: 3 });
}

const KITCHEN_P = devicePrinter("pr-kitchen", { kotStations: [KITCHEN.id] }, { order: 1 });
const BAR_P = devicePrinter("pr-bar", { kotStations: [BAR.id] }, { order: 2, connection: { kind: "device", deviceId: "bar-tablet", transport: "usb", address: "usb-1" } });
const COUNTER_P = devicePrinter("pr-counter", { bill: true, kotAll: true }, { order: 0 });
const BILL_P = devicePrinter("pr-bill", { bill: true }, { order: 0 });

// Tea follows its category's lack of a station (the default), a mojito its category's Bar, a lassi its own Kitchen
// override, and a product pointing at a deleted station falls back to the default.
const PRODUCTS = [
  { _id: "p-tea", categoryId: "c-hot" },
  { _id: "p-mojito", categoryId: "c-drinks" },
  { _id: "p-lassi", categoryId: "c-drinks", stationId: KITCHEN.id },
  { _id: "p-ghost", categoryId: "c-hot", stationId: "st-deleted" },
];
const CATEGORIES = [{ _id: "c-hot" }, { _id: "c-drinks", stationId: BAR.id }];

function line(productId: string, name: string, over: Partial<OrderItem> = {}): OrderItem {
  return { productId, name, price: 120, qty: 1, modifiers: [], instructions: "", kotRound: 1, ...over };
}

function order(items: OrderItem[]): Order {
  return {
    _id: "offline-5b1c0d2e-3f40-4a51-8b62-7c83d94ea5f6",
    orderId: "O-3",
    customerName: "Walk-in",
    items,
    subtotal: 0,
    discount: 0,
    total: 0,
    paidAmount: 0,
    payment: "Unpaid",
    status: "Pending",
    receiver: "Asha",
    tableNo: "T-2",
    kotRounds: 1,
    createdAt: "2026-11-04T09:30:00.000Z",
    updatedAt: "2026-11-04T09:30:00.000Z",
  };
}

const TEA_AND_MOJITO = order([line("p-tea", "Tea"), line("p-mojito", "Mojito")]);
const SIMPLE = { printsOwnSlips: true, canPrintNow: true };

function routingOf(printers: PrinterConfig[]): PrintRouting {
  const routing = offlineRoutingOf({ printers, stations: STATIONS, products: PRODUCTS, categories: CATEGORIES });
  assert.ok(routing !== null, "a routable printer switches the cafe to printers mode");
  return routing;
}

function planOf(printers: PrinterConfig[], hereIds: readonly string[], target: Order = TEA_AND_MOJITO): OfflineLinePlan[] {
  return offlineKotPlan({ order: target, round: 1, routing: routingOf(printers), hereIds, simple: SIMPLE });
}

test("simple mode prints here only when this device prints its own slips and can print now", () => {
  const off = devicePrinter("pr-off", { kotAll: true }, { enabled: false });
  assert.equal(offlineRoutingOf({ printers: [off], stations: STATIONS, products: PRODUCTS, categories: CATEGORIES }), null, "no printer takes a slip: simple mode");
  const cases: Array<[boolean, boolean, boolean]> = [[true, true, true], [true, false, false], [false, true, false], [false, false, false]];
  for (const [printsOwnSlips, canPrintNow, here] of cases) {
    const plan = offlineKotPlan({ order: TEA_AND_MOJITO, round: 1, routing: null, hereIds: [KITCHEN_P.id], simple: { printsOwnSlips, canPrintNow } });
    const what = `prints own slips ${printsOwnSlips}, can print now ${canPrintNow}`;
    assert.equal(plan.length, 1, `${what}: one device line`);
    const [only] = plan;
    assert.deepEqual([only?.printerId, only?.part, only?.copies, only?.here], [null, "-", 1, here], `${what}: the device line`);
    assert.deepEqual(only?.request, kotPrintJob(TEA_AND_MOJITO, 1), `${what}: today's KOT of the round`);
  }
});

test("a round of only no-kitchen lines plans no line, as the server makes no KOT for it", () => {
  const bottles = order([line("p-water", "Water", { noKot: true })]);
  assert.deepEqual(offlineKotPlan({ order: bottles, round: 1, routing: null, hereIds: [], simple: SIMPLE }), [], "simple mode: no blank KOT");
  assert.deepEqual(planOf([KITCHEN_P], [KITCHEN_P.id], bottles), [], "printers mode: nothing routed");
});

test("printers mode prints here the lines of the printers this device can print now", () => {
  const printers = [KITCHEN_P, BAR_P];
  const plan = planOf(printers, [KITCHEN_P.id]);
  assert.deepEqual(plan.map((l) => [l.printerId, l.part, l.here]), [[KITCHEN_P.id, KITCHEN.id, true], [BAR_P.id, BAR.id, false]], "the kitchen line prints here, the bar tablet's waits");
  const server = routePrintRequest(kotPrintJob(TEA_AND_MOJITO, 1), routingOf(printers));
  assert.deepEqual(plan.map((l) => l.request), server.map((r) => r.request), "each line's paper is the server's routed slip");
  assert.deepEqual(plan[0]?.request.payload.kind === "kot" ? plan[0].request.payload.snapshot.items.map((i) => i.name) : [], ["Tea"], "the kitchen slip holds the kitchen's lines");
});

test("here means the printers it writes and the network printers its app reaches", () => {
  const barLan = networkPrinter("pr-bar-lan", { kotStations: [BAR.id] }, "other-device");
  const passLan = networkPrinter("pr-pass-lan", { kotAll: true }, "other-device");
  const setupNetworkIds = [barLan.id, passLan.id];
  const app = offlineHereIds({ ready: [KITCHEN_P.id], setupNetworkIds, appConnectedNetworkIds: [barLan.id, "pr-elsewhere"], windowsRaw: false });
  assert.deepEqual(app, [KITCHEN_P.id, barLan.id], "the Bar network printer the app reaches is here though another device writes it; the pass printer it does not reach and a printer outside the setup are not");
  const windows = offlineHereIds({ ready: [KITCHEN_P.id], setupNetworkIds, appConnectedNetworkIds: null, windowsRaw: true });
  assert.deepEqual(windows, [KITCHEN_P.id, barLan.id, passLan.id], "the Windows app connects per job: every setup network printer");
  const browser = offlineHereIds({ ready: [KITCHEN_P.id], setupNetworkIds, appConnectedNetworkIds: null, windowsRaw: false });
  assert.deepEqual(browser, [KITCHEN_P.id], "a plain browser: only the printers it writes");
  const both = offlineHereIds({ ready: [barLan.id], setupNetworkIds, appConnectedNetworkIds: [barLan.id], windowsRaw: true });
  assert.deepEqual(both, [barLan.id, passLan.id], "each printer once");
  const plan = planOf([KITCHEN_P, barLan], app);
  assert.deepEqual(plan.map((l) => [l.printerId, l.here]), [[KITCHEN_P.id, true], [barLan.id, true]], "both lines print on this device");
});

test("the item stations are resolved as the server resolves them (product override, category station, the default)", () => {
  const routing = offlineRoutingOf({ printers: [KITCHEN_P], stations: STATIONS, products: PRODUCTS, categories: CATEGORIES, billPrinterId: BILL_P.id });
  assert.ok(routing !== null, "printers mode");
  assert.deepEqual(
    [...routing.itemStations],
    [["p-tea", KITCHEN.id], ["p-mojito", BAR.id], ["p-lassi", KITCHEN.id], ["p-ghost", KITCHEN.id]],
    "no station: the default; the category's Bar; the product's own Kitchen over its category; a deleted station: the default",
  );
  assert.deepEqual([routing.printers, routing.stations, routing.billPrinterId], [[KITCHEN_P], STATIONS, BILL_P.id], "the setup and this device's bill printer");
  assert.equal("billPrinterId" in routingOf([KITCHEN_P]), false, "no bill printer chosen: no key");
});

test("a station with no printer rides the full copy or the bill printer as the server routes it", () => {
  const setups: Array<[string, PrinterConfig[]]> = [
    ["a full-copy counter printer", [COUNTER_P, KITCHEN_P]],
    ["a bill printer and no full copy", [BILL_P, KITCHEN_P]],
    ["no full copy and no bill printer", [KITCHEN_P]],
  ];
  for (const [what, printers] of setups) {
    const server = routePrintRequest(kotPrintJob(TEA_AND_MOJITO, 1), routingOf(printers));
    const plan = planOf(printers, printers.map((p) => p.id));
    assert.deepEqual(plan.map((l) => [l.printerId, l.part, l.copies]), server.map((r) => [r.printerId, r.part, r.copies]), `${what}: the server's printer and part`);
    const mojito = plan.filter((l) => l.request.payload.kind === "kot" && l.request.payload.snapshot.items.some((i) => i.name === "Mojito"));
    assert.ok(mojito.length > 0, `${what}: the bar's mojito is on a line (a KOT is never dropped)`);
    assert.ok(plan.every((l) => l.here === (l.printerId !== null)), `${what}: a line with no printer never prints here`);
  }
});

test("outcomes become printed, maybe and later", () => {
  const request = kotPrintJob(TEA_AND_MOJITO, 1);
  const plan: OfflineLinePlan[] = [
    { printerId: "pr-a", part: KITCHEN.id, copies: 1, request, here: true },
    { printerId: "pr-b", part: BAR.id, copies: 1, request, here: true },
    { printerId: "pr-c", part: "all", copies: 2, request, here: true },
    { printerId: "pr-d", part: BAR.id, copies: 1, request, here: false },
    { printerId: "pr-e", part: KITCHEN.id, copies: 1, request, here: true },
    { printerId: null, part: BAR.id, copies: 1, request, here: false },
  ];
  const outcomes = new Map<number, "printed" | "maybe" | "no">([[0, "printed"], [1, "maybe"], [2, "no"], [3, "printed"]]);
  const lines = offlineLinesOf(plan, outcomes);
  assert.deepEqual(
    lines,
    [
      { printerId: "pr-a", part: KITCHEN.id, outcome: "printed" },
      { printerId: "pr-b", part: BAR.id, outcome: "maybe" },
      { printerId: "pr-c", part: "all", outcome: "later" },
      { printerId: "pr-d", part: BAR.id, outcome: "later" },
      { printerId: "pr-e", part: KITCHEN.id, outcome: "later" },
      { printerId: null, part: BAR.id, outcome: "later" },
    ],
    "printed and maybe on a here line; a write that sent nothing, another device's line and a line not printed yet wait",
  );
  for (const kept of lines) assert.equal(offlineLineSchema.safeParse(kept).success, true, `the server's strict line schema takes ${JSON.stringify(kept)}`);
});

test("copies come from the printer's KOT copies", () => {
  const kitchen = devicePrinter("pr-kitchen", { kotStations: [KITCHEN.id] }, { order: 1, copies: { kot: 3, bill: 1 } });
  const counter = devicePrinter("pr-counter", { bill: true, kotAll: true }, { order: 0, copies: { kot: 2, bill: 3 } });
  const plan = planOf([counter, kitchen], [kitchen.id, counter.id]);
  assert.deepEqual(plan.map((l) => [l.printerId, l.copies]), [[kitchen.id, 3], [counter.id, 2]], "each line as many KOT copies as its printer prints, never the bill's");
});

test("each line prints its own routed slip, through today's slip path, with the banner and no ticket number", () => {
  const [kitchen, bar] = planOf([KITCHEN_P, BAR_P], [KITCHEN_P.id]);
  const slip = offlineLineSlip(kitchen as OfflineLinePlan, "O-3", "2026-11-04");
  assert.equal(slip.banner, "OFFLINE · O-3", "the banner (P5-5)");
  assert.equal("kotRoundNumber" in slip, false, "no number box: the server draws the number");
  assert.deepEqual(slip.kotRoundItems?.map((item) => item.name), ["Tea"], "the kitchen's slip holds only the kitchen's lines");
  assert.equal(typeof slip.stationLine, "string", "the station header, as an online station slip prints it");
  assert.deepEqual(offlineLineSlip(bar as OfflineLinePlan, "O-3", "2026-11-04").kotRoundItems?.map((item) => item.name), ["Mojito"], "the bar's slip");
  const [simple] = offlineKotPlan({ order: TEA_AND_MOJITO, round: 1, routing: null, hereIds: [], simple: SIMPLE });
  const viaLine = offlineLineSlip(simple as OfflineLinePlan, "O-3", "2026-11-04");
  const direct = offlineKotSlip(TEA_AND_MOJITO, 1, "O-3");
  assert.deepEqual([viaLine.banner, viaLine.kotRoundLabel, viaLine.kotRoundItems?.map((item) => item.name), viaLine.stationLine], [direct.banner, direct.kotRoundLabel, direct.kotRoundItems?.map((item) => item.name), undefined], "simple mode's one line is today's whole round KOT");
});
