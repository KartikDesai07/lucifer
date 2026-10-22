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
  BILL_OPEN_MIN_HEIGHT_PX,
  billDetailsOpen,
  billToggleHolds,
  billToggleStep,
  cartTitle,
  emptiedSheetStart,
  emptiedSheetStep,
  focusIndexAfterRemove,
  lineMeta,
  lineNumber,
  matchVoidLine,
  orderBarSummary,
  selectionHolds,
  tabMeta,
  tableAreaName,
  tableCellValue,
  voidLineOf,
  type BillToggleState,
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

// ── the order bar below 1280px (values 6.1; design 6.9; owner Q18; U1 Task 7) ────────────────────────────────────────

test("orderBarSummary: \"{n} item(s) · {title}\" (one item says 1 item), the HTML's line with our title", () => {
  const view = { title: "Table T-4", adjustment: false, noticeTitle: null };
  assert.equal(orderBarSummary({ ...view, count: 5 }), "5 items · Table T-4", "the HTML's \"5 items · Table 4\" with our title");
  assert.equal(orderBarSummary({ ...view, count: 1 }), "1 item · Table T-4", "singular for one (global constraints: never \"1 items\")");
  assert.equal(orderBarSummary({ ...view, count: 2, title: "New order" }), "2 items · New order", "a new order's title");
  assert.equal(orderBarSummary({ ...view, count: 3, title: "Walk-In" }), "3 items · Walk-In", "a walk-in tab's title");
});

test("orderBarSummary: an empty order still has its bar (owner Q18): \"No items · New order\"", () => {
  const empty = { count: 0, adjustment: false, noticeTitle: null };
  assert.equal(orderBarSummary({ ...empty, title: "New order" }), "No items · New order", "design 6.9: the empty new order's words");
  assert.equal(orderBarSummary({ ...empty, title: "Table T-2" }), "No items · Table T-2", "a tab with nothing left on it names itself too");
});

