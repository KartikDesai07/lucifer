// Printing Phase 5 (spec 2026-11-03 §5.4), Task 6: the offline KOT is the order the server would make of the same
// send (its lines stamped by the server's own pure stamp, its round numbered as the server numbers it), minus what
// only the server gives: an order number of its own, KOT numbers and a token. Pure fixtures, no DB, no React.

import { test } from "node:test";
import assert from "node:assert/strict";

import { offlineKotOrder, offlineKotSlip, offlineRoundOf } from "@/lib/offline-kot-order";
import { kitchenOrderOf, type ProductKitchenFacts } from "@/lib/kitchen-lines";
import { kotPrintJob } from "@/lib/print-routing";
import { printJobPayloadSchema } from "@pos/shared/schemas/print-job.schema";
import type { CreateOrderInput, Order, OrderItem } from "@/types";

const NOW = "2026-11-04T09:30:00.000Z";
const KEY = "5b1c0d2e-3f40-4a51-8b62-7c83d94ea5f6";

// Tea is a hot drink (ranked second), the water is a bottle (no kitchen ticket), the cake a dessert (ranked first).
const PRODUCTS: ReadonlyMap<string, ProductKitchenFacts> = new Map([
  ["p-tea", { categoryId: "c-hot" }],
  ["p-water", { categoryId: "c-bottles" }],
  ["p-cake", { categoryId: "c-dessert" }],
]);
const SKIP_CATEGORY_IDS: ReadonlySet<string> = new Set(["c-bottles"]);
const CATEGORY_RANKS: ReadonlyMap<string, number> = new Map([
  ["c-dessert", 0],
  ["c-hot", 1],
]);

type CartLine = CreateOrderInput["items"][number];

function cartLine(productId: string, name: string): CartLine {
  return { productId, name, price: 120, qty: 1, modifiers: [], instructions: "" };
}

const TEA = cartLine("p-tea", "Tea");
const WATER = cartLine("p-water", "Water");
const CAKE = cartLine("p-cake", "Cake");

function tabLine(name: string, kotRound: number, over: Partial<OrderItem> = {}): OrderItem {
  return { productId: `p-${name.toLowerCase()}`, name, price: 100, qty: 1, modifiers: [], instructions: "", kotRound, ...over };
}

// A tab the server already has: two rounds fired, numbered, with a token.
const SERVER_TAB: Order = {
  _id: "665f0a0000000000000000a1",
  orderId: "ORD-20261104-007",
  customerName: "Ravi",
  items: [tabLine("Paneer", 1, { kotRank: 5 }), tabLine("Naan", 2)],
  subtotal: 200,
  discount: 0,
  total: 200,
  paidAmount: 0,
  payment: "Unpaid",
  status: "Pending",
  receiver: "Meera",
  tableNo: "T-4",
  kotRounds: 2,
  kotNumbers: [11, 12],
  tokenNumber: 5,
  createdAt: "2026-11-04T08:00:00.000Z",
  updatedAt: "2026-11-04T08:10:00.000Z",
};

function stamp(over: Partial<Parameters<typeof offlineKotOrder>[0]>): Order {
  return offlineKotOrder({
    key: KEY,
    ref: "O-3",
    round: 1,
    nowIso: NOW,
    base: null,
    body: { customerName: "Walk-in", tableNo: "T-2", receiver: "Asha", items: [TEA] },
    products: PRODUCTS,
    skipCategoryIds: SKIP_CATEGORY_IDS,
    categoryRanks: CATEGORY_RANKS,
    ...over,
  });
}

test("a new order's offline KOT is round 1 with the offline number as its order id", () => {
  assert.equal(offlineRoundOf(null, 0), 1, "a new order opens at round 1");
  assert.equal(offlineRoundOf(null, 2), 1, "earlier offline rounds of other orders never count for a new one");
  const order = stamp({});
  assert.equal(order._id, `offline-${KEY}`, "the local id names the entry's key");
  assert.equal(order.orderId, "O-3", "the Order row reads the offline number");
  assert.equal(order.kotRounds, 1, "one round fired");
  assert.deepEqual(order.items.map((line) => line.kotRound), [1], "the cart's line is fired in round 1");
  assert.equal(order.customerName, "Walk-in", "the customer");
  assert.equal(order.tableNo, "T-2", "the table");
  assert.equal(order.receiver, "Asha", "the staff member who took it");
  assert.equal(order.createdAt, NOW, "taken now");
  assert.equal(order.updatedAt, NOW, "touched now");
  assert.equal("kotNumbers" in order, false, "no KOT number: only the server numbers tickets");
  assert.equal("tokenNumber" in order, false, "no token: only the server draws one");
});

