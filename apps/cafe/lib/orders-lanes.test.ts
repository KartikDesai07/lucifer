// U2 Task 2 (2026-10-23): the Orders page's lanes and the one list query each lane asks
// (docs/superpowers/specs/2026-10-23-orders-match-html-design.md Q1-Q5, Q11, 6.2, 6.12;
// docs/superpowers/specs/2026-10-22-orders-html-values.md 3, 17). Pure pins on lib/orders-lanes.ts: the lanes, the query
// (it never grows: every lane x date x payment x table x phone gives only today's filter keys), the rows a lane shows and
// the URL seeding. The chosen lane's numbers: orders-lanes-summary.test.ts; the lanes as drawn and the page's wiring:
// orders-lanes-view.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";

import { STATUS_CLASSES } from "./ui";
import {
  CHIP_CLEARS,
  DEFAULT_ORDERS_FILTERS,
  LANE_IDLE_LINES,
  ORDERS_DATE_CHOICES,
  ORDERS_LANES,
  ORDERS_PAYMENT_CHOICES,
  PICK_A_DAY,
  clearAllFilters,
  dateFilterOf,
  dateLabel,
  filterChips,
  laneRows,
  orderDue,
  ordersQuery,
  seedFromUrl,
  type OrdersDate,
  type OrdersFilterState,
  type OrdersLane,
} from "./orders-lanes";
import { NOW, minutesBefore, order, printed, settled, state } from "./orders-lanes.fixtures";

const LANES: OrdersLane[] = ["all", "open", "paid", "due", "cancelled"];
const DATES: OrdersDate[] = [{ kind: "today" }, { kind: "yesterday" }, { kind: "all" }, { kind: "day", date: "2026-10-14" }];
const DATE_STRING: Record<OrdersDate["kind"], string | undefined> = {
  today: "2026-10-19",
  yesterday: "2026-10-18",
  all: undefined,
  day: "2026-10-14",
};
const STATUS_OF: Record<OrdersLane, string | undefined> = {
  all: undefined,
  open: "Pending",
  paid: "Completed",
  due: "Completed",
  cancelled: "Cancelled",
};
const ALLOWED_KEYS = ["status", "tableNo", "payment", "date", "phone"];

// ── The lanes ─────────────────────────────────────────────────────────────────────────────────────────────────────

test("ORDERS_LANES: five lanes All, Open, Paid, Due, Cancelled (owner Q2) with the HTML's dots from lib/ui", () => {
  assert.deepEqual(
    ORDERS_LANES.map((l) => l.key),
    ["all", "open", "paid", "due", "cancelled"],
    "the five lanes, in the owner's order",
  );
  assert.deepEqual(
    ORDERS_LANES.map((l) => l.label),
    ["All", "Open", "Paid", "Due", "Cancelled"],
    "the lane names (design 6.2)",
  );
  assert.deepEqual(
    ORDERS_LANES.map((l) => l.dot),
    [STATUS_CLASSES.neutral.dot, STATUS_CLASSES.info.dot, STATUS_CLASSES.ok.dot, STATUS_CLASSES.bill.dot, STATUS_CLASSES.bad.dot],
    "dots --text-3, --info, --ok, --bill, --bad through STATUS_CLASSES",
  );
  assert.equal(STATUS_CLASSES.neutral.dot, "bg-subtle-foreground", "All's dot is --text-3");
});

test("DEFAULT_ORDERS_FILTERS: the page opens on Open with Today and nothing else set (owner Q2, Q5)", () => {
  assert.deepEqual(
    DEFAULT_ORDERS_FILTERS,
    { lane: "open", date: { kind: "today" }, payment: null, tableNo: null, phone: "" },
    "Open, Today, no payment, no table, no phone",
  );
});

test("LANE_IDLE_LINES: the line a card shows when it is not the chosen lane (owner Q1)", () => {
  assert.deepEqual(
    LANE_IDLE_LINES,
    {
      all: "Every order",
      open: "Tabs at the tables now",
      paid: "Settled bills",
      due: "Money still owed",
      cancelled: "Not charged",
    },
    "design 6.2's fixed lines",
  );
});

