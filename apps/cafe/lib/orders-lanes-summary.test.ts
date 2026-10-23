// U2 Task 2 (2026-10-23): the chosen lane's numbers and line (owner Q1, Q9, Q10;
// docs/superpowers/specs/2026-10-23-orders-match-html-design.md 6.2): lib/orders-lanes.ts laneSummary and dateWhen, for
// every lane with 0 / 1 / 2 rows, with more to load ("50+", "0+": Review Focus 3) and each date's words.
import { test } from "node:test";
import assert from "node:assert/strict";

import { dateWhen, laneSummary, type OrdersDate } from "./orders-lanes";
import { NOW, minutesBefore, order, printed, settled } from "./orders-lanes.fixtures";

// ── The chosen lane's numbers (owner Q1, Q9, Q10; design 6.2) ─────────────────────────────────────────────────────

test("dateWhen: the words after 'No payments' / 'None' / 'No orders'", () => {
  assert.equal(dateWhen({ kind: "today" }), "today", "Today");
  assert.equal(dateWhen({ kind: "yesterday" }), "yesterday", "Yesterday");
  assert.equal(dateWhen({ kind: "day", date: "2026-10-22" }), "on 22 Oct", "a picked day");
  assert.equal(dateWhen({ kind: "day", date: "2026-09-05" }), "on 5 Sep", "day without a leading zero");
  assert.equal(dateWhen({ kind: "all" }), "yet", "All dates (the HTML's trailing-space slip not copied)");
});

test("laneSummary Open: bills waiting (warn), else tabs open 30+ min (warn), else All in service", () => {
  const today = { kind: "today" } as const;
  assert.deepEqual(laneSummary("open", [], false, today, NOW), { count: "0", amount: "₹0", line: "All in service", tone: "plain" }, "no tab");
  assert.deepEqual(
    laneSummary("open", [printed("1", { total: 1063 })], false, today, NOW),
    { count: "1", amount: "₹1,063", line: "1 bill waiting to be paid", tone: "warn" },
    "one printed bill",
  );
  assert.deepEqual(
    laneSummary("open", [printed("1", { total: 1063 }), printed("2", { total: 767 }), order("3", { total: 768 })], false, today, NOW),
    { count: "3", amount: "₹2,598", line: "2 bills waiting to be paid", tone: "warn" },
    "two printed bills",
  );
  assert.deepEqual(
    laneSummary("open", [order("1", { createdAt: minutesBefore(32) }), order("2", { createdAt: minutesBefore(68) }), order("3")], false, today, NOW),
    { count: "3", amount: "₹300", line: "2 open 30+ min", tone: "warn" },
    "two tabs open 30 minutes or more",
  );
  assert.equal(
    laneSummary("open", [order("1", { createdAt: minutesBefore(29.4) })], false, today, NOW).line,
    "All in service",
    "29.4 minutes rounds to 29: not late",
  );
  assert.equal(
    laneSummary("open", [order("1", { createdAt: minutesBefore(29.6) })], false, today, NOW).line,
    "1 open 30+ min",
    "29.6 minutes rounds to 30 (the HTML's round): late",
  );
  const many = Array.from({ length: 50 }, (_, i) => order(String(i), { total: 100 }));
  const more = laneSummary("open", many, true, today, NOW);
  assert.equal(more.count, "50+", "more to load: the count reads 50+");
  assert.equal(more.amount, "₹5,000+", "more to load: the total reads ₹x+");
});

test("laneSummary Paid: Avg per bill, or No payments {when}", () => {
  assert.deepEqual(
    laneSummary("paid", [settled("1", 879, 879)], false, { kind: "today" }, NOW),
    { count: "1", amount: "₹879", line: "Avg ₹879 per bill", tone: "plain" },
    "one bill",
  );
  assert.deepEqual(
    laneSummary("paid", [settled("1", 879, 879), settled("2", 1019, 1019)], false, { kind: "today" }, NOW),
    { count: "2", amount: "₹1,898", line: "Avg ₹949 per bill", tone: "plain" },
    "two bills",
  );
  const none = (date: OrdersDate) => laneSummary("paid", [], false, date, NOW);
  assert.deepEqual(none({ kind: "today" }), { count: "0", amount: "₹0", line: "No payments today", tone: "plain" }, "none today");
  assert.equal(none({ kind: "yesterday" }).line, "No payments yesterday", "none yesterday");
  assert.equal(none({ kind: "day", date: "2026-10-22" }).line, "No payments on 22 Oct", "none on a picked day");
  assert.equal(none({ kind: "all" }).line, "No payments yet", "none on All dates");
  const sparse = laneSummary("paid", [], true, { kind: "today" }, NOW);
  assert.equal(sparse.count, "0+", "Review Focus 3: a page with no paid bill and more to load reads 0+");
  assert.equal(sparse.amount, "₹0+", "and its total ₹0+");
  const fifty = laneSummary("paid", Array.from({ length: 50 }, (_, i) => settled(String(i), 100, 100)), true, { kind: "today" }, NOW);
  assert.equal(fifty.count, "50+", "50 loaded and more: 50+");
});

