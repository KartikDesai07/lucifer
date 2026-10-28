// U2 Task 4 (2026-10-23): the Orders list's words as a pure model (docs/superpowers/specs/2026-10-23-orders-match-html-design.md
// 6.4 list head / rows, 6.5 empty, Q9, Q10, Q11; docs/superpowers/specs/2026-10-22-orders-html-values.md 0.1 clock, 7 list
// head, 8 table, 9 cards, 10.1 status, 13 empty). Pure pins on lib/orders-row.ts: a row's title, number, status pill, age,
// items, the whole row view, the list head and the empty words; the dashboard's code tile moved here (recentOrderCode,
// same output). The list as drawn and the page's wiring: orders-list-view.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";

import { SELF_ORDER_SOURCE } from "@pos/shared/public";
import {
  emptyText,
  itemsSummary,
  listHead,
  orderAge,
  orderNumber,
  orderRowView,
  orderStatus,
  orderTitle,
  recentOrderCode,
} from "./orders-row";
import { NOW, minutesBefore, order, printed, settled } from "./orders-lanes.fixtures";
import type { OrdersDate } from "./orders-lanes";

const line = (name: string, qty = 1) => ({ productId: name, name, price: 100, qty, modifiers: [], instructions: "", kotRound: 1 });

// ── A row's words ─────────────────────────────────────────────────────────────────────────────────────────────────

test("orderTitle: Takeaway, else the table ('Table T-4', a QR order at a table too), else 'QR order', else 'Walk-In' (our words, as U1's tabs)", () => {
  assert.equal(orderTitle(order("1", { tableNo: "T-4" })), "Table T-4", "a table");
  assert.equal(orderTitle(order("2", { parcel: true, tableNo: "T-4" })), "Takeaway", "a takeaway, even with a table");
  assert.equal(orderTitle(order("3", { source: SELF_ORDER_SOURCE, tableNo: "T-2" })), "Table T-2", "a QR order at a table");
  assert.equal(orderTitle(order("4", { source: SELF_ORDER_SOURCE })), "QR order", "a QR order with no table");
  assert.equal(orderTitle(order("5")), "Walk-In", "a walk-in at the counter");
});

test("orderNumber: '#' + the order id's last segment (the day number)", () => {
  assert.equal(orderNumber(order("014")), "#014", "ORD-20261019-014 -> #014");
  assert.equal(orderNumber(order("x", { orderId: "ORD-20261019-1036" })), "#1036", "four digits");
  assert.equal(orderNumber(order("y", { orderId: "LEGACY" })), "#LEGACY", "an id with no dash reads whole");
});

test("orderStatus: Bill printed / In kitchen for an open tab (Q11), Due for any bill with money owed (Q3, Q9), Paid · {mode}, Cancelled", () => {
  assert.deepEqual(orderStatus(printed("1")), { label: "Bill printed", kind: "bill" }, "an open tab whose bill printed for its total");
  assert.deepEqual(orderStatus(order("2")), { label: "In kitchen", kind: "info" }, "an open tab with no printed bill");
  assert.deepEqual(
    orderStatus(order("3", { billFirstPrintedAt: minutesBefore(3), billFirstPrintedTotal: 50 })),
    { label: "In kitchen", kind: "info" },
    "a bill printed for an older total is no longer printed (billPrintedNow)",
  );
  assert.deepEqual(orderStatus(settled("4", 500, 0, "Credit")), { label: "Due", kind: "bill" }, "a Credit bill owes its total");
  assert.deepEqual(orderStatus(settled("5", 500, 400, "Cash")), { label: "Due", kind: "bill" }, "a short Cash payment owes the rest");
  assert.deepEqual(orderStatus(settled("6", 500, 0, "Due")), { label: "Due", kind: "bill" }, "a Due-mode bill");
  assert.deepEqual(orderStatus(settled("7", 500, 500, "Split")), { label: "Paid · Split", kind: "ok" }, "a split paid in full");
  assert.deepEqual(orderStatus(settled("8", 500, 500, "Cash")), { label: "Paid · Cash", kind: "ok" }, "cash");
  assert.deepEqual(orderStatus(settled("9", 500, 500, "Online")), { label: "Paid · Online", kind: "ok" }, "online");
  assert.deepEqual(orderStatus(order("10", { status: "Cancelled", payment: "Cash" })), { label: "Cancelled", kind: "bad" }, "cancelled");
});

