// U1 Task 6 (2026-10-21): the /pos header's switch-order button and the Open orders panel it opens, in the owner's HTML
// (values 1.2-1.4 and 7 in docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.2; owner Q16, Q17). What the
// button says about the order on screen (code tile, title, sub, "{N} open", the dot) and what the panel lists: our open
// tabs, searched on the device, in the tabs All · Tables · Walk-In, the current tab first, then the newest.
import { test } from "node:test";
import assert from "node:assert/strict";

import type { Order, OrderItem } from "@/types";
import {
  codeOf,
  openOrderCounts,
  openOrderRows,
  openOrdersSummary,
  switchView,
  type SwitchInput,
} from "./pos-open-orders";

const item = (qty: number, kotRound = 1): OrderItem => ({
  productId: "p1",
  name: "Margherita",
  price: 100,
  qty,
  modifiers: [],
  instructions: "",
  kotRound,
});

const tab = (over: Partial<Order>): Order =>
  ({
    _id: "id",
    orderId: "ORD-20261020-001",
    customerName: "Walk-In",
    items: [item(1)],
    subtotal: 100,
    discount: 0,
    total: 100,
    paidAmount: 0,
    payment: "Unpaid",
    status: "Pending",
    receiver: "Staff",
    kotRounds: 1,
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-20T09:00:00.000Z",
    ...over,
  }) as Order;

// The scratch data's three open tabs, plus one walk-in tab with a customer.
const T2 = tab({ _id: "t2", orderId: "ORD-20261020-004", tableNo: "T-2", items: [item(1), item(2), item(3)], total: 1090, createdAt: "2026-10-20T08:52:29.324Z" });
const T6 = tab({ _id: "t6", orderId: "ORD-20261020-002", tableNo: "T-6", customerId: "c1", customerName: "Manan Shroff", items: [item(1)], total: 200, createdAt: "2026-10-20T08:54:29.324Z" });
const T1 = tab({ _id: "t1", orderId: "ORD-20261020-003", tableNo: "T-1", items: [item(2)], total: 440, createdAt: "2026-10-20T09:14:29.324Z" });
const WI = tab({ _id: "wi", orderId: "ORD-20261020-005", customerId: "c2", customerName: "Neha Joshi", items: [item(2), item(1)], total: 954, createdAt: "2026-10-20T09:20:00.000Z" });
const TABS = [T2, T6, T1, WI];
const NOW = new Date("2026-10-20T09:24:29.324Z");

// ── the code tile (values 1.3 codeOf; design 6.2) ─────────────────────────────────────────────────────────────────

test("codeOf: a table is \"T\" + its name's digits, else its first two letters; a walk-in tab \"WI\"; a new order \"+\"", () => {
  assert.equal(codeOf("T-4", false, false), "T4", "the HTML's 'T'+digits");
  assert.equal(codeOf("T-10", false, false), "T10", "every digit of the name");
  assert.equal(codeOf("Rooftop", false, false), "RO", "no digits: the first two letters, upper-case");
  assert.equal(codeOf("bar", false, false), "BA", "lower-case names read upper-case");
  assert.equal(codeOf(undefined, true, false), "WI", "a walk-in tab");
  assert.equal(codeOf("T-4", false, true), "+", "a new order is \"+\", whatever table it has picked");
  assert.equal(codeOf(undefined, true, true), "+", "a new walk-in order is \"+\" too");
});

// ── the switch button (values 1.2, 1.3; design 6.2) ───────────────────────────────────────────────────────────────

const NEW_EMPTY: SwitchInput = { resumedOrder: null, customerName: undefined, count: 0, newCount: 0, total: 0 };

