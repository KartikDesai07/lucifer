import { test } from "node:test";
import assert from "node:assert/strict";

import { billPrintJob, cancelNoticePrintJob, eodPrintJob, kotPrintJob, movedPrintJob, tokenPrintJob, voidPrintJob } from "@/lib/print-routing";
import { printJobKeyOf } from "@/lib/print-queue";
import { routePrintRequest, routedJobKey, type PrintRouting } from "@/lib/print-printer-routing";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import type { PrinterConfig, StationConfig } from "@pos/shared/print-printers";
import type { Order, OrderItem } from "@/types";

// Printing redesign, Phase 2 Session 2A (plan 2026-10-03-phase-2-routing.md, Task A3): spec §8, row by row.
// The requests come from today's builders, so every routed slip is today's paper plus, for a KOT, its
// station.

const KITCHEN: StationConfig = { id: "st-kitchen", name: "Kitchen", order: 0, isDefault: true };
const BAR: StationConfig = { id: "st-bar", name: "Bar", order: 1, isDefault: false };
const TANDOOR: StationConfig = { id: "st-tandoor", name: "Tandoor", order: 2, isDefault: false };
const STATIONS = [KITCHEN, BAR, TANDOOR];

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

function item(productId: string, name: string, kotRound: number): OrderItem {
  return { productId, name, price: 100, qty: 1, modifiers: [], instructions: "", kotRound };
}

// Round 1: paneer (kitchen) and a mojito (bar); round 2: naan (tandoor) and a second mojito... a soup (kitchen).
const ITEMS = [item("p-paneer", "Paneer Tikka", 1), item("p-mojito", "Mojito", 1), item("p-naan", "Butter Naan", 2), item("p-soup", "Soup", 2)];
const ITEM_STATIONS = new Map([
  ["p-paneer", KITCHEN.id],
  ["p-mojito", BAR.id],
  ["p-naan", TANDOOR.id],
  ["p-soup", KITCHEN.id],
]);

function order(overrides: Partial<Order> = {}): Order {
  return {
    _id: "665f0a0000000000000000a1",
    orderId: "ORD-0001",
    customerName: "Walk-in",
    items: ITEMS,
    subtotal: 400,
    discount: 0,
    total: 400,
    paidAmount: 0,
    payment: "Cash",
    status: "Pending",
    receiver: "Staff",
    tableNo: "4",
    kotRounds: 2,
    createdAt: "2026-10-03T10:00:00.000Z",
    updatedAt: "2026-10-03T10:00:00.000Z",
    ...overrides,
  };
}

function routing(printers: PrinterConfig[], over: Partial<PrintRouting> = {}): PrintRouting {
  return { printers, stations: STATIONS, itemStations: ITEM_STATIONS, ...over };
}

function names(payload: PrintJobPayload): string[] {
  assert.equal(payload.kind, "kot", "a KOT payload");
  return payload.kind === "kot" ? payload.snapshot.items.map((line) => line.name) : [];
}