// ── The one list query (Review Focus 1: the query never grows) ────────────────────────────────────────────────────

test("dateFilterOf: Today and Yesterday are the cafe's (IST) days, All dates sends none, a picked day itself", () => {
  assert.equal(dateFilterOf({ kind: "today" }, NOW), "2026-10-19", "today at 9:30 PM IST");
  assert.equal(dateFilterOf({ kind: "yesterday" }, NOW), "2026-10-18", "yesterday = 24 h before, IST");
  assert.equal(dateFilterOf({ kind: "all" }, NOW), undefined, "All dates sends no date");
  assert.equal(dateFilterOf({ kind: "day", date: "2026-10-14" }, NOW), "2026-10-14", "a picked day as it is");
  // 00:30 IST on the 19th is still the 18th in UTC: the cafe's day decides.
  const early = new Date("2026-10-18T19:00:00Z");
  assert.equal(dateFilterOf({ kind: "today" }, early), "2026-10-19", "today is the IST day, not the UTC one");
  assert.equal(dateFilterOf({ kind: "yesterday" }, early), "2026-10-18", "yesterday is the IST day before");
});

test("ordersQuery: exact filters for the lanes (Open sends no date; Paid and Due share status=Completed)", () => {
  const today = { kind: "today" } as const;
  assert.deepEqual(ordersQuery(state({ lane: "open" }), NOW), { status: "Pending" }, "the first view: open tabs of any day");
  assert.deepEqual(ordersQuery(state({ lane: "all" }), NOW), { date: "2026-10-19" }, "All: today's whole list");
  assert.deepEqual(ordersQuery(state({ lane: "paid" }), NOW), { status: "Completed", date: "2026-10-19" }, "Paid: today's settled");
  assert.deepEqual(ordersQuery(state({ lane: "due" }), NOW), { status: "Completed", date: "2026-10-19" }, "Due: the same query as Paid");
  assert.deepEqual(
    ordersQuery(state({ lane: "cancelled", date: { kind: "all" } }), NOW),
    { status: "Cancelled" },
    "Cancelled on All dates",
  );
  assert.deepEqual(
    ordersQuery(state({ lane: "open", date: { kind: "day", date: "2026-10-14" }, payment: "Cash", tableNo: "T-4" }), NOW),
    { status: "Pending", payment: "Cash", tableNo: "T-4" },
    "Open ignores the date (owner Q5), payment and table still apply",
  );
  assert.deepEqual(
    ordersQuery(state({ lane: "open", date: today, phone: "98765" }), NOW),
    { date: "2026-10-19", phone: "98765" },
    "a typed phone sets the lane aside (owner Q4): no status, the date applies",
  );
  assert.deepEqual(
    ordersQuery(state({ lane: "cancelled", date: { kind: "yesterday" }, payment: "Due", tableNo: "T-1", phone: "98" }), NOW),
    { date: "2026-10-18", payment: "Due", tableNo: "T-1", phone: "98" },
    "phone with every filter: no status",
  );
});