test("switchView: a new order with no items — \"+\", \"New order\", \"Walk-In · No items yet\", the grey dot", () => {
  const view = switchView(NEW_EMPTY, [T2, T6, T1]);
  assert.equal(view.code, "+", "a new order's tile");
  assert.equal(view.title, "New order", "the cart's own title (lib/pos-cart-view.ts)");
  assert.equal(view.sub, "Walk-In · No items yet", "the HTML's \"{who} · No items yet\"");
  assert.equal(view.count, "3 open", "the open tabs, not counting the new order");
  assert.equal(view.dot, "empty", "grey: no items");
});

test("switchView: the sub names the customer and counts quantities, singular for one (never \"1 items\")", () => {
  assert.equal(switchView({ ...NEW_EMPTY, count: 1, newCount: 1, total: 200 }, []).sub, "Walk-In · 1 item · ₹200", "one item");
  assert.equal(
    switchView({ ...NEW_EMPTY, customerName: "Neha Joshi", count: 5, newCount: 5, total: 954 }, []).sub,
    "Neha Joshi · 5 items · ₹954",
    "the customer's name, five items, the total",
  );
  assert.equal(switchView({ ...NEW_EMPTY, customerName: "  ", count: 2, newCount: 2, total: 50 }, []).sub, "Walk-In · 2 items · ₹50", "a blank name is no name");
  assert.equal(switchView(NEW_EMPTY, []).count, "0 open", "no open tabs");
  assert.equal(switchView(NEW_EMPTY, [T6]).count, "1 open", "one open tab");
});

test("switchView: the dot — orange while any item is not sent, green when all are sent", () => {
  assert.equal(switchView({ ...NEW_EMPTY, count: 3, newCount: 3, total: 300 }, []).dot, "unsent", "a new order with items");
  const resumed = { resumedOrder: T2, customerName: undefined, total: 1090 };
  assert.equal(switchView({ ...resumed, count: 6, newCount: 0 }, TABS).dot, "sent", "a tab with every item sent");
  assert.equal(switchView({ ...resumed, count: 7, newCount: 1 }, TABS).dot, "unsent", "a tab with a new round being built");
  assert.equal(switchView({ ...resumed, count: 0, newCount: 0 }, TABS).dot, "empty", "a tab with nothing on it");
});

test("switchView: a resumed tab — its table's code and \"Table T-2\", or \"WI\" and \"Walk-In\"", () => {
  const table = switchView({ resumedOrder: T6, customerName: "Manan Shroff", count: 1, newCount: 0, total: 200 }, TABS);
  assert.equal(table.code, "T6", "the table's code");
  assert.equal(table.title, "Table T-6", "the cart's title");
  assert.equal(table.sub, "Manan Shroff · 1 item · ₹200", "the customer, the items, the total on screen");
  const walkIn = switchView({ resumedOrder: WI, customerName: "Neha Joshi", count: 3, newCount: 0, total: 954 }, TABS);
  assert.equal(walkIn.code, "WI", "a walk-in tab");
  assert.equal(walkIn.title, "Walk-In", "the cart's title for a tab with no table");
});

// ── the panel (values 7.1, 7.2; design 6.2; owner Q16) ────────────────────────────────────────────────────────────

test("openOrdersSummary: \"{N} open · ₹{sum}\" over every open tab", () => {
  assert.equal(openOrdersSummary(TABS), "4 open · ₹2,684", "four tabs, their totals summed");
  assert.equal(openOrdersSummary([]), "0 open · ₹0", "none");
});

test("openOrderCounts: All, Tables and Walk-In, whatever the search", () => {
  assert.deepEqual(openOrderCounts(TABS), { All: 4, Tables: 3, "Walk-In": 1 }, "three at tables, one walk-in");
  assert.deepEqual(openOrderCounts([]), { All: 0, Tables: 0, "Walk-In": 0 }, "none");
});