test("orderAge: an open tab 'Open {m} min' / 'Open {h}h {m}m' (m = max(1, round)), --warn-i from 30, --bad-i from 60; else 'Today' and the clock, or '17 Oct' twice (Ruling P18)", () => {
  const openAt = (m: number) => orderAge(order("1", { createdAt: minutesBefore(m) }), NOW);
  assert.deepEqual(openAt(0.2), { text: "Open 1 min", short: "1 min", tone: "plain" }, "never under a minute");
  assert.deepEqual(openAt(1), { text: "Open 1 min", short: "1 min", tone: "plain" }, "1 minute");
  assert.deepEqual(openAt(29.4), { text: "Open 29 min", short: "29 min", tone: "plain" }, "29.4 rounds down: still plain");
  assert.deepEqual(openAt(29.6), { text: "Open 30 min", short: "30 min", tone: "warn" }, "29.6 rounds to 30: warn (the HTML rounds first)");
  assert.deepEqual(openAt(30), { text: "Open 30 min", short: "30 min", tone: "warn" }, "30 minutes: warn");
  assert.deepEqual(openAt(59), { text: "Open 59 min", short: "59 min", tone: "warn" }, "59 minutes: still warn");
  assert.deepEqual(openAt(60), { text: "Open 1h 0m", short: "1h 0m", tone: "bad" }, "an hour: bad");
  assert.deepEqual(openAt(61), { text: "Open 1h 1m", short: "1h 1m", tone: "bad" }, "61 minutes");
  assert.deepEqual(openAt(68), { text: "Open 1h 8m", short: "1h 8m", tone: "bad" }, "the HTML's Table 1");
  const today = orderAge(settled("2", 500, 500), NOW);
  assert.deepEqual(today, { text: "Today", short: "9:25 PM", tone: "plain" }, "a settled bill of today: 'Today' and its clock time (IST)");
  // Ruling P18 (the verification fix, V-B; moved on purpose): the card's line of a closed row from another day is its day,
  // as the table row's (the HTML's seed holds only today's bills; ours lists older ones over All dates / a picked day).
  const older = orderAge({ ...settled("3", 500, 500), createdAt: "2026-10-17T14:46:00.000Z" }, NOW);
  assert.deepEqual(older, { text: "17 Oct", short: "17 Oct", tone: "plain" }, "an older day: '17 Oct' on the table row and on the card");
  const lastNight = orderAge({ ...settled("4", 500, 500), createdAt: "2026-10-18T18:29:00.000Z" }, NOW);
  assert.equal(lastNight.text, "18 Oct", "11:59 PM IST of the day before is not today (the cafe's midnight)");
  assert.equal(lastNight.short, "18 Oct", "and its card reads the day too");
  const justAfterMidnight = orderAge({ ...settled("5", 500, 500), createdAt: "2026-10-18T18:31:00.000Z" }, NOW);
  assert.deepEqual(justAfterMidnight, { text: "Today", short: "12:01 AM", tone: "plain" }, "12:01 AM IST is today");
  const cancelled = orderAge(order("6", { status: "Cancelled", createdAt: minutesBefore(90) }), NOW);
  assert.deepEqual(cancelled, { text: "Today", short: "8:00 PM", tone: "plain" }, "a cancelled order with no cancel time falls back to its opening");
});

