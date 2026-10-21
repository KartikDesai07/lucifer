// U1 Task 4 (2026-10-21): the /pos cart's head and lines in the owner's HTML (values 5.2, 5.4, 5.7 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.5, 6.6; owner Q9, Q10). The words the head and the
// lines show (the title, the tab's "#012 · 32 min", the Table cell, a line's number and meta), the stored-order address
// the cart's Void action hands the void dialog, and when a selected line stays selected.
import { test } from "node:test";
import assert from "node:assert/strict";

import { orderLineKey } from "@pos/shared/utils";
import { cartItemFromOrderItem } from "@/hooks/use-cart";
import type { CartItem } from "@/hooks/use-cart";
import type { Area, Order, OrderItem, Table } from "@/types";
import {
  cartTitle,
  lineMeta,
  lineNumber,
  matchVoidLine,
  selectionHolds,
  tabMeta,
  tableAreaName,
  tableCellValue,
  voidLineOf,
} from "./pos-cart-view";

const item = (over: Partial<OrderItem>): OrderItem => ({
  productId: "p1",
  name: "Margherita",
  price: 409,
  qty: 1,
  modifiers: [],
  instructions: "",
  kotRound: 0,
  ...over,
});

// ── a line's meta (values 5.4 meta; design 6.6) ───────────────────────────────────────────────────────────────────

test("lineMeta: the variation, the add-ons, the instructions, joined with \", \" as the HTML's meta", () => {
  const line = item({ variation: "Large", modifiers: ["Extra cheese", "Olives"], instructions: "less spicy" });
  assert.equal(lineMeta(line), "Large, + Extra cheese, Olives, less spicy", "variation first, then \"+ add-ons\", then the note");
  assert.equal(lineMeta(item({ variation: "Medium" })), "Medium", "a variation alone");
  assert.equal(lineMeta(item({ instructions: "  no ice  " })), "no ice", "the note trimmed");
});

test("lineMeta: an item whose modifiers come ticked shows what was taken off as \"NO …\" (the shared formatter)", () => {
  const line = item({ removedModifiers: ["Mushroom", "Onion"], instructions: "Jain" });
  assert.equal(lineMeta(line), "NO Mushroom, NO Onion, Jain", "the removals print as the kitchen reads them");
  assert.equal(
    lineMeta(item({ variation: "Regular", removedModifiers: ["Onion"] })),
    "Regular, NO Onion",
    "a size and a removal",
  );
});

test("lineMeta: nothing to say about the line reads the HTML's \"₹{price} each\"", () => {
  assert.equal(lineMeta(item({ price: 199 })), "₹199 each", "values 5.4: RS(price)+' each' when the meta is empty");
  assert.equal(lineMeta(item({ price: 220, instructions: "   " })), "₹220 each", "a blank note is no note");
});

test("lineNumber: the HTML's two-digit position", () => {
  assert.equal(lineNumber(0), "01", "the first line is 01");
  assert.equal(lineNumber(8), "09", "a leading zero below ten");
  assert.equal(lineNumber(11), "12", "two digits from ten");
});

// ── the head's words (values 5.2; design 6.5) ─────────────────────────────────────────────────────────────────────

test("cartTitle: a seated tab names its table, a walk-in tab reads Walk-In, a new order reads New order", () => {
  assert.equal(cartTitle({ resumedOrder: { tableNo: "T-4" } }), "Table T-4", "a resumed tab at a table");
  assert.equal(cartTitle({ resumedOrder: { tableNo: undefined } }), "Walk-In", "a resumed walk-in tab");
  assert.equal(cartTitle({ resumedOrder: {} }), "Walk-In", "a tab with no table field at all");
  assert.equal(cartTitle({ resumedOrder: null }), "New order", "nothing resumed: a new order");
});

test("tabMeta: \"#{the order id's last part} · {m} min\", at least 1 min, rounded", () => {
  const opened = "2026-10-20T08:52:29.324Z";
  const order = { orderId: "ORD-20261020-012", createdAt: opened };
  const at = (mins: number) => new Date(Date.parse(opened) + mins * 60_000);
  assert.equal(tabMeta(order, at(0)), "#012 · 1 min", "a tab opened this minute reads 1 min (Math.max(1, …))");
  assert.equal(tabMeta(order, at(31.6)), "#012 · 32 min", "31.6 minutes round to 32");
  assert.equal(tabMeta(order, at(68)), "#012 · 68 min", "over an hour stays in minutes, as the HTML");
  assert.equal(tabMeta({ orderId: "ORD-20261020-004", createdAt: opened }, at(32)), "#004 · 32 min", "the day's number");
  assert.equal(tabMeta({ orderId: "ORD-20261020-012", createdAt: "not a date" }, at(3)), null, "no time: no meta");
});

test("tableCellValue: \"{table} · {area}\", the table alone without an area, Walk-In without a table", () => {
  assert.equal(tableCellValue("T-4", "Indoor"), "T-4 · Indoor", "values 5.2 cell 1: 'T4 · Indoor'");
  assert.equal(tableCellValue("T-4", undefined), "T-4", "a table in no area");
  assert.equal(tableCellValue(undefined, undefined), "Walk-In", "no table");
  assert.equal(tableCellValue(undefined, "Indoor"), "Walk-In", "an area alone means nothing without a table");
});