test("ordersQuery: every lane x date x payment x table x phone gives only today's filter keys, never undefined", () => {
  let n = 0;
  for (const lane of LANES)
    for (const date of DATES)
      for (const payment of [null, "Cash", "Due"] as const)
        for (const tableNo of [null, "T-4"])
          for (const phone of ["", "98765"]) {
            const s: OrdersFilterState = { lane, date, payment, tableNo, phone };
            const q = ordersQuery(s, NOW);
            const label = JSON.stringify(s);
            const expected: Record<string, string> = {};
            const status = phone ? undefined : STATUS_OF[lane];
            if (status) expected.status = status;
            if (tableNo) expected.tableNo = tableNo;
            if (payment) expected.payment = payment;
            const day = phone || lane !== "open" ? DATE_STRING[date.kind] : undefined;
            if (day) expected.date = day;
            if (phone) expected.phone = phone;
            assert.deepEqual(q, expected, `exact filters for ${label}`);
            for (const [k, v] of Object.entries(q)) {
              assert.ok(ALLOWED_KEYS.includes(k), `only today's filter keys (${k} in ${label})`);
              assert.ok(typeof v === "string" && v.length > 0, `no empty or undefined value (${k} in ${label})`);
            }
            assert.ok(!("limit" in q) && !("before" in q), `the page never sets limit or before itself (${label})`);
            if (lane === "open" && !phone) assert.ok(!("date" in q), `Open never sends a date (${label})`);
            if (phone) assert.ok(!("status" in q), `a typed phone never sends a status (${label})`);
            if (lane === "paid") {
              assert.deepEqual(q, ordersQuery({ ...s, lane: "due" }, NOW), `Paid and Due are one query (${label})`);
            }
            n += 1;
          }
  assert.equal(n, 5 * 4 * 3 * 2 * 2, "every combination was checked");
});

// ── Due, lane rows ────────────────────────────────────────────────────────────────────────────────────────────────

test("orderDue: a settled bill's money still owed (owner Q3); an open tab or a cancelled order owes nothing", () => {
  assert.equal(orderDue(settled("1", 954, 0, "Due")), 954, "a Due bill owes its total");
  assert.equal(orderDue(settled("2", 500, 300)), 200, "a short payment owes the rest");
  assert.equal(orderDue(settled("3", 500, 500)), 0, "paid in full owes nothing");
  assert.equal(orderDue(settled("4", 500, 600)), 0, "an overpayment never reads as a negative due");
  assert.equal(orderDue(order("5", { total: 400 })), 0, "an open tab is not a due (payment not taken yet)");
  assert.equal(orderDue(order("6", { status: "Cancelled", total: 400 })), 0, "a cancelled order owes nothing");
});

test("laneRows: Paid keeps the settled bills with nothing owed, Due the ones with money owed, in the server's order", () => {
  const rows = [settled("a", 879, 879, "Online"), settled("b", 954, 0, "Due"), settled("c", 500, 500), settled("d", 500, 300)];
  assert.deepEqual(laneRows("paid", rows, false).map((o) => o._id), ["a", "c"], "Paid: nothing owed");
  assert.deepEqual(laneRows("due", rows, false).map((o) => o._id), ["b", "d"], "Due: money owed (Due mode, short payment)");
  assert.deepEqual(laneRows("all", rows, false).map((o) => o._id), ["a", "b", "c", "d"], "All: as the server sends them");
  assert.deepEqual(laneRows("cancelled", rows, false).map((o) => o._id), ["a", "b", "c", "d"], "Cancelled: as sent");
});

test("laneRows: Open puts the printed bills first (billPrintedNow, owner Q11), then the oldest; a stale print is not printed", () => {
  const rows = [
    order("new", { createdAt: minutesBefore(6) }),
    printed("p-new", { createdAt: minutesBefore(14) }),
    order("stale", { createdAt: minutesBefore(22), billFirstPrintedAt: minutesBefore(20), billFirstPrintedTotal: 50, total: 100 }),
    printed("p-old", { createdAt: minutesBefore(68) }),
    order("old", { createdAt: minutesBefore(55) }),
  ];
  const before = rows.map((o) => o._id);
  assert.deepEqual(
    laneRows("open", rows, false).map((o) => o._id),
    ["p-old", "p-new", "old", "stale", "new"],
    "printed bills first, each group oldest first",
  );
  assert.deepEqual(rows.map((o) => o._id), before, "the loaded list itself is never re-ordered");
});

test("laneRows: while a phone is typed the rows pass through as given (every lane is searched)", () => {
  const rows = [settled("a", 879, 879), order("b"), settled("c", 954, 0, "Due"), printed("d")];
  for (const lane of LANES) {
    assert.deepEqual(laneRows(lane, rows, true).map((o) => o._id), ["a", "b", "c", "d"], `searching on ${lane}: as given`);
  }
});

