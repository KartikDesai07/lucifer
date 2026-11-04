// The pure half of an offline send (Printing Phase 5, spec 5.2–5.6; plan Task 11): numbering the round, planning its
// lines, the entry kept BEFORE any paper (its here lines "maybe" until their paper is known, so a page that dies
// mid-print leaves a labelled REPRINT, never an unlabelled second KOT), the words staff see, and each line's copies.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@pos/shared/api-client";
import type { PrinterConfig, StationConfig } from "@pos/shared/print-printers";
import { emptyOutbox, takeOfflineRef } from "@/lib/offline-outbox";
import type { OfflineLinePlan } from "@/lib/offline-lines";
import { offlineRoutingOf } from "@/lib/offline-lines";
import { PrintWriteError } from "@/lib/print-write-outcome";
import { offlineKeptMessage, offlineMenuOf, offlineSlipOutcomeOf, planOfflineKeep, printOfflineLines, type OfflineKeepRequest } from "@/lib/offline-send";
import type { Order } from "@/types";

const KITCHEN: StationConfig = { id: "st-kitchen", name: "Kitchen", order: 0, isDefault: true };
const BAR: StationConfig = { id: "st-bar", name: "Bar", order: 1, isDefault: false };
const NONE = { bill: false, kotStations: [] as string[], kotAll: false, notices: false, eod: false };
const printer = (id: string, station: string, deviceId: string): PrinterConfig => ({
  id,
  name: id === "pr-kitchen" ? "Kitchen" : "Bar",
  connection: { kind: "device", deviceId, transport: "bt-classic", address: "00:11:22:33:44:55" },
  order: 0,
  paper: 80,
  slips: { ...NONE, kotStations: [station] },
  copies: { kot: id === "pr-kitchen" ? 2 : 1, bill: 1 },
  enabled: true,
});
const PRINTERS = [printer("pr-kitchen", KITCHEN.id, "this-device"), printer("pr-bar", BAR.id, "bar-tablet")];
const PRODUCTS = [
  { _id: "p-tea", categoryId: "c-hot" },
  { _id: "p-mojito", categoryId: "c-drinks" },
  { _id: "p-water", categoryId: "c-water" },
];
const CATEGORIES = [{ _id: "c-hot" }, { _id: "c-drinks", stationId: BAR.id }, { _id: "c-water", noKot: true as const }];
const ROUTING = offlineRoutingOf({ printers: PRINTERS, stations: [KITCHEN, BAR], products: PRODUCTS, categories: CATEGORIES });
const MENU = offlineMenuOf(PRODUCTS, CATEGORIES);
const item = (productId: string, name: string) => ({ productId, name, price: 100, qty: 1, modifiers: [], instructions: "" });
const DAY = "2026-11-04";

function request(over: Partial<OfflineKeepRequest> = {}): OfflineKeepRequest {
  return {
    key: "k-create",
    at: Date.parse("2026-11-04T09:30:00.000Z"),
    sale: false,
    base: null,
    body: { customerName: "Walk-In", tableNo: "T-2", receiver: "Asha", items: [item("p-tea", "Tea"), item("p-mojito", "Mojito")], total: 200, idemKey: "never-kept" },
    shownTotal: 200,
    menu: MENU,
    routing: ROUTING,
    hereIds: ["pr-kitchen"],
    simple: { printsOwnSlips: true, canPrintNow: true },
    print: true,
    ...over,
  };
}

test("a new order: O-1, its routed lines, the entry kept with its here line as maybe and the other as later", () => {
  const planned = planOfflineKeep(emptyOutbox(DAY), request());
  assert.ok(planned.ok, "kept");
  if (!planned.ok) return;
  assert.equal(planned.entry.ref, "O-1", "the first offline number of the day");
  assert.equal(planned.record.next, 2, "the number is taken");
  assert.deepEqual(planned.entry.lines, [
    { printerId: "pr-kitchen", part: KITCHEN.id, outcome: "maybe" },
    { printerId: "pr-bar", part: BAR.id, outcome: "later" },
  ], "here = maybe until its paper is known; another device's line waits");
  assert.deepEqual(planned.plan.map((l) => [l.printerId, l.here, l.copies]), [["pr-kitchen", true, 2], ["pr-bar", false, 1]], "the plan");
  const { entry } = planned;
  assert.deepEqual([entry.kind, entry.sale, entry.uncertain, entry.local, entry.orderId, entry.table, entry.state, entry.at, entry.shownTotal],
    ["create", false, false, "offline-k-create", null, "T-2", "waiting", Date.parse("2026-11-04T09:30:00.000Z"), 200], "the entry's facts");
  assert.equal((entry.body as Record<string, unknown>).idemKey, undefined, "the key is the entry's own, never inside the body");
  assert.equal(planned.record.entries.length, 1, "added");
});