test("tableAreaName: the area a table sits in, through the shared area reader; none when unknown", () => {
  const areas = [{ _id: "a1", name: "AC Hall" }, { _id: "a2", name: "Garden" }] as Area[];
  const tables = [
    { _id: "t1", tableNo: "T-1", areaId: "a1" },
    { _id: "t5", tableNo: "T-5", areaId: "a2" },
    { _id: "t9", tableNo: "T-9" },
    { _id: "t7", tableNo: "T-7", areaId: "gone" },
  ] as Table[];
  assert.equal(tableAreaName("T-1", tables, areas), "AC Hall", "T-1 sits in AC Hall");
  assert.equal(tableAreaName("T-5", tables, areas), "Garden", "T-5 sits in the Garden");
  assert.equal(tableAreaName("T-9", tables, areas), undefined, "an area-less table");
  assert.equal(tableAreaName("T-7", tables, areas), undefined, "an area this device does not hold");
  assert.equal(tableAreaName("T-404", tables, areas), undefined, "a table not on the floor plan");
  assert.equal(tableAreaName(undefined, tables, areas), undefined, "no table");
  assert.equal(tableAreaName("T-1", undefined, areas), undefined, "tables still loading");
  assert.equal(tableAreaName("T-1", tables, undefined), undefined, "areas still loading");
});

// ── the Void action's address in the stored order (owner Q10; VoidItemDialog's initialLine) ────────────────────────

const tab = (items: OrderItem[]): Pick<Order, "items"> => ({ items });
const fired = [
  item({ productId: "pA", name: "Latte", qty: 2, kotRound: 1 }),
  item({ productId: "pB", name: "Waffle", qty: 3, kotRound: 1, modifiers: ["Add ice cream scoop"] }),
  item({ productId: "pC", name: "Brownie", qty: 1, kotRound: 2, variation: "Large" }),
];

test("voidLineOf: a sent line of the resumed tab gives its stored position and its whole line identity", () => {
  const order = tab(fired);
  const cart: CartItem[] = order.items.map((it, i) => cartItemFromOrderItem(it, i));
  assert.deepStrictEqual(voidLineOf(cart[1], order), { index: 1, lineKey: orderLineKey(fired[1]) }, "the second sent line");
  assert.deepStrictEqual(voidLineOf(cart[2], order), { index: 2, lineKey: orderLineKey(fired[2]) }, "a variation line");
});

test("voidLineOf: a new (unsent) line, no tab, or a cart line from another order give no address", () => {
  const order = tab(fired);
  const fresh: CartItem = { lineId: "pA||", productId: "pA", name: "Latte", price: 409, qty: 1, modifiers: [], instructions: "", kotRound: 0 };
  assert.equal(voidLineOf(fresh, order), null, "an unsent line is removed, never voided");
  assert.equal(voidLineOf(cartItemFromOrderItem(fired[0], 0), null), null, "no resumed tab");
  const other = cartItemFromOrderItem(item({ productId: "pZ", kotRound: 1 }), 0);
  assert.equal(voidLineOf(other, order), null, "position 0 of this tab holds another dish");
  const beyond = cartItemFromOrderItem(fired[0], 7);
  assert.equal(voidLineOf(beyond, order), null, "a position this tab does not have");
});

test("matchVoidLine: the dialog opens on the named line only while the stored order still holds it there", () => {
  const order = tab(fired);
  const line = voidLineOf(cartItemFromOrderItem(fired[1], 1), order);
  assert.ok(line, "landmark: the cart named a line");
  assert.equal(matchVoidLine(order.items, line!), 1, "same position, same identity: preselected");
  const voided = [fired[0], { ...fired[1], qty: 2 }, fired[2]];
  assert.equal(matchVoidLine(voided, line!), null, "the line changed since (another device voided one): nothing preselected");
  const shifted = [fired[1], fired[2]];
  assert.equal(matchVoidLine(shifted, line!), null, "the trail shifted: nothing preselected");
  const unsent = [fired[0], { ...fired[1], kotRound: 0 }, fired[2]];
  assert.equal(matchVoidLine(unsent, { index: 1, lineKey: orderLineKey(unsent[1]) }), null, "an unsent line is never voided");
});

// ── line selection (owner Q10) ─────────────────────────────────────────────────────────────────────────────────────

test("selectionHolds: one selected line, kept only while it is on screen, in the same order, and the cart is idle", () => {
  const sel = { lineId: "#1:pB", scope: "tab-1" };
  const ids = ["#0:pA", "#1:pB", "pC"];
  assert.equal(selectionHolds(sel, { scope: "tab-1", busy: false, lineIds: ids }), true, "still there, idle: kept");
  assert.equal(selectionHolds(sel, { scope: "tab-1", busy: true, lineIds: ids }), false, "busy or frozen: cleared");
  assert.equal(selectionHolds(sel, { scope: "tab-2", busy: false, lineIds: ids }), false, "another tab resumed: cleared");
  assert.equal(selectionHolds(sel, { scope: "new", busy: false, lineIds: ids }), false, "the tab closed (a new order): cleared");
  assert.equal(selectionHolds(sel, { scope: "tab-1", busy: false, lineIds: ["#0:pA", "pC"] }), false, "the line went: cleared");
});