// ── URL seeding (design 6.12) ─────────────────────────────────────────────────────────────────────────────────────

test("seedFromUrl: the dashboard's and the reports' links land where they did", () => {
  assert.deepEqual(
    seedFromUrl("?payment=Unpaid&status=Pending"),
    { lane: "open", date: { kind: "all" } },
    "the dashboard's open tabs link: the Open lane",
  );
  assert.deepEqual(seedFromUrl("?status=Cancelled"), { lane: "cancelled", date: { kind: "all" } }, "Money leaks' cancelled orders: every day");
  assert.deepEqual(seedFromUrl("?status=Completed"), { lane: "paid", date: { kind: "all" } }, "Completed: the Paid lane");
  assert.deepEqual(seedFromUrl("?status=Pending"), { lane: "open", date: { kind: "all" } }, "Pending: the Open lane");
  assert.deepEqual(seedFromUrl("?payment=Unpaid"), { lane: "open", date: { kind: "all" } }, "payment Unpaid: the Open lane");
  assert.deepEqual(
    seedFromUrl("?date=2026-10-18"),
    { lane: "all", date: { kind: "day", date: "2026-10-18" } },
    "a report's day drill-down: every order of that day",
  );
  assert.deepEqual(
    seedFromUrl("?payment=Cash"),
    { lane: "all", payment: "Cash", date: { kind: "all" } },
    "another payment: that payment filter on every order, every day (as today's ?payment= list)",
  );
  assert.deepEqual(
    seedFromUrl("?payment=Cash&date=2026-10-18"),
    { lane: "all", payment: "Cash", date: { kind: "day", date: "2026-10-18" } },
    "a payment and a day",
  );
  assert.deepEqual(
    seedFromUrl("?status=Cancelled&date=2026-10-18"),
    { lane: "cancelled", date: { kind: "day", date: "2026-10-18" } },
    "a status and a day",
  );
  assert.deepEqual(seedFromUrl("status=Cancelled"), { lane: "cancelled", date: { kind: "all" } }, "no leading ? is fine");
  assert.deepEqual(
    seedFromUrl("?payment=Unpaid&date=2026-10-18"),
    { lane: "open", date: { kind: "day", date: "2026-10-18" } },
    "payment Unpaid with a day and no status: the Open lane with that day (Task 2 review minor, pinned)",
  );
});

test("seedFromUrl: plain /orders and unknown values seed nothing (Open, Today)", () => {
  assert.deepEqual(seedFromUrl(""), {}, "plain /orders");
  assert.deepEqual(seedFromUrl("?status=Bogus"), {}, "an unknown status");
  assert.deepEqual(seedFromUrl("?payment=Bogus"), {}, "an unknown payment");
  assert.deepEqual(seedFromUrl("?date=18-10-2026"), {}, "a date in another shape");
  assert.deepEqual(seedFromUrl("?date=2026-1-8"), {}, "a date without zero padding");
  assert.deepEqual(seedFromUrl("?foo=bar"), {}, "another key");
});

// ── The toolbar's words, the Filters panel's choices and the chips (U2 Task 3; design 6.3, values 4-6) ──────────────

test("dateLabel: the date box's words (owner Q5): Today, Yesterday, All dates, a picked day as '22 Oct 2026'", () => {
  assert.equal(dateLabel({ kind: "today" }), "Today", "Today (the default)");
  assert.equal(dateLabel({ kind: "yesterday" }), "Yesterday", "Yesterday");
  assert.equal(dateLabel({ kind: "all" }), "All dates", "All dates");
  assert.equal(dateLabel({ kind: "day", date: "2026-10-22" }), "22 Oct 2026", "a picked day");
  assert.equal(dateLabel({ kind: "day", date: "2026-09-05" }), "5 Sep 2026", "no leading zero on the day");
  assert.equal(dateLabel({ kind: "day", date: "2026-13-45" }), "2026-13-45", "a day that is no date reads as given");
});