test("openOrderRows: the newest tab first; each row's code, title, sub, total and status", () => {
  const rows = openOrderRows(TABS, undefined, "", "All", NOW);
  assert.deepEqual(rows.map((r) => r.key), ["wi", "t1", "t6", "t2"], "newest createdAt first");
  const [wi, t1, t6, t2] = rows;
  assert.equal(wi.code, "WI", "a walk-in tab's tile");
  assert.equal(wi.id, "Walk-In", "a walk-in tab's title");
  assert.equal(wi.sub, "Neha Joshi · 3 items · 4 min", "customer · items (quantities) · minutes open");
  assert.equal(t1.code, "T1", "a table's tile");
  assert.equal(t1.id, "Table T-1", "a table tab's title");
  assert.equal(t1.sub, "2 items · 10 min", "no customer on the tab: the placeholder name is not shown");
  assert.equal(t6.sub, "Manan Shroff · 1 item · 30 min", "singular for one item");
  assert.equal(t2.sub, "6 items · 32 min", "the HTML's Table 4 age");
  assert.equal(t2.total, "₹1,090", "the tab's total");
  for (const r of rows) {
    assert.equal(r.status, "In kitchen", `every open tab is in the kitchen (we have no billed state): ${r.key}`);
    assert.equal(r.current, false, `no tab is on screen: ${r.key}`);
  }
  assert.equal(rows[0].tab, WI, "the row carries its tab (the resume takes it)");
});

test("openOrderRows: the current tab first, lit and marked \" · current\"", () => {
  const rows = openOrderRows(TABS, "t2", "", "All", NOW);
  assert.deepEqual(rows.map((r) => r.key), ["t2", "wi", "t1", "t6"], "current first, then newest");
  assert.equal(rows[0].id, "Table T-2 · current", "the HTML's \" · current\"");
  assert.equal(rows[0].current, true, "lit");
  assert.equal(rows[1].current, false, "the others are not");
});

test("openOrderRows: the rows rise in turn, 25 ms apart, at most 300 ms", () => {
  const many = Array.from({ length: 15 }, (_, i) => tab({ _id: `x${i}`, tableNo: `T-${i}` }));
  const rows = openOrderRows(many, undefined, "", "All", NOW);
  assert.equal(rows[0].delay, "0.000s", "the first at once");
  assert.equal(rows[1].delay, "0.025s", "the second 25 ms later");
  assert.equal(rows[14].delay, "0.300s", "never later than .3 s");
});

test("openOrderRows: the search matches the table, the customer or the order id, any case, trimmed", () => {
  const keys = (q: string) => openOrderRows(TABS, undefined, q, "All", NOW).map((r) => r.key);
  assert.deepEqual(keys("t-6"), ["t6"], "by table");
  assert.deepEqual(keys("  MANAN "), ["t6"], "by customer name, any case, trimmed");
  assert.deepEqual(keys("-003"), ["t1"], "by order id");
  assert.deepEqual(keys("walk"), ["wi"], "a walk-in tab by its title; the placeholder customer name matches nothing");
  assert.deepEqual(keys("zzz"), [], "no match");
});

test("openOrderRows: the tabs filter Tables and Walk-In", () => {
  assert.deepEqual(openOrderRows(TABS, undefined, "", "Tables", NOW).map((r) => r.key), ["t1", "t6", "t2"], "tabs at a table");
  assert.deepEqual(openOrderRows(TABS, undefined, "", "Walk-In", NOW).map((r) => r.key), ["wi"], "tabs with no table");
  assert.deepEqual(openOrderRows(TABS, undefined, "neha", "Tables", NOW).map((r) => r.key), [], "the search within the tab");
});

test("openOrderRows: a tab with nothing on it reads \"No items\" and \"—\"", () => {
  const empty = tab({ _id: "e", tableNo: "T-9", items: [], total: 0, createdAt: "2026-10-20T09:23:59.000Z" });
  const [row] = openOrderRows([empty], undefined, "", "All", NOW);
  assert.equal(row.sub, "No items · 1 min", "the HTML's 'No items' and at least one minute");
  assert.equal(row.total, "—", "no total");
});