// Ruling P8 (2026-10-23): a cancelled row shows its cancel time (the HTML's closed rows show the cancel time, values
// 10.3), falling back to createdAt; settled rows keep createdAt.
test("orderAge / orderRowView (Ruling P8): a cancelled row's time and card age are its cancelledAt; settled rows keep createdAt", () => {
  const cancelled = order("7", { status: "Cancelled", createdAt: minutesBefore(90), cancelledAt: minutesBefore(10) });
  assert.deepEqual(orderAge(cancelled, NOW), { text: "Today", short: "9:20 PM", tone: "plain" }, "the card's age: the cancel time");
  assert.equal(orderRowView(cancelled, NOW).time, "9:20 PM", "the table row's time: the cancel time");
  const overnight = order("8", { status: "Cancelled", createdAt: "2026-10-18T16:30:00.000Z", cancelledAt: minutesBefore(30) });
  assert.deepEqual(orderAge(overnight, NOW), { text: "Today", short: "9:00 PM", tone: "plain" }, "opened yesterday, cancelled today: Today and the cancel time");
  const noStamp = order("9", { status: "Cancelled", createdAt: minutesBefore(45) });
  assert.equal(orderRowView(noStamp, NOW).time, "8:45 PM", "no cancelledAt: the opening time");
  const paid = { ...settled("10", 500, 500), createdAt: minutesBefore(20) };
  assert.equal(orderRowView(paid, NOW).time, "9:10 PM", "a settled row keeps createdAt");
  assert.equal(orderAge(paid, NOW).short, "9:10 PM", "and so does its card age");
  // Ruling P18: the day is rowInstant's — a cancel of another day reads that day, even for an order opened before it.
  const cancelledYesterday = order("11", { status: "Cancelled", createdAt: "2026-10-17T14:46:00.000Z", cancelledAt: "2026-10-18T12:00:00.000Z" });
  assert.deepEqual(orderAge(cancelledYesterday, NOW), { text: "18 Oct", short: "18 Oct", tone: "plain" }, "cancelled yesterday: its cancel day on the row and the card");
  assert.equal(orderRowView(cancelledYesterday, NOW).time, "5:30 PM", "the table row's time stays the cancel clock");
});

test("itemsSummary: '{qty}× {first item}' + ' +{n} more' (the HTML's), '—' for none", () => {
  assert.equal(itemsSummary(order("1", { items: [line("Chicken Zinger", 2)] })), "2× Chicken Zinger", "one line of 2");
  assert.equal(
    itemsSummary(order("2", { items: [line("Butter Chicken"), line("Garlic Naan", 3), line("Cold Coffee", 2)] })),
    "1× Butter Chicken +2 more",
    "three lines",
  );
  assert.equal(itemsSummary(order("3", { items: [] })), "—", "no line");
});

// ── The row view ──────────────────────────────────────────────────────────────────────────────────────────────────

test("orderRowView: an open tab at a table with a printed bill and a token (the HTML's Table 1 row, our words)", () => {
  const v = orderRowView(
    printed("014", { tableNo: "T-4", total: 1063, tokenNumber: 12, createdAt: minutesBefore(68), items: [line("Butter Chicken"), line("Naan", 2), line("Lassi")] }),
    NOW,
  );
  assert.equal(v.key, "014", "the row key is the order's _id");
  assert.equal(v.code, "T4", "the code tile (recentOrderCode)");
  assert.equal(v.codeTone, "bill", "a billed open tab's tile in the bill tint");
  assert.equal(v.title, "Table T-4", "the title");
  assert.equal(v.number, "#014", "the number");
  assert.equal(v.sub, "#014 · Dine-in · Token 12", "number · channel word · Token n");
  assert.equal(v.customer, "Walk-in", "no customer: Walk-in");
  assert.equal(v.customerSub, "No customer added", "the HTML's words under a walk-in");
  assert.equal(v.items, "1× Butter Chicken +2 more", "the items");
  assert.equal(v.time, "8:22 PM", "the clock time it was opened (IST)");
  assert.deepEqual(v.age, { text: "Open 1h 8m", short: "1h 8m", tone: "bad" }, "its age");
  assert.deepEqual(v.status, { label: "Bill printed", kind: "bill" }, "its pill");
  assert.equal(v.amount, "₹1,063", "the amount");
  assert.equal(v.struck, false, "not struck");
  assert.equal(v.dueText, null, "an open tab owes nothing yet");
  assert.equal(v.settle, true, "an open tab has the row's Settle");
});