test("a round on a tab counts the tab's rounds and the earlier offline ones", () => {
  assert.equal(offlineRoundOf(SERVER_TAB, 0), 3, "the tab's two rounds, then this one");
  assert.equal(offlineRoundOf(SERVER_TAB, 1), 4, "one round of this tab already waits offline");
  const order = stamp({ ref: "O-5", round: 4, base: SERVER_TAB, body: { customerName: "Ravi", items: [CAKE] } });
  assert.equal(order._id, `offline-${KEY}`, "still a local id: the server has not saved this round");
  assert.equal(order.orderId, "ORD-20261104-007", "a tab the server has keeps its own order number");
  assert.equal(order.kotRounds, 4, "the round count is this round");
  assert.deepEqual(order.items.slice(0, 2), SERVER_TAB.items, "the tab's lines stay exactly as the server stamped them");
  assert.deepEqual(order.items.slice(2).map((line) => [line.name, line.kotRound]), [["Cake", 4]], "the new line in round 4");
  assert.equal(order.tableNo, "T-4", "the tab's table");
  assert.equal(order.receiver, "Meera", "the tab's staff member when the round names none");
  assert.equal("kotNumbers" in order, false, "the tab's ticket numbers are dropped: this round has none");
  assert.equal("tokenNumber" in order, false, "no token on a round");
  assert.equal(order.createdAt, SERVER_TAB.createdAt, "the KOT's Time line reads the tab's open time, as an online round's KOT does");
  // A round on an order made offline: that order has no server number yet, so the round reads its own offline number.
  const local = stamp({});
  const chained = stamp({ ref: "O-4", round: offlineRoundOf(local, 0), base: local, body: { customerName: "Walk-in", items: [CAKE] } });
  assert.equal(chained.kotRounds, 2, "the local order's round 1, then this one");
  assert.equal(chained.orderId, "O-4", "no server id on the base: the round's own offline number");
});

test("skip-KOT and the kitchen order are stamped as the server stamps them", () => {
  const order = stamp({ body: { customerName: "Walk-in", items: [TEA, WATER, CAKE] } });
  const [tea, water, cake] = order.items;
  assert.equal(tea?.kotRank, 1, "a hot drink takes its category's place");
  assert.equal("noKot" in (tea ?? {}), false, "a kitchen line carries no skip key");
  assert.equal(water?.noKot, true, "a bottle never goes to the kitchen");
  assert.equal("kotRank" in (water ?? {}), false, "a skip line takes no place");
  assert.equal(cake?.kotRank, 0, "a dessert takes its category's place");
  assert.deepEqual(kitchenOrderOf(order).items.map((line) => line.name), ["Cake", "Tea"], "the kitchen sees no bottle, in Kitchen order");
});

test("the slip carries the OFFLINE banner and no ticket number", () => {
  const order = stamp({ ref: "O-3", round: 3, base: SERVER_TAB, body: { customerName: "Ravi", items: [TEA] } });
  const slip = offlineKotSlip(order, 3, "O-3");
  assert.equal(slip.banner, "OFFLINE · O-3", "the inverted banner names the offline number");
  assert.equal(slip.kotRoundNumber, undefined, "no number box: an offline KOT has no server number");
  assert.equal("kotRoundNumber" in slip, false, "the key is absent, not an explicit undefined");
  assert.equal(slip.surface, "kot", "today's KOT surface");
  assert.equal(slip.kotRoundLabel, "Round 3", "today's round label");
  assert.deepEqual(slip.kotRoundItems?.map((line) => line.name), ["Tea"], "only this round's lines");
  assert.equal(slip.order.orderId, "ORD-20261104-007", "the Order row reads the tab's own number");
});

test("the snapshot of an offline KOT passes the strict print schema", () => {
  const fresh = stamp({ body: { customerName: "Walk-in", tableNo: "T-2", notes: "No sugar", items: [TEA, WATER, CAKE] } });
  const freshParse = printJobPayloadSchema.safeParse(kotPrintJob(fresh, 1).payload);
  assert.equal(freshParse.success, true, `a new order's KOT parses: ${JSON.stringify(freshParse.error?.issues)}`);
  const round = stamp({ ref: "O-5", round: 3, base: SERVER_TAB, body: { customerName: "Ravi", items: [CAKE] } });
  const roundParse = printJobPayloadSchema.safeParse(kotPrintJob(round, 3).payload);
  assert.equal(roundParse.success, true, `a round's KOT parses: ${JSON.stringify(roundParse.error?.issues)}`);
});