test("print: false keeps every line for the server (an online round on an order made offline)", () => {
  const planned = planOfflineKeep(emptyOutbox(DAY), request({ print: false }));
  assert.ok(planned.ok && planned.entry.lines.every((l) => l.outcome === "later"), "nothing prints here");
});

test("a round on a server tab: numbered after the tab's rounds and the ones still waiting; the tab keeps its number", () => {
  const tab = { _id: "srv-tab", orderId: "ORD-20261104-007", customerName: "Rahul", tableNo: "T-5", receiver: "Asha", kotRounds: 2, items: [], createdAt: "2026-11-04T08:00:00.000Z" } as unknown as Order;
  const first = planOfflineKeep(emptyOutbox(DAY), request({ key: "k-r1", base: tab, body: { items: [item("p-tea", "Tea")] } }));
  assert.ok(first.ok, "kept");
  if (!first.ok) return;
  assert.deepEqual([first.entry.kind, first.entry.local, first.entry.orderId, first.entry.table], ["round", "srv-tab", "srv-tab", "T-5"], "a round on the server's tab");
  assert.equal(first.plan[0].request.payload.kind, "kot", "a KOT");
  const second = planOfflineKeep(first.record, request({ key: "k-r2", base: tab, body: { items: [item("p-tea", "Tea")] } }));
  assert.ok(second.ok, "kept");
  if (!second.ok) return;
  const roundOf = (plan: OfflineLinePlan[]) => (plan[0].request.payload as { round?: number }).round;
  assert.deepEqual([roundOf(first.plan), roundOf(second.plan)], [3, 4], "rounds 3 and 4 after the tab's 2");
});

test("a round on an order made offline waits for its create's server id; once the create is gone it is refused", () => {
  const created = planOfflineKeep(emptyOutbox(DAY), request());
  assert.ok(created.ok, "the create");
  if (!created.ok) return;
  const base = { _id: "offline-k-create", orderId: "O-1", customerName: "Walk-In", tableNo: "T-2", kotRounds: 1, items: [], createdAt: "2026-11-04T09:30:00.000Z" } as unknown as Order;
  const round = planOfflineKeep(created.record, request({ key: "k-round", base, body: { items: [item("p-tea", "Tea")] } }));
  assert.ok(round.ok, "kept");
  if (!round.ok) return;
  assert.deepEqual([round.entry.local, round.entry.orderId, round.entry.ref], ["offline-k-create", null, "O-2"], "chained to its create, its own number");
  const gone = planOfflineKeep(emptyOutbox(DAY), request({ key: "k-late", base, body: { items: [item("p-tea", "Tea")] } }));
  assert.deepEqual(gone, { ok: false, reason: "order-sent" }, "its create already left: never an orphan round");
});

test("refusals before any paper: full, duplicate, too many lines, no number left", () => {
  const one = planOfflineKeep(emptyOutbox(DAY), request());
  assert.ok(one.ok, "a template entry");
  if (!one.ok) return;
  const full = { ...emptyOutbox(DAY), entries: Array.from({ length: 300 }, (_, i) => ({ ...one.entry, key: `k${i}` })) };
  assert.deepEqual(planOfflineKeep(full, request()), { ok: false, reason: "full" }, "300 entries");
  const once = planOfflineKeep(emptyOutbox(DAY), request());
  assert.ok(once.ok, "kept once");
  if (!once.ok) return;
  assert.deepEqual(planOfflineKeep(once.record, request()), { ok: false, reason: "duplicate" }, "the same key twice");
  const many = request({ routing: { ...ROUTING!, printers: Array.from({ length: 25 }, (_, i) => ({ ...PRINTERS[0], id: `p${i}`, slips: { ...NONE, kotAll: true } })) } });
  assert.deepEqual(planOfflineKeep(emptyOutbox(DAY), many), { ok: false, reason: "too-many-lines" }, "more than 24 lines");
  const spent = { ...emptyOutbox(DAY), next: 10_000 };
  assert.deepEqual(planOfflineKeep(spent, request()), { ok: false, reason: "number" }, "past O-9999: refused, never a throw");
  assert.equal(takeOfflineRef(emptyOutbox(DAY)).ref, "O-1", "sanity");
});