test("orderRowView: a named customer has no second line; a due bill reads '₹x due'; a cancelled order is struck; settled rows have no Settle", () => {
  const walkIn = orderRowView(settled("2", 954, 0, "Due"), NOW);
  assert.equal(walkIn.customer, "Walk-in", "a settled walk-in reads Walk-in too");
  const v =orderRowView({ ...settled("3", 954, 0, "Due"), customerId: "c1", customerName: "Priya Sharma", tableNo: "T-9" }, NOW);
  assert.equal(v.customer, "Priya Sharma", "a named customer");
  assert.equal(v.customerSub, null, "no phone or visits in a row: no second line (design 6.4)");
  assert.equal(v.dueText, "₹954 due", "the money owed (orderDue)");
  assert.equal(v.codeTone, "plain", "a settled bill's tile is plain");
  assert.equal(v.settle, false, "no Settle on a settled bill (no Collect either, design 6.4)");
  const c = orderRowView(order("004", { status: "Cancelled", total: 768, parcel: true }), NOW);
  assert.equal(c.struck, true, "a cancelled order's amount is struck");
  assert.equal(c.settle, false, "no Settle on a cancelled order");
  assert.equal(c.dueText, null, "a cancelled order owes nothing");
  assert.equal(c.code, "TA", "a takeaway's tile");
  assert.equal(c.sub, "#004 · Takeaway", "no token: no token part");
  const qr = orderRowView(order("005", { source: SELF_ORDER_SOURCE }), NOW);
  assert.equal(qr.sub, "#005 · QR self-order", "the QR channel word");
  assert.equal(orderRowView(order("006"), NOW).sub, "#006 · Counter", "a walk-in at the counter");
});

test("recentOrderCode lives in lib/orders-row.ts now, same output (the dashboard and the Orders rows share it)", () => {
  assert.equal(recentOrderCode(order("1", { tableNo: "T-12" })), "T12", "T + the first digit run");
  assert.equal(recentOrderCode(order("2", { tableNo: "Rooftop-12" })), "T12", "a long table name");
  assert.equal(recentOrderCode(order("3", { tableNo: "Garden" })), "GA", "no digits: two letters");
  assert.equal(recentOrderCode(order("4", { parcel: true, tableNo: "T-4" })), "TA", "takeaway");
  assert.equal(recentOrderCode(order("5", { source: SELF_ORDER_SOURCE, tableNo: "T-4" })), "QR", "QR");
  assert.equal(recentOrderCode(order("6")), "WI", "walk-in");
});

// ── The list head and the empty words ─────────────────────────────────────────────────────────────────────────────

test("listHead: '{n} {lane} orders' ('{n}+' while more can be loaded), '{n} matches in all orders' while searching; the sort words; the Due note", () => {
  assert.deepEqual(
    listHead("open", 8, false, false),
    { count: "8", scope: "open orders", left: "8 open orders", right: "Bills printed first, then oldest", dueNote: false },
    "the HTML's first view",
  );
  assert.deepEqual(listHead("paid", 12, true, false), { count: "12+", scope: "paid orders", left: "12+ paid orders", right: "Newest first", dueNote: false }, "more to load");
  assert.deepEqual(listHead("open", 1, false, true), { count: "1", scope: "match in all orders", left: "1 match in all orders", right: "Newest first", dueNote: false }, "one match");
  assert.deepEqual(listHead("paid", 4, false, true), { count: "4", scope: "matches in all orders", left: "4 matches in all orders", right: "Newest first", dueNote: false }, "matches");
  assert.equal(listHead("cancelled", 1, true, true).left, "1+ matches in all orders", "'1+' reads plural");
  assert.deepEqual(listHead("due", 1, false, false), { count: "1", scope: "due order", left: "1 due order", right: "Newest first", dueNote: true }, "Due: singular, the note (Q9)");
  assert.equal(listHead("due", 0, false, false).left, "0 due orders", "zero is plural");
  assert.equal(listHead("due", 3, false, true).dueNote, false, "no Due note while searching (the lane is set aside)");
  assert.equal(listHead("cancelled", 2, false, false).left, "2 cancelled orders", "cancelled");
  assert.equal(listHead("all", 3, false, false).left, "3 orders", "All: plain 'orders'");
  assert.equal(listHead("all", 1, false, false).left, "1 order", "All: one order");
});