test("spec §14's Phase 2 exit: kitchen and bar items print two station KOTs plus the full copy", () => {
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([COUNTER_P, KITCHEN_P, BAR_P]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", "bar", "counter"], "stations in station order, then the full copy");
  const [kitchen, bar, counter] = jobs;
  assert.deepEqual(names(kitchen.request.payload), ["Paneer Tikka"], "the kitchen gets only its items");
  assert.deepEqual(names(bar.request.payload), ["Mojito"], "the bar gets only its items");
  assert.deepEqual(names(counter.request.payload), ["Paneer Tikka", "Mojito"], "the full copy: the whole round");
  assert.deepEqual(kitchen.request.payload.kind === "kot" && kitchen.request.payload.station, { name: "Kitchen", mode: "station" });
  assert.deepEqual(counter.request.payload.kind === "kot" && counter.request.payload.station, { name: "All stations", mode: "all" });
  assert.equal(kitchen.request.label, "KOT round 1 · T-4 · Kitchen");
  assert.equal(counter.request.label, "KOT round 1 · T-4 · All stations");
  assert.deepEqual(jobs.map((j) => j.writerDeviceId), ["kitchen-device", "bar-device", "counter-device"]);
  assert.deepEqual(jobs.map((j) => j.part), [KITCHEN.id, BAR.id, "all"]);
  for (const j of jobs) assert.equal(printJobPayloadSchema.safeParse(j.request.payload).success, true, `${j.printerId}: the payload parses`);
});

test("one KOT number per round (D7): every station slip keeps the round and its ticket number", () => {
  const request = kotPrintJob(order({ kotNumbers: [41, 42] }), 2);
  const jobs = routePrintRequest(request, routing([KITCHEN_P, BAR_P, printer("tandoor", { kotStations: [TANDOOR.id] })]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", "tandoor"], "round 2 has kitchen and tandoor lines, no bar line");
  for (const j of jobs) {
    assert.equal(j.request.payload.kind === "kot" && j.request.payload.round, 2);
    assert.deepEqual(j.request.payload.kind === "kot" && j.request.payload.snapshot.kotNumbers, [41, 42]);
  }
  assert.deepEqual(names(jobs[0].request.payload), ["Soup"], "only round 2's kitchen line");
});

test("a full copy that is the round's only slip is today's KOT, unchanged (a converted single-printer cafe)", () => {
  const request = kotPrintJob(order(), 1);
  const jobs = routePrintRequest(request, routing([COUNTER_P]));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].request, request, "the very same request: same payload, same label");
  assert.equal(jobs[0].part, "all");
});

test("a station with no printer is covered by the full copy: no extra slip", () => {
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([COUNTER_P, KITCHEN_P]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", "counter"], "the bar's mojito rides the full copy");
  assert.deepEqual(names(jobs[1].request.payload), ["Paneer Tikka", "Mojito"]);
});

test("with no full-copy printer, a station with no printer goes to the default bill printer, saying so", () => {
  const bill = printer("bill", { bill: true }, { order: 5 });
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([KITCHEN_P, bill]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", "bill"]);
  const fallback = jobs[1];
  assert.deepEqual(fallback.request.payload.kind === "kot" && fallback.request.payload.station, { name: "Bar", mode: "no-printer" });
  assert.deepEqual(names(fallback.request.payload), ["Mojito"]);
  assert.equal(fallback.request.label, "KOT round 1 · T-4 · Bar");
});

test("a KOT is never dropped: with nowhere to print, it fails at once and says why", () => {
  const eodOnly = printer("office", { eod: true });
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([KITCHEN_P, eodOnly]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", null]);
  assert.equal(jobs[1].error, "No printer is set up for Bar.");
  assert.equal(jobs[1].writerDeviceId, null);
  assert.equal(jobs[1].part, BAR.id);
  assert.deepEqual(names(jobs[1].request.payload), ["Mojito"], "the failed slip still holds the bar's lines, for Retry after setup");
});

test("two printers that take one station both get its slip; copies stay one job", () => {
  const second = printer("kitchen-2", { kotStations: [KITCHEN.id] }, { order: 3, copies: { kot: 2, bill: 1 } });
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([KITCHEN_P, second, BAR_P]));
  const kitchenJobs = jobs.filter((j) => j.part === KITCHEN.id);
  assert.deepEqual(kitchenJobs.map((j) => [j.printerId, j.copies]), [["kitchen", 1], ["kitchen-2", 2]]);
});

// The Session 2A final review (Important 2): "Full KOT copy" and a station ticked on one printer must not
// print that station's lines twice on it. The full copy already holds them (decision 4's reasoning).
test("a full-copy printer that also takes a station prints the round once, as its full copy", () => {
  const counterKitchen = { ...COUNTER_P, slips: { ...COUNTER_P.slips, kotStations: [KITCHEN.id] } };
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([counterKitchen, BAR_P]));
  assert.deepEqual(jobs.map((j) => [j.printerId, j.part]), [["bar", BAR.id], ["counter", "all"]], "no kitchen slip on the counter beside its full copy");
  const kitchenOnly = kotPrintJob(order({ items: [ITEMS[0]], kotRounds: 1 }), 1);
  const alone = routePrintRequest(kitchenOnly, routing([counterKitchen]));
  assert.equal(alone.length, 1, "one slip on the one printer");
  assert.equal(alone[0]?.request, kitchenOnly, "today's KOT, unchanged");
});

test("disabled printers and LAN printers nobody writes to never get a slip", () => {
  const off = printer("bar", { kotStations: [BAR.id] }, { enabled: false });
  const lan = printer("lan-bar", { kotStations: [BAR.id] }, { connection: { kind: "lan", host: "192.168.1.70", port: 9100 } });
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([COUNTER_P, KITCHEN_P, off, lan]));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen", "counter"], "the bar rides the full copy instead");
  const primary = { ...lan, primaryDeviceId: "bar-tablet" };
  const withPrimary = routePrintRequest(kotPrintJob(order(), 1), routing([COUNTER_P, KITCHEN_P, primary]));
  assert.deepEqual(withPrimary.map((j) => [j.printerId, j.writerDeviceId]), [["kitchen", "kitchen-device"], ["lan-bar", "bar-tablet"], ["counter", "counter-device"]]);
});

test("an item whose station is unknown or deleted prints at the default station (spec §6.2)", () => {
  const stray = item("p-new", "Special", 1);
  const request = kotPrintJob(order({ items: [stray], kotRounds: 1 }), 1);
  assert.deepEqual(names(routePrintRequest(request, routing([KITCHEN_P, BAR_P]))[0].request.payload), ["Special"]);
  const gone = new Map([["p-new", "st-deleted"]]);
  const jobs = routePrintRequest(request, routing([KITCHEN_P, BAR_P], { itemStations: gone }));
  assert.deepEqual(jobs.map((j) => j.printerId), ["kitchen"], "a deleted station falls back to the default");
});

test("a whole-tab reprint (round null) splits every line by station", () => {
  const jobs = routePrintRequest(kotPrintJob(order(), null), routing([KITCHEN_P, BAR_P]));
  assert.deepEqual(names(jobs[0].request.payload), ["Paneer Tikka", "Soup"]);
  assert.equal(jobs.length, 3, "kitchen, bar, and the tandoor's naan, which no printer takes: it fails visibly");
  assert.equal(jobs[2].error, "No printer is set up for Tandoor.");
});

test("a round with no lines makes no job; a cafe with no stored station still routes", () => {
  assert.deepEqual(routePrintRequest(kotPrintJob(order({ items: [item("p-paneer", "Paneer Tikka", 1)] }), 3), routing([KITCHEN_P])), []);
  const jobs = routePrintRequest(kotPrintJob(order(), 1), routing([COUNTER_P, KITCHEN_P], { stations: [], itemStations: new Map() }));
  assert.deepEqual(jobs.map((j) => j.printerId), ["counter"], "no stations yet: no station printer can match, the full copy prints it all");
});

test("bill: the asking device's bill printer, else the default; copies; nowhere fails visibly", () => {
  const second = printer("counter-2", { bill: true }, { order: 4, copies: { kot: 1, bill: 2 } });
  const request = billPrintJob(order({ status: "Completed" }), { reprint: false });
  assert.deepEqual(routePrintRequest(request, routing([COUNTER_P, second])).map((j) => [j.printerId, j.copies]), [["counter", 1]]);
  const chosen = routePrintRequest(request, routing([COUNTER_P, second], { billPrinterId: "counter-2" }));
  assert.deepEqual(chosen.map((j) => [j.printerId, j.copies, j.part]), [["counter-2", 2, "-"]]);
  const disabled = routePrintRequest(request, routing([COUNTER_P, { ...second, enabled: false }], { billPrinterId: "counter-2" }));
  assert.deepEqual(disabled.map((j) => j.printerId), ["counter"], "a disabled choice falls back to the default");
  const kitchenAsBill = routePrintRequest(request, routing([COUNTER_P, KITCHEN_P], { billPrinterId: "kitchen" }));
  assert.deepEqual(kitchenAsBill.map((j) => j.printerId), ["counter"], "a choice that does not take bills: the default (the 2D review gate)");
  const nowhere = routePrintRequest(request, routing([KITCHEN_P]));
  assert.deepEqual(nowhere.map((j) => [j.printerId, j.error]), [[null, "No printer is set up for bills."]]);
  // The 2A gate's M9 (ruled at the 2B gate, R4): a choice that takes no slip is not routable, so its writer would
  // not poll the wake; it falls back to the default bill printer.
  const idle = printer("idle", {}, { order: 7 });
  assert.deepEqual(routePrintRequest(request, routing([COUNTER_P, idle], { billPrinterId: "idle" })).map((j) => j.printerId), ["counter"], "a choice that takes no slip");
});

test("End of day: the asking device's bill printer, else the first End of day printer, else the default bill printer", () => {
  const request = eodPrintJob({ dateKey: "2026-10-03", dateLabel: "3 Oct 2026" });
  const office = printer("office", { eod: true }, { order: 9 });
  const bill = printer("bill", { bill: true }, { order: 1 });
  assert.deepEqual(routePrintRequest(request, routing([bill, office])).map((j) => j.printerId), ["office"]);
  assert.deepEqual(routePrintRequest(request, routing([bill, office], { billPrinterId: "bill" })).map((j) => j.printerId), ["bill"]);
  assert.deepEqual(routePrintRequest(request, routing([bill])).map((j) => j.printerId), ["bill"]);
  assert.deepEqual(routePrintRequest(request, routing([KITCHEN_P])).map((j) => j.error), ["No printer is set up for End of day."]);
});

// The 2D review gate: a printer prints only the slips its boxes say. A device's chosen bill printer counts only while
// it takes bills; unticking Bill there sends that device's bills, and its End of day, the default way again.
test("2D gate: a device's chosen bill printer counts only while it takes bills; its End of day follows the same choice", () => {
  const second = printer("counter-2", { bill: true }, { order: 4 });
  const bill = billPrintJob(order({ status: "Completed" }), { reprint: false });
  const eod = eodPrintJob({ dateKey: "2026-10-03", dateLabel: "3 Oct 2026" });
  const office = printer("office", { eod: true }, { order: 9 });
  assert.deepEqual(routePrintRequest(bill, routing([COUNTER_P, second], { billPrinterId: "counter-2" })).map((j) => j.printerId), ["counter-2"], "a second bill printer may be chosen");
  const unticked = { ...second, slips: { ...second.slips, bill: false, notices: true } };
  assert.deepEqual(routePrintRequest(bill, routing([COUNTER_P, unticked], { billPrinterId: "counter-2" })).map((j) => j.printerId), ["counter"], "Bill unticked there: the default bill printer");
  assert.deepEqual(routePrintRequest(eod, routing([COUNTER_P, unticked, office], { billPrinterId: "counter-2" })).map((j) => j.printerId), ["counter"], "its End of day: the first End of day printer, as with no choice");
  assert.deepEqual(routePrintRequest(eod, routing([second, office], { billPrinterId: "counter-2" })).map((j) => j.printerId), ["counter-2"], "a chosen bill printer takes the device's End of day (spec §8)");
});

test("void: to the printers the voided item's station KOT reaches, that take notices", () => {
  const entry = { productId: "p-mojito", name: "Mojito", price: 100, qty: 1, kotRound: 1, reason: "Wrong", voidedBy: "Asha", at: "2026-10-03T10:05:00.000Z" };
  const request = voidPrintJob(order({ voids: [entry] }), entry, { reprint: false });
  assert.deepEqual(routePrintRequest(request, routing([COUNTER_P, KITCHEN_P, BAR_P])).map((j) => j.printerId), ["counter", "bar"], "the bar and the full copy, never the kitchen");
  const quietBar = { ...BAR_P, slips: { ...BAR_P.slips, notices: false } };
  assert.deepEqual(routePrintRequest(request, routing([COUNTER_P, KITCHEN_P, quietBar])).map((j) => j.printerId), ["counter"]);
  const quietAll = { ...COUNTER_P, slips: { ...COUNTER_P.slips, notices: false } };
  assert.deepEqual(routePrintRequest(request, routing([quietAll, KITCHEN_P, quietBar])), [], "notices switched off everywhere it reaches: no notice");
  const fallbackOnly = printer("bill", { bill: true, notices: true });
  assert.deepEqual(routePrintRequest(request, routing([KITCHEN_P, fallbackOnly])).map((j) => j.printerId), ["bill"], "the bar's KOT went to the bill printer, so its void does too");
});

test("moved and cancel notices: the notice printers of every station that got a KOT, each once", () => {
  const moved = movedPrintJob(order(), { from: "3", movedBy: "Asha", movedAt: "2026-10-03T10:06:00.000Z" }, { reprint: false });
  const all = [COUNTER_P, KITCHEN_P, BAR_P, printer("tandoor", { kotStations: [TANDOOR.id], notices: true }, { order: 3 })];
  assert.deepEqual(routePrintRequest(moved, routing(all)).map((j) => j.printerId), ["counter", "kitchen", "bar", "tandoor"]);
  const unsent = order({ items: [item("p-mojito", "Mojito", 0)], kotRounds: 0 });
  const early = routePrintRequest(movedPrintJob(unsent, { movedBy: "Asha", movedAt: "2026-10-03T10:06:00.000Z" }, { reprint: false }), routing(all));
  assert.deepEqual(early.map((j) => j.printerId), ["counter", "kitchen"], "nothing fired yet: the default station's printers");
  const cancel = routePrintRequest(cancelNoticePrintJob(order({ items: [ITEMS[1]] }), "Customer left"), routing(all));
  assert.deepEqual(cancel.map((j) => [j.printerId, j.copies]), [["counter", 1], ["bar", 1]]);
});

test("job keys: the slip's key, then the printer and the part; no key stays no key", () => {
  const request = kotPrintJob(order(), 1);
  const base = printJobKeyOf(request.payload);
  const jobs = routePrintRequest(request, routing([COUNTER_P, KITCHEN_P]));
  assert.deepEqual(jobs.map((j) => routedJobKey(base, j)), [
    `kot:665f0a0000000000000000a1:1:kitchen:${KITCHEN.id}`,
    "kot:665f0a0000000000000000a1:1:counter:all",
  ]);
  assert.equal(routedJobKey(base, { printerId: null, part: BAR.id }), `kot:665f0a0000000000000000a1:1:none:${BAR.id}`);
  assert.equal(routedJobKey(undefined, jobs[0]), undefined, "End of day and the like stay keyless");
  const keys = routePrintRequest(request, routing([COUNTER_P, KITCHEN_P, BAR_P])).map((j) => routedJobKey(base, j));
  assert.equal(new Set(keys).size, keys.length, "every job of one slip has its own key");
});

// Print customization S7 (01-PLAN §8.2), the merge seam: the customer's token slip prints where the bill does.
// No printer has a token box, so a token is never a station or kitchen slip.
const tokenOrder = () => order({ status: "Completed", tokenNumber: 7 });
const tokenRequest = () => tokenPrintJob(tokenOrder(), { reprint: false });

test("token: the asking device's bill printer that takes bills wins; one copy even when that printer prints two bills", () => {
  const second = printer("counter-2", { bill: true }, { order: 4, copies: { kot: 3, bill: 2 } });
  const request = tokenRequest();
  assert.equal(request.payload.kind, "token", "landmark: it is a token slip");
  const chosen = routePrintRequest(request, routing([COUNTER_P, second], { billPrinterId: "counter-2" }));
  assert.deepEqual(chosen.map((j) => [j.printerId, j.writerDeviceId, j.copies, j.part, j.error]), [["counter-2", "counter-2-device", 1, "-", undefined]]);
  assert.equal(chosen[0].request, request, "the very same request: today's token slip, unchanged");
  assert.equal(second.copies.bill, 2, "landmark: the chosen printer's bill copies really are 2");
  // vision guard: the same choice for a BILL does take the 2 copies, so the 1 above is the token rule, not a default
  const bill = routePrintRequest(billPrintJob(tokenOrder(), { reprint: false }), routing([COUNTER_P, second], { billPrinterId: "counter-2" }));
  assert.deepEqual(bill.map((j) => [j.printerId, j.copies]), [["counter-2", 2]]);
  // no choice: the default bill printer, one copy
  assert.deepEqual(routePrintRequest(request, routing([COUNTER_P, second])).map((j) => [j.printerId, j.copies]), [["counter", 1]]);
  assert.equal(printJobPayloadSchema.safeParse(chosen[0].request.payload).success, true, "the payload parses");
});

test("token: a chosen printer that does not take bills (a station, unticked, disabled, idle) falls back to the default bill printer", () => {
  const request = tokenRequest();
  const second = printer("counter-2", { bill: true }, { order: 4 });
  const idsFor = (printers: PrinterConfig[], billPrinterId: string) => routePrintRequest(request, routing(printers, { billPrinterId })).map((j) => j.printerId);
  assert.deepEqual(idsFor([COUNTER_P, KITCHEN_P], "kitchen"), ["counter"], "a kitchen printer was chosen: the default bill printer");
  const unticked = { ...second, slips: { ...second.slips, bill: false, notices: true } };
  assert.deepEqual(idsFor([COUNTER_P, unticked], "counter-2"), ["counter"], "Bill unticked there");
  assert.deepEqual(idsFor([COUNTER_P, { ...second, enabled: false }], "counter-2"), ["counter"], "disabled");
  assert.deepEqual(idsFor([COUNTER_P, printer("idle", {}, { order: 7 })], "idle"), ["counter"], "a printer that takes no slip");
  assert.deepEqual(idsFor([COUNTER_P, second], "counter-2"), ["counter-2"], "landmark: a printer that does take bills IS honoured");
});

test("token: with no bill printer at all the slip is made failed, never dropped, saying 'No printer is set up for bills.'", () => {
  const request = tokenRequest();
  for (const printers of [[KITCHEN_P, BAR_P], [], [printer("office", { eod: true })], [printer("all", { kotAll: true, notices: true })]]) {
    const jobs = routePrintRequest(request, routing(printers));
    assert.equal(jobs.length, 1, "exactly one job");
    assert.deepEqual([jobs[0].printerId, jobs[0].writerDeviceId, jobs[0].part, jobs[0].error, jobs[0].copies], [null, null, "-", "No printer is set up for bills.", 1]);
    assert.equal(jobs[0].request, request, "the failed job holds the slip, for Retry after setup");
  }
  // the failed job's message is the bill's, word for word
  const bill = routePrintRequest(billPrintJob(tokenOrder(), { reprint: false }), routing([KITCHEN_P]));
  assert.equal(bill[0].error, "No printer is set up for bills.");
});

test("token: never routed to a station or kitchen printer, whatever its stations, full-copy box or notices say", () => {
  const request = tokenRequest();
  const everythingButBill = [KITCHEN_P, BAR_P, printer("kot-all", { kotAll: true, notices: true, eod: true }, { order: 3 })];
  const nowhere = routePrintRequest(request, routing(everythingButBill));
  assert.deepEqual(nowhere.map((j) => j.printerId), [null], "none of the station / full-copy printers takes it");
  const withBill = routePrintRequest(request, routing([...everythingButBill, COUNTER_P]));
  assert.deepEqual(withBill.map((j) => j.printerId), ["counter"], "only the bill printer, once");
  assert.ok(!withBill.some((j) => ["kitchen", "bar", "kot-all"].includes(j.printerId ?? "")));
  // the bill-printer choice cannot send it to a printer that takes no bills, even the one that asked
  assert.deepEqual(routePrintRequest(request, routing([KITCHEN_P, COUNTER_P], { billPrinterId: "kitchen" })).map((j) => j.printerId), ["counter"]);
});

test("token: its routed job key is the slip's key, then the printer and the (empty) part", () => {
  const request = tokenRequest();
  const base = printJobKeyOf(request.payload);
  assert.equal(typeof base, "string", "landmark: a fresh token slip carries a key");
  const jobs = routePrintRequest(request, routing([COUNTER_P]));
  assert.equal(routedJobKey(base, jobs[0]), `${base}:counter:-`);
  const reprint = tokenPrintJob(tokenOrder(), { reprint: true });
  assert.equal(printJobKeyOf(reprint.payload), undefined, "a staff reprint stays keyless (a fresh job)");
});