test("the words (spec 5.5–5.6)", () => {
  const plan = (here: boolean[]): OfflineLinePlan[] => here.map((h, i) => ({ printerId: i === 0 ? "pr-kitchen" : "pr-bar", part: "x", copies: 1, here: h, request: {} as never }));
  const nameOf = (id: string | null) => (id === "pr-bar" ? "Bar" : "Kitchen");
  assert.equal(offlineKeptMessage({ ref: "O-3", sale: false, plan: plan([true]), print: true, nameOf }), "Offline: KOT O-3 printed here. It is sent when the internet is back.", "all here");
  assert.equal(offlineKeptMessage({ ref: "O-3", sale: false, plan: plan([true, false]), print: true, nameOf }), "Offline: KOT O-3 printed here. Bar prints when the internet is back.", "one line waits");
  assert.equal(offlineKeptMessage({ ref: "O-3", sale: false, plan: plan([false, false]), print: true, nameOf }), "Offline: order O-3 is kept on this device. It prints when the internet is back.", "a waiter phone");
  assert.equal(offlineKeptMessage({ ref: "O-4", sale: true, plan: plan([true]), print: true, nameOf }), "Offline: KOT O-4 printed. The sale is saved and its bill prints when the internet is back.", "Pay Now");
  assert.equal(offlineKeptMessage({ ref: "O-4", sale: true, plan: plan([false]), print: true, nameOf }), "Offline: order O-4 is kept on this device. It prints when the internet is back.", "Pay Now with nothing here");
  assert.equal(offlineKeptMessage({ ref: "O-5", sale: false, plan: [], print: true, nameOf }), "Offline: order O-5 is kept on this device. It is sent when the internet is back.", "no kitchen line at all");
});

test("each here line prints its copies one after another; a later copy that failed is maybe; another device's line never prints", async () => {
  const plan: OfflineLinePlan[] = [
    { printerId: "a", part: "x", copies: 2, here: true, request: {} as never },
    { printerId: "b", part: "y", copies: 1, here: false, request: {} as never },
    { printerId: "c", part: "z", copies: 2, here: true, request: {} as never },
    { printerId: "d", part: "w", copies: 2, here: true, request: {} as never },
  ];
  const replies: Record<string, ("printed" | "maybe" | "no")[]> = { a: ["printed", "printed"], c: ["printed", "no"], d: ["no"] };
  const printed: string[] = [];
  const outcomes = await printOfflineLines(plan, async (index) => {
    const id = plan[index].printerId as string;
    printed.push(id);
    return replies[id].shift() ?? "printed";
  });
  assert.deepEqual(printed, ["a", "a", "c", "c", "d"], "copies in order; b never; d stops at its first refusal");
  assert.deepEqual([...outcomes.entries()], [[0, "printed"], [2, "maybe"], [3, "no"]], "a failed second copy may have put paper out");
});

test("a slip's outcome: printed, nothing sent, or maybe (a watchdog's give-up says the bridge's generic sentence)", () => {
  assert.equal(offlineSlipOutcomeOf({ ok: true }), "printed", "printed");
  assert.equal(offlineSlipOutcomeOf({ ok: false, error: new PrintWriteError("x", "no") }), "no", "nothing sent");
  assert.equal(offlineSlipOutcomeOf({ ok: false, error: new Error("Couldn't print. Try again.") }), "maybe", "unknown: may be on paper");
  assert.equal(offlineSlipOutcomeOf({ ok: false, error: new ApiError("x", "network", null) }), "maybe", "anything else: maybe");
});

test("the menu facts as the server reads them: skip categories, ranks, each product's category and own choice", () => {
  const menu = offlineMenuOf([{ _id: "p1", categoryId: "c1", noKot: false }, { _id: "p2", categoryId: "c2" }], [{ _id: "c1", noKot: true, kotOrder: 2 }, { _id: "c2", kotOrder: 1 }]);
  assert.deepEqual(menu.products.get("p1"), { categoryId: "c1", noKot: false }, "its own choice");
  assert.deepEqual([...menu.skipCategoryIds], ["c1"], "a skipping category");
  assert.deepEqual([...menu.categoryRanks.entries()], [["c1", 2], ["c2", 1]], "the kitchen order");
});

test("Pay Now offline offers Cash, Online and Split only (spec 5.6); online every mode as today", async () => {
  const { offlineSaleModes, PAY_OFFLINE_NOTE } = await import("@/lib/payment-result");
  const all = ["Cash", "Online", "Due", "Split", "Credit"] as const;
  assert.deepEqual(offlineSaleModes([...all], true), ["Cash", "Online", "Split"], "offline: the three the server need not check");
  assert.deepEqual(offlineSaleModes([...all], false), [...all], "online: unchanged");
  assert.match(PAY_OFFLINE_NOTE, /need the internet/, "the rest are shown as needing the internet");
});