const TODAY: OrdersDate = { kind: "today" };
const base = { lane: "open" as const, searching: "", filtersOn: false, more: false, loaded: 0, date: TODAY };

test("emptyText: searching, then filters, then Q10's sparse Paid / Due page, then 'No {lane} orders {when}' (design 6.5)", () => {
  assert.deepEqual(
    emptyText({ ...base, searching: "98765", filtersOn: true }),
    { title: "No orders match “98765”", text: "Try another phone number." },
    "a phone matches nothing (our search is phone only)",
  );
  assert.deepEqual(
    emptyText({ ...base, lane: "due", filtersOn: true, more: true, loaded: 50 }),
    { title: "No orders match these filters", text: "Remove a filter to see more." },
    "a filter on",
  );
  assert.deepEqual(
    emptyText({ ...base, lane: "due", more: true, loaded: 50 }),
    { title: "No due bills in the latest 50 settled orders", text: "Load more to check older ones." },
    "Q10: Due with more settled orders to load",
  );
  assert.deepEqual(
    emptyText({ ...base, lane: "paid", more: true, loaded: 100 }),
    { title: "No paid bills in the latest 100 settled orders", text: "Load more to check older ones." },
    "Q10: Paid after one Load more",
  );
  const plain = (lane: (typeof base)["lane"] | "all" | "paid" | "due" | "cancelled", date: OrdersDate = TODAY, more = false) =>
    emptyText({ ...base, lane, date, more, loaded: 7 });
  assert.deepEqual(plain("due"), { title: "No due orders today", text: "They will show up here as they happen." }, "Due, nothing more to load");
  assert.equal(plain("all").title, "No orders today", "All");
  assert.equal(plain("open").title, "No open orders today", "Open");
  assert.equal(plain("open", TODAY, true).title, "No open orders today", "more to load on Open is not Q10's case");
  assert.equal(plain("cancelled", { kind: "yesterday" }).title, "No cancelled orders yesterday", "yesterday");
  assert.equal(plain("paid", { kind: "day", date: "2026-10-14" }).title, "No paid orders on 14 Oct", "a picked day");
  assert.equal(plain("cancelled", { kind: "all" }).title, "No cancelled orders yet", "All dates: 'yet', never a trailing space");
});

// Ruling P5 (2026-10-23): only the payment and the table are "filters"; the date never counts (not the phone's date
// chip, not the desktop box), and the Open lane, which ignores the date, always says "today".
test("emptyText (Ruling P5): a date-only state on the phone reads the lane's date words as on desktop; Open always says today", () => {
  assert.deepEqual(
    emptyText({ ...base, lane: "paid", date: { kind: "yesterday" }, filtersOn: false, loaded: 3 }),
    { title: "No paid orders yesterday", text: "They will show up here as they happen." },
    "the phone with only its Yesterday chip: the page sends filtersOn false (the date is no filter), the lane's words",
  );
  assert.deepEqual(
    emptyText({ ...base, lane: "open", date: { kind: "yesterday" } }),
    { title: "No open orders today", text: "They will show up here as they happen." },
    "Open with Yesterday chosen: the lane ignores the date, so its words say today",
  );
  assert.equal(emptyText({ ...base, lane: "open", date: { kind: "all" } }).title, "No open orders today", "Open with All dates");
  assert.equal(emptyText({ ...base, lane: "open", date: { kind: "day", date: "2026-10-14" } }).title, "No open orders today", "Open with a picked day");
  assert.equal(emptyText({ ...base, lane: "all", date: { kind: "yesterday" } }).title, "No orders yesterday", "other lanes keep the date words");
});
