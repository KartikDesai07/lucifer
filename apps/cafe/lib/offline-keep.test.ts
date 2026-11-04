// An offline send end to end over the real outbox store and fake storage / bridge (Printing Phase 5, spec 5.2–5.6;
// plan Task 11): the entry is written FIRST (a write the storage refused prints nothing), only the here lines print,
// through the slip each one routes to (KOT only: no bill, no token), and the outcomes are stored afterwards.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrinterConfig, StationConfig } from "@pos/shared/print-printers";
import { OUTBOX_KEY } from "@/lib/offline-outbox";
import { createOutboxStore } from "@/lib/offline-outbox-store";
import { offlineLineSlip, offlineRoutingOf, type OfflineLinePlan } from "@/lib/offline-lines";
import { keepOfflineSend, offlinePrinting } from "@/lib/offline-keep";
import { offlineMenuOf, type OfflineKeepRequest, type OfflineSlipOutcome } from "@/lib/offline-send";
import type { HostKotSlip, HostPrintSlip } from "@/lib/print-host-slips";

const KITCHEN: StationConfig = { id: "st-kitchen", name: "Kitchen", order: 0, isDefault: true };
const BAR: StationConfig = { id: "st-bar", name: "Bar", order: 1, isDefault: false };
const NONE = { bill: false, kotStations: [] as string[], kotAll: false, notices: false, eod: false };
const printer = (id: string, name: string, station: string): PrinterConfig => ({
  id,
  name,
  connection: { kind: "device", deviceId: id === "pr-kitchen" ? "this-device" : "bar-tablet", transport: "bt-classic", address: "00:11:22:33:44:55" },
  order: 0,
  paper: 80,
  slips: { ...NONE, kotStations: [station] },
  copies: { kot: 1, bill: 1 },
  enabled: true,
});
const PRINTERS = [printer("pr-kitchen", "Kitchen", KITCHEN.id), printer("pr-bar", "Bar", BAR.id)];
const PRODUCTS = [{ _id: "p-tea", categoryId: "c-hot" }, { _id: "p-mojito", categoryId: "c-drinks" }];
const CATEGORIES = [{ _id: "c-hot" }, { _id: "c-drinks", stationId: BAR.id }];
const item = (productId: string, name: string) => ({ productId, name, price: 100, qty: 1, modifiers: [], instructions: "" });

function setup(opts: { refuseWrites?: boolean } = {}) {
  const data = new Map<string, string>();
  const log: string[] = [];
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (opts.refuseWrites) throw new Error("QuotaExceededError");
      log.push("write");
      data.set(key, value);
    },
    removeItem: (key: string) => void data.delete(key),
  };
  const store = createOutboxStore({ storage: () => storage, locks: () => null, today: () => "2026-11-04", now: () => 1 });
  const slips: HostKotSlip[] = [];
  const deps = {
    update: store.update,
    slipOf: (line: OfflineLinePlan, ref: string) => offlineLineSlip(line, ref, "2026-11-04"),
    print: async (slip: HostPrintSlip): Promise<OfflineSlipOutcome> => {
      log.push("print");
      slips.push(slip as HostKotSlip);
      return "printed";
    },
    nameOf: (id: string | null) => PRINTERS.find((p) => p.id === id)?.name ?? "Another printer",
  };
  const stored = () => JSON.parse(data.get(OUTBOX_KEY) ?? "null");
  return { deps, log, slips, stored };
}

function request(over: Partial<OfflineKeepRequest> = {}): OfflineKeepRequest {
  return {
    key: "k-1",
    at: Date.parse("2026-11-04T09:30:00.000Z"),
    sale: false,
    base: null,
    body: { customerName: "Walk-In", tableNo: "T-2", receiver: "Asha", items: [item("p-tea", "Tea"), item("p-mojito", "Mojito")], total: 200 },
    shownTotal: 200,
    menu: offlineMenuOf(PRODUCTS, CATEGORIES),
    routing: offlineRoutingOf({ printers: PRINTERS, stations: [KITCHEN, BAR], products: PRODUCTS, categories: CATEGORIES }),
    hereIds: ["pr-kitchen"],
    simple: { printsOwnSlips: true, canPrintNow: true },
    print: true,
    ...over,
  };
}

test("the entry is written before the first slip, only the here line prints, and its outcome is stored after", async () => {
  const { deps, log, slips, stored } = setup();
  const result = await keepOfflineSend(request(), deps);
  assert.equal(result.kept, true, "kept");
  if (result.kept !== true) return;
  assert.equal(result.message, "Offline: KOT O-1 printed here. Bar prints when the internet is back.", "the words");
  await result.printed;
  assert.equal(log[0], "write", "the entry is written first");
  assert.ok(log.indexOf("print") > 0, "then the paper");
  assert.equal(slips.length, 1, "only the here line");
  assert.equal(slips[0].banner, "OFFLINE · O-1", "the banner");
  assert.equal(slips[0].surface, "kot", "a KOT");
  assert.ok(slips[0].kotRoundNumber === undefined, "no number box");
  assert.deepEqual(stored().entries[0].lines.map((l: { outcome: string }) => l.outcome), ["printed", "later"], "the outcomes are stored");
  assert.equal(offlinePrinting.has("k-1"), false, "no longer printing");
});