test("orderBarSummary: an adjustment that survived Clear, and an unanswered send, say so in our words (design 6.9)", () => {
  assert.equal(
    orderBarSummary({ count: 0, title: "New order", adjustment: true, noticeTitle: null }),
    "Adjustment still applied",
    "D9.8c: no items but a promo / reward / discount / extra charge is still set",
  );
  assert.equal(
    orderBarSummary({ count: 0, title: "New order", adjustment: true, noticeTitle: "Couldn't confirm" }),
    "Couldn't confirm",
    "an unanswered send outranks everything: it must be seen with the sheet closed",
  );
  assert.equal(
    orderBarSummary({ count: 4, title: "New order", adjustment: false, noticeTitle: "Couldn't confirm" }),
    "Couldn't confirm",
    "also with items on the order",
  );
  assert.equal(
    orderBarSummary({ count: 2, title: "New order", adjustment: true, noticeTitle: null }),
    "2 items · New order",
    "with items the count says enough (the adjustment shows on its footer link)",
  );
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

// U1 final fix wave (the Task 4 review's FIX BEFORE MERGE): after "Remove" the action row unmounts with its line, and
// the keyboard focus fell to <body>; it now moves to the next line's name, else the previous one's, else the cart.
test("focusIndexAfterRemove: the next line (it takes the removed one's place), else the previous, else none", () => {
  assert.equal(focusIndexAfterRemove(0, 2), 0, "the first of three removed: the next line is now first");
  assert.equal(focusIndexAfterRemove(1, 2), 1, "a middle line removed: the next line moved up into its place");
  assert.equal(focusIndexAfterRemove(2, 2), 1, "the last line removed: the previous one");
  assert.equal(focusIndexAfterRemove(0, 0), null, "the only line removed: no line is left (the cart's first control)");
  assert.equal(focusIndexAfterRemove(5, 3), 2, "an index past the end (lines shifted meanwhile): the last line");
});

// ── the bill's details (owner Q12; ruling P16) ────────────────────────────────────────────────────────────────────

test("billDetailsOpen: the user's own toggle wins; until then the HTML's 820px rule, and open while the table charge is waived or changed", () => {
  assert.equal(BILL_OPEN_MIN_HEIGHT_PX, 820, "values 0.4: billOpen = s.billOpen ?? (s.h >= 820)");
  assert.equal(billDetailsOpen({ toggled: null, windowHeight: 820, chargeAdjusted: false }), true, "an 820px-tall window: open");
  assert.equal(billDetailsOpen({ toggled: null, windowHeight: 819, chargeAdjusted: false }), false, "shorter: closed");
  assert.equal(
    billDetailsOpen({ toggled: null, windowHeight: 700, chargeAdjusted: true }),
    true,
    "P16: a waived or changed table charge shows by itself (a waiver never rides unseen onto the next customer)",
  );
  assert.equal(billDetailsOpen({ toggled: false, windowHeight: 900, chargeAdjusted: true }), false, "the user hid the details: they stay hidden");
  assert.equal(billDetailsOpen({ toggled: true, windowHeight: 600, chargeAdjusted: false }), true, "the user opened them: they stay open");
});

// Ruling P51 (U1 audit wave, report M-2): the column from 1280px stays mounted from order to order, so a "Hide details"
// made on one order hid the next order's "waived · Undo" table-charge row (D9.8). The choice holds for its order only.
test("billToggleHolds (ruling P51): the details choice holds for the order on screen only — another order or an emptied cart drops it", () => {
  const hid = { open: false, scope: "tab-1" };
  assert.equal(billToggleHolds(hid, { scope: "tab-1", emptied: false }), true, "the same order: the choice wins (P16)");
  assert.equal(billToggleHolds(hid, { scope: "tab-2", emptied: false }), false, "another tab resumed: back to not chosen");
  assert.equal(billToggleHolds(hid, { scope: "new", emptied: false }), false, "the tab closed or settled (a new order): back to not chosen");
  assert.equal(billToggleHolds(hid, { scope: "tab-1", emptied: true }), false, "the cart just emptied: back to not chosen");
  const fresh = { open: true, scope: "new" };
  assert.equal(billToggleHolds(fresh, { scope: "new", emptied: false }), true, "a new order keeps its own choice");
  assert.equal(billToggleHolds(fresh, { scope: "new", emptied: true }), false, "a new order cleared, paid or sent: the next order starts unchosen");
});

// Review M-1 (U1 audit fix round): the choice is CartBill's render-time state, so its rule is tested as CartBill runs it —
// billToggleStep folded over a sequence of renders, with the operator's taps in between.
type BillRender = { scope: string; count: number; tap?: boolean };
/** CartBill over a sequence of renders: each render steps the state (as its render-time update does); a tap stores the
 *  opposite of what shows, with the order on screen (as its onClick does). Returns the choice after each render. */
function billRenders(renders: BillRender[], shown = true): Array<boolean | null> {
  let state: BillToggleState = { toggle: null, hadItems: renders[0].count > 0 };
  return renders.map((r) => {
    state = billToggleStep(state, { scope: r.scope, count: r.count });
    if (r.tap) state = { toggle: { open: !(state.toggle?.open ?? shown), scope: r.scope }, hadItems: r.count > 0 };
    return state.toggle?.open ?? null;
  });
}

test("billToggleStep over renders (ruling P51): the choice holds within one order through line changes, drops on another order or an emptied cart", () => {
  assert.deepEqual(
    billRenders([
      { scope: "tab-1", count: 2, tap: true },
      { scope: "tab-1", count: 3 },
      { scope: "tab-1", count: 1 },
      { scope: "tab-1", count: 1 },
    ]),
    [false, false, false, false],
    "Hide details on a tab holds while lines are added and removed, and through plain re-renders (P16)",
  );
  assert.deepEqual(
    billRenders([
      { scope: "tab-1", count: 2, tap: true },
      { scope: "tab-2", count: 4 },
      { scope: "tab-2", count: 4 },
    ]),
    [false, null, null],
    "another tab resumed: back to not chosen, and it stays so",
  );
  assert.deepEqual(
    billRenders([
      { scope: "tab-1", count: 2, tap: true },
      { scope: "new", count: 0 },
    ]),
    [false, null],
    "the tab settled or closed (a new, empty order): not chosen",
  );
  assert.deepEqual(
    billRenders([
      { scope: "new", count: 2, tap: true },
      { scope: "new", count: 0 },
      { scope: "new", count: 1 },
    ]),
    [false, null, null],
    "a new order cleared, paid or sent (the same scope, the count from some to none): the next order starts unchosen",
  );
  assert.deepEqual(
    billRenders([
      { scope: "new", count: 0, tap: true },
      { scope: "new", count: 0 },
      { scope: "new", count: 2 },
      { scope: "new", count: 2 },
    ]),
    [false, false, false, false],
    "a choice made on an empty order (owner Q18's working place) holds while it stays empty and as items come",
  );
  const settled: BillToggleState = { toggle: { open: true, scope: "tab-1" }, hadItems: true };
  assert.equal(billToggleStep(settled, { scope: "tab-1", count: 5 }), settled, "nothing changed: the same object (no render loop)");
});

// ── the cart sheet's own close (rulings P50, P55) ──────────────────────────────────────────────────────────────────

// Ruling P50 (U1 audit wave, report M-1): owner Q18 made the empty sheet a working place, so the close follows the order
// being emptied, not "empty right now". Ruling P55 (the fix round, review I-1): the hook compared one render with the
// last, so a stamp reward auto-armed on the order (hooks/use-customer-rewards.ts), which lets go one render after the
// items, left the sheet open over an empty order; the rule is now a small state machine, tested over render sequences.
type SheetRender = [count: number, pendingAdjustment: boolean, open?: boolean];
/** The hook over a sequence of renders: it starts from the first render's figures, then steps once per later render
 *  (the effect runs when its inputs change; a repeat is harmless, case f). Returns, per later render, whether it closed;
 *  a close flips `open` for the following renders, as setOpen(false) does. */
function sheetRenders(renders: SheetRender[]): boolean[] {
  let open = renders[0][2] ?? true;
  let state = emptiedSheetStart({ count: renders[0][0], open });
  return renders.slice(1).map(([count, pendingAdjustment, openNow]) => {
    if (openNow !== undefined) open = openNow;
    const step = emptiedSheetStep(state, { count, pendingAdjustment, open });
    state = step.state;
    if (step.close) open = false;
    return step.close;
  });
}

test("emptiedSheetStep over renders (rulings P50, P55): the emptied sheet closes once no adjustment is left; an empty sheet opened as such never does", () => {
  assert.deepEqual(sheetRenders([[2, false], [0, true], [0, false]]), [false, true], "(a) Clear lets an auto-armed stamp reward go a render later: closes then (review I-1)");
  assert.deepEqual(sheetRenders([[2, false], [0, false]]), [true], "(b) Clear with nothing applied: closes at once (main's)");
  assert.deepEqual(
    sheetRenders([[0, false, false], [0, false, true], [0, true], [0, false]]),
    [false, false, false],
    "(c) the empty sheet opened on an empty order, an extra charge added then removed: never closes (owner Q18)",
  );
  assert.deepEqual(sheetRenders([[1, true], [0, true], [0, false]]), [false, true], "(d) the last item removed while a discount survives, then the discount removed: closes then (as main)");
  assert.deepEqual(
    sheetRenders([[1, false], [0, true], [1, true], [1, false]]),
    [false, false, false],
    "(e) items come back before the adjustment settles: never closes",
  );
  assert.deepEqual(sheetRenders([[2, false], [2, false], [2, false]]), [false, false], "(f) repeated figures from the start never close");
  assert.deepEqual(sheetRenders([[2, false], [0, false], [0, false, true], [0, false]]), [true, false, false], "(f) after a close the same figures never close again, even once the sheet is reopened");
  // The first render never closes: the start state has nothing emptied, whatever the figures.
  assert.deepEqual(emptiedSheetStart({ count: 0, open: true }), { count: 0, open: true, emptied: false }, "(f) the start state");
  assert.equal(emptiedSheetStep(emptiedSheetStart({ count: 0, open: true }), { count: 0, pendingAdjustment: false, open: true }).close, false, "(f) a StrictMode repeat of the first render does not close");
  // The sheet closed, or reopened, after it was emptied: "emptied" is forgotten.
  assert.deepEqual(sheetRenders([[2, false], [0, true], [0, true, false], [0, true, true], [0, false]]), [false, false, false, false], "closed and reopened while the discount survives, then it is removed: the reopened empty sheet stays (owner Q18)");
  assert.deepEqual(sheetRenders([[2, false, false], [0, false, false]]), [false], "emptied while the sheet is shut (the column from 1280px): nothing to close");
});