test("ORDERS_DATE_CHOICES / PICK_A_DAY / ORDERS_PAYMENT_CHOICES: the date box's rows and the Payment group's pills", () => {
  assert.deepEqual(
    ORDERS_DATE_CHOICES.map(dateLabel),
    ["Today", "Yesterday", "All dates"],
    "the quick choices in the HTML's order ('Last 7 days' left out: no server range, Q5)",
  );
  assert.equal(PICK_A_DAY, "Pick a day…", "the calendar row's words (Q5), with the ellipsis character");
  assert.deepEqual(
    [...ORDERS_PAYMENT_CHOICES],
    ["Cash", "Online", "Split", "Due", "Credit"],
    "after 'Any': our five settled modes in design 6.3's order (today's 'Open' is the Open lane)",
  );
});

test("filterChips: payment, then table; the date only on the phone and only when it is not Today", () => {
  const chips = (over: Partial<OrdersFilterState>, phone = false) => filterChips(state(over), phone);
  assert.deepEqual(chips({}), [], "the first view: no chip");
  assert.deepEqual(chips({}, true), [], "the first view on the phone: Today is no chip");
  assert.deepEqual(chips({ payment: "Cash" }), [{ key: "payment", label: "Paid by Cash" }], "Cash");
  assert.deepEqual(chips({ payment: "Online" }), [{ key: "payment", label: "Paid by Online" }], "Online");
  assert.deepEqual(chips({ payment: "Split" }), [{ key: "payment", label: "Paid by Split" }], "Split");
  assert.deepEqual(chips({ payment: "Due" }), [{ key: "payment", label: "Due bills" }], "Due (the HTML's words)");
  assert.deepEqual(chips({ payment: "Credit" }), [{ key: "payment", label: "Credit bills" }], "Credit");
  assert.deepEqual(chips({ tableNo: "T-4" }), [{ key: "table", label: "T-4" }], "the table's own name");
  assert.deepEqual(chips({ date: { kind: "yesterday" } }), [], "the desktop's date box never makes a chip (values 6)");
  assert.deepEqual(chips({ date: { kind: "yesterday" } }, true), [{ key: "date", label: "Yesterday" }], "phone: Yesterday");
  assert.deepEqual(chips({ date: { kind: "all" } }, true), [{ key: "date", label: "All dates" }], "phone: All dates");
  assert.deepEqual(
    chips({ date: { kind: "day", date: "2026-10-22" }, payment: "Due", tableNo: "T-4" }, true),
    [
      { key: "date", label: "22 Oct 2026" },
      { key: "payment", label: "Due bills" },
      { key: "table", label: "T-4" },
    ],
    "every chip, in the HTML's order (date, payment, table)",
  );
  assert.deepEqual(chips({ phone: "98765", lane: "paid" }, true), [], "the searched phone and the lane are no chips");
});

test("CHIP_CLEARS: each chip clears its own filter; the date goes back to Today", () => {
  assert.deepEqual(CHIP_CLEARS, { payment: { payment: null }, table: { tableNo: null }, date: { date: { kind: "today" } } }, "one patch per chip");
});

test("clearAllFilters: payment, table and the phone search cleared; the lane and the date stay (the HTML's Reset / Clear all)", () => {
  const before = state({ lane: "due", date: { kind: "day", date: "2026-10-22" }, payment: "Cash", tableNo: "T-4", phone: "98765" });
  assert.deepEqual(
    clearAllFilters(before),
    { lane: "due", date: { kind: "day", date: "2026-10-22" }, payment: null, tableNo: null, phone: "" },
    "the date survives (values 5.1 ov.clear)",
  );
  assert.equal(before.payment, "Cash", "the state it is given is not changed");
  assert.deepEqual(clearAllFilters(DEFAULT_ORDERS_FILTERS), DEFAULT_ORDERS_FILTERS, "nothing to clear: the same values");
});