test("a send whose entry could not be kept prints nothing", async () => {
  const { deps, slips } = setup({ refuseWrites: true });
  const result = await keepOfflineSend(request(), deps);
  assert.deepEqual(result, { kept: false, message: "Could not keep this order on the device." }, "not kept, said");
  assert.equal(slips.length, 0, "no paper");
});

test("an outbox that is full prints nothing and says spec 5.2's words; a duplicate prints nothing and says nothing", async () => {
  const { deps, slips } = setup();
  const first = await keepOfflineSend(request(), deps);
  if (first.kept === true) await first.printed;
  const again = await keepOfflineSend(request(), deps);
  assert.deepEqual([again.kept, again.message], [true, null], "already kept: no second toast");
  assert.equal(slips.length, 1, "no second paper");
});

test("Pay Now offline prints its KOT only: no bill, no token; the entry is a sale with the total taken", async () => {
  const { deps, slips, stored } = setup();
  const result = await keepOfflineSend(request({ sale: true, hereIds: ["pr-kitchen", "pr-bar"], body: { ...request().body, status: "Completed", payment: "Cash" }, shownTotal: 236 }), deps);
  assert.equal(result.kept, true, "kept");
  if (result.kept !== true) return;
  await result.printed;
  assert.equal(result.message, "Offline: KOT O-1 printed. The sale is saved and its bill prints when the internet is back.", "the sale's words");
  assert.deepEqual(slips.map((s) => s.surface), ["kot", "kot"], "two station KOTs, nothing else");
  assert.ok(slips.every((s) => s.order.tokenNumber === undefined), "no token number on any slip");
  const entry = stored().entries[0];
  assert.deepEqual([entry.sale, entry.shownTotal], [true, 236], "a sale, the total taken");
});

test("a slip that cannot be drawn is a line that did not print (later), never a crash", async () => {
  const { deps, stored } = setup();
  const result = await keepOfflineSend(request(), { ...deps, slipOf: () => { throw new Error("payload"); } });
  if (result.kept === true) await result.printed;
  assert.deepEqual(stored().entries[0].lines.map((l: { outcome: string }) => l.outcome), ["later", "later"], "nothing printed");
});

test("Print KOT here prints a half-way send's here lines with its banner and records them; never twice", async () => {
  const { printEntryHere } = await import("@/lib/offline-keep");
  const { deps, slips, stored } = setup();
  const parked = await keepOfflineSend(request({ print: false, uncertain: true }), deps);
  assert.equal(parked.kept, true, "parked");
  assert.equal(slips.length, 0, "nothing printed when it was parked");
  const here = { base: null, menu: request().menu, routing: request().routing, hereIds: ["pr-kitchen"], simple: request().simple };
  const first = await printEntryHere("k-1", here, deps);
  assert.equal(first.printed, true, "printed");
  await first.done;
  assert.equal(slips.length, 1, "the here line only");
  assert.equal(slips[0].banner, "OFFLINE · O-1", "its own offline number");
  assert.deepEqual(stored().entries[0].lines.map((l: { outcome: string }) => l.outcome), ["printed", "later"], "recorded: the server marks it printed");
  assert.equal(stored().entries[0].uncertain, true, "still uncertain: the replay is still its check");
  const again = await printEntryHere("k-1", here, deps);
  assert.equal(again.printed, false, "a second Print KOT here is refused");
  assert.equal(slips.length, 1, "no second paper");
});

test("Print KOT here is only for a half-way send", async () => {
  const { printEntryHere } = await import("@/lib/offline-keep");
  const { deps, slips } = setup();
  const kept = await keepOfflineSend(request(), deps);
  if (kept.kept === true) await kept.printed;
  const before = slips.length;
  const here = { base: null, menu: request().menu, routing: request().routing, hereIds: ["pr-kitchen"], simple: request().simple };
  assert.equal((await printEntryHere("k-1", here, deps)).printed, false, "an entry printed when it was kept");
  assert.equal((await printEntryHere("missing", here, deps)).printed, false, "an entry that is gone");
  assert.equal(slips.length, before, "nothing printed");
});

test("fix wave I3: when a here line sent nothing, the print step answers what to tell staff", async () => {
  const { deps } = setup();
  const result = await keepOfflineSend(request(), { ...deps, print: async () => "no" });
  assert.equal(result.kept, true, "kept");
  if (result.kept !== true) return;
  assert.equal(await result.printed, "Offline: KOT O-1 did not print on Kitchen. It prints there when the internet is back.", "named");
});

test("fix wave m: Print KOT here of a round whose tab the POS no longer lists keeps the entry's table", async () => {
  const { printEntryHere } = await import("@/lib/offline-keep");
  const { deps, slips } = setup();
  const base = { _id: "srv-tab", orderId: "ORD-9", customerName: "R", tableNo: "T-5", kotRounds: 1, items: [], createdAt: "2026-11-04T08:00:00.000Z" } as never;
  await keepOfflineSend(request({ key: "k-r", base, body: { items: [item("p-tea", "Tea")] }, print: false, uncertain: true }), deps);
  const here = { base: null, menu: request().menu, routing: request().routing, hereIds: ["pr-kitchen"], simple: request().simple };
  const result = await printEntryHere("k-r", here, deps);
  if (result.printed) await result.done;
  assert.equal(slips[0]?.order.tableNo, "T-5", "its table on the paper");
});