test("laneSummary Due: Unpaid at billing (bill, owner Q9) with the money owed, or Nothing to collect", () => {
  assert.deepEqual(
    laneSummary("due", [], false, { kind: "today" }, NOW),
    { count: "0", amount: "₹0", line: "Nothing to collect", tone: "plain" },
    "nothing owed",
  );
  assert.deepEqual(
    laneSummary("due", [settled("1", 954, 0, "Due")], false, { kind: "today" }, NOW),
    { count: "1", amount: "₹954", line: "Unpaid at billing", tone: "bill" },
    "one due bill",
  );
  assert.deepEqual(
    laneSummary("due", [settled("1", 954, 0, "Due"), settled("2", 500, 300)], false, { kind: "today" }, NOW),
    { count: "2", amount: "₹1,154", line: "Unpaid at billing", tone: "bill" },
    "the amount is the money owed, not the bills' totals",
  );
  const sparse = laneSummary("due", [], true, { kind: "today" }, NOW);
  assert.equal(sparse.count, "0+", "Review Focus 3: no due bill in the loaded page, more to load: 0+");
  assert.equal(sparse.amount, "₹0+", "₹0+");
  assert.equal(sparse.line, "Nothing to collect", "the line for an empty Due lane");
});

test("laneSummary Cancelled: Not charged, or None {when}", () => {
  assert.deepEqual(
    laneSummary("cancelled", [order("1", { status: "Cancelled", total: 439 })], false, { kind: "today" }, NOW),
    { count: "1", amount: "₹439", line: "Not charged", tone: "plain" },
    "one cancelled order",
  );
  assert.deepEqual(
    laneSummary("cancelled", [order("1", { status: "Cancelled", total: 439 }), order("2", { status: "Cancelled", total: 61 })], false, { kind: "today" }, NOW),
    { count: "2", amount: "₹500", line: "Not charged", tone: "plain" },
    "two cancelled orders",
  );
  const none = (date: OrdersDate) => laneSummary("cancelled", [], false, date, NOW).line;
  assert.equal(none({ kind: "today" }), "None today", "none today");
  assert.equal(none({ kind: "yesterday" }), "None yesterday", "none yesterday");
  assert.equal(none({ kind: "day", date: "2026-10-22" }), "None on 22 Oct", "none on a picked day");
  assert.equal(none({ kind: "all" }), "None yet", "none on All dates (design 6.2: not the HTML's 'None ')");
});

test("laneSummary All: {n} orders (singular right), or No orders {when}", () => {
  assert.deepEqual(
    laneSummary("all", [order("1", { total: 250 })], false, { kind: "today" }, NOW),
    { count: "1", amount: "₹250", line: "1 order", tone: "plain" },
    "one order",
  );
  assert.deepEqual(
    laneSummary("all", [order("1", { total: 250 }), settled("2", 879, 879)], false, { kind: "today" }, NOW),
    { count: "2", amount: "₹1,129", line: "2 orders", tone: "plain" },
    "two orders",
  );
  assert.equal(laneSummary("all", [], false, { kind: "today" }, NOW).line, "No orders today", "none today");
  assert.equal(laneSummary("all", [], false, { kind: "yesterday" }, NOW).line, "No orders yesterday", "none yesterday");
  assert.equal(laneSummary("all", [], false, { kind: "day", date: "2026-10-22" }, NOW).line, "No orders on 22 Oct", "a day");
  assert.equal(laneSummary("all", [], false, { kind: "all" }, NOW).line, "No orders yet", "All dates");
  const more = laneSummary("all", Array.from({ length: 50 }, (_, i) => order(String(i))), true, { kind: "today" }, NOW);
  assert.equal(more.line, "50+ orders", "more to load: the line counts 50+");
});
