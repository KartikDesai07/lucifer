// The Orders page's lanes as a pure model (U2 Task 2, 2026-10-23; docs/superpowers/specs/2026-10-23-orders-match-html-design.md
// Q1-Q3, Q5, Q9-Q11, 6.2, 6.12; docs/superpowers/specs/2026-10-22-orders-html-values.md 3, 17): the five lanes, the
// page's filter state, the ONE list query each lane asks (the same GET /api/orders with today's filter keys only: Paid
// and Due share status=Completed, Open sends no date, a typed phone sends no status), the rows a lane shows out of what
// was loaded, the chosen lane's numbers and line, and the URL seeding of the dashboard's and the reports' links. U2 Task 3
// adds the toolbar's words: the date box's choices and words, the Filters panel's payment choices and the chips.
// components/orders/OrdersLanes.tsx draws the cards and the phone strip; components/orders/OrdersToolbar.tsx,
// OrdersDateBox.tsx and OrdersFiltersPanel.tsx the toolbar, the panel and the chips; app/(dashboard)/orders/page.tsx owns
// the state.
// Client-safe: no Mongoose, no React.
import { format } from "date-fns";

import { cafeDateString, inr } from "@pos/shared/utils";
import { PAYMENT_MODES, SETTLEMENT_PAY_MODES, type SettlementPayMode } from "@/lib/constants";
import { billPrintedNow } from "@/lib/dashboard/live-tables";
import { parseDateInput } from "@/lib/date-input";
import { STATUS_CLASSES } from "@/lib/ui";
import type { OrderFilters } from "@/hooks/use-orders";
import type { Order } from "@/types";

/** The owner's five lanes (Q2): All = every order of the date, Open = the open tabs, Paid / Due = the settled bills with
 *  nothing / money owed (Q3), Cancelled. */
export type OrdersLane = "all" | "open" | "paid" | "due" | "cancelled";

/** The lanes in the owner's order, each with its name and the HTML's dot (design 6.2: --text-3, --info, --ok, --bill,
 *  --bad, through lib/ui's STATUS_CLASSES). */
export const ORDERS_LANES: ReadonlyArray<{
  key: OrdersLane;
  label: "All" | "Open" | "Paid" | "Due" | "Cancelled";
  dot: string;
}> = [
  { key: "all", label: "All", dot: STATUS_CLASSES.neutral.dot },
  { key: "open", label: "Open", dot: STATUS_CLASSES.info.dot },
  { key: "paid", label: "Paid", dot: STATUS_CLASSES.ok.dot },
  { key: "due", label: "Due", dot: STATUS_CLASSES.bill.dot },
  { key: "cancelled", label: "Cancelled", dot: STATUS_CLASSES.bad.dot },
];

/** The date box's choices (Q5): Today (the default), Yesterday, All dates, or a picked day ("YYYY-MM-DD", IST). */
export type OrdersDate = { kind: "today" } | { kind: "yesterday" } | { kind: "all" } | { kind: "day"; date: string };

/** The date box's quick rows and the phone's Date pills, in the HTML's order ("Last 7 days" left out: no server range),
 *  then PICK_A_DAY (our calendar, Q5). */
export const ORDERS_DATE_CHOICES: ReadonlyArray<OrdersDate> = [{ kind: "today" }, { kind: "yesterday" }, { kind: "all" }];
export const PICK_A_DAY = "Pick a day…";

/** Everything the list is filtered by. `phone` is the searched phone (after the page's 350 ms wait). */
export interface OrdersFilterState {
  lane: OrdersLane;
  date: OrdersDate;
  payment: SettlementPayMode | null;
  tableNo: string | null;
  phone: string;
}

/** The first view (Q2, Q5): the Open lane, Today, no filter, no search. */
export const DEFAULT_ORDERS_FILTERS: OrdersFilterState = {
  lane: "open",
  date: { kind: "today" },
  payment: null,
  tableNo: null,
  phone: "",
};

/** A card's line when it is not the chosen lane (Q1: numbers on the chosen lane only). */
export const LANE_IDLE_LINES: Record<OrdersLane, string> = {
  all: "Every order",
  open: "Tabs at the tables now",
  paid: "Settled bills",
  due: "Money still owed",
  cancelled: "Not charged",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const LATE_MINUTES = 30;
const MINUTE_MS = 60_000;

/** The `date` filter a date choice sends: the cafe's (IST) today or yesterday, a picked day, nothing for All dates. */
export function dateFilterOf(date: OrdersDate, now: Date): string | undefined {
  switch (date.kind) {
    case "today":
      return cafeDateString(now);
    case "yesterday":
      return cafeDateString(new Date(now.getTime() - DAY_MS));
    case "day":
      return date.date;
    default:
      return undefined;
  }
}

const LANE_STATUS: Record<OrdersLane, string | undefined> = {
  all: undefined,
  open: "Pending",
  paid: "Completed",
  due: "Completed",
  cancelled: "Cancelled",
};

/**
 * The list query (design 6.2, 6.12): the filters useOrdersInfinite takes today and nothing else. A typed phone sets the
 * lane aside (Q4: every lane is searched; the date, payment and table still apply); else the lane's status, and the date
 * except on Open (Q5: an open tab shows whatever day it was opened). Paid and Due ask the same thing (one cache entry).
 * Keys with no value are left out, so equal filters are equal objects.
 */
export function ordersQuery(s: OrdersFilterState, now: Date): OrderFilters {
  const q: OrderFilters = {};
  const searching = s.phone !== "";
  const status = searching ? undefined : LANE_STATUS[s.lane];
  if (status) q.status = status;
  if (s.tableNo) q.tableNo = s.tableNo;
  if (s.payment) q.payment = s.payment;
  const date = searching || s.lane !== "open" ? dateFilterOf(s.date, now) : undefined;
  if (date) q.date = date;
  if (searching) q.phone = s.phone;
  return q;
}

/** A settled bill's money still owed at billing (Q3, Q9: today's Due column); an open tab or a cancelled order owes
 *  nothing. */
export function orderDue(o: Order): number {
  return o.status === "Completed" ? Math.max(0, o.total - o.paidAmount) : 0;
}

const openedAt = (o: Order): number => Date.parse(o.createdAt);

/**
 * The rows a lane shows out of the loaded list: while a phone is typed, all of them as the server sent them (Q4); Paid
 * the settled bills with nothing owed and Due the ones with money owed (Q3); Open the printed bills first (Q11,
 * billPrintedNow), each group oldest first (the HTML's "Bills printed first, then oldest"); else as sent (newest first).
 * Never re-orders the list it is given.
 */
export function laneRows(lane: OrdersLane, rows: Order[], searching: boolean): Order[] {
  if (searching) return rows;
  if (lane === "paid") return rows.filter((o) => orderDue(o) === 0);
  if (lane === "due") return rows.filter((o) => orderDue(o) > 0);
  if (lane === "open") {
    const printedFirst = (o: Order) => (billPrintedNow(o) ? 0 : 1);
    return [...rows].sort((a, b) => printedFirst(a) - printedFirst(b) || openedAt(a) - openedAt(b));
  }
  return rows;
}

/** The date box's words (Q5; design 6.3): "Today", "Yesterday", "All dates", a picked day "22 Oct 2026". */
export function dateLabel(date: OrdersDate): string {
  if (date.kind === "today") return "Today";
  if (date.kind === "yesterday") return "Yesterday";
  if (date.kind === "all") return "All dates";
  const day = parseDateInput(date.date);
  return day ? format(day, "d MMM yyyy") : date.date;
}

/** The Filters panel's Payment pills after "Any" (design 6.3): our five settled modes; today's "Open" is the Open lane. */
export const ORDERS_PAYMENT_CHOICES: readonly SettlementPayMode[] = ["Cash", "Online", "Split", "Due", "Credit"];

export type OrdersChipKey = "payment" | "table" | "date";
export interface OrdersChip {
  key: OrdersChipKey;
  label: string;
}

const PAYMENT_CHIP: Record<SettlementPayMode, string> = {
  Cash: "Paid by Cash",
  Online: "Paid by Online",
  Split: "Paid by Split",
  Due: "Due bills",
  Credit: "Credit bills",
};

/**
 * The chips row (values 6; design 6.3), in the HTML's order: on the phone only, the date when it is not Today (the
 * desktop's date box never makes a chip); the payment; the table. The Filters button's count is their number. The lane
 * and the searched phone are no chips.
 */
export function filterChips(s: OrdersFilterState, phone: boolean): OrdersChip[] {
  const chips: OrdersChip[] = [];
  if (phone && s.date.kind !== "today") chips.push({ key: "date", label: dateLabel(s.date) });
  if (s.payment) chips.push({ key: "payment", label: PAYMENT_CHIP[s.payment] });
  if (s.tableNo) chips.push({ key: "table", label: s.tableNo });
  return chips;
}

/** What tapping a chip clears: its own filter (the date goes back to Today). */
export const CHIP_CLEARS: Record<OrdersChipKey, Partial<OrdersFilterState>> = {
  payment: { payment: null },
  table: { tableNo: null },
  date: { date: { kind: "today" } },
};

/** The HTML's Reset and "Clear all" (values 5.1 ov.clear): the payment, the table and the phone search cleared; the lane
 *  and the date stay. */
export function clearAllFilters(s: OrdersFilterState): OrdersFilterState {
  return { ...s, payment: null, tableNo: null, phone: "" };
}

/** The words after "No payments" / "None" / "No orders" (design 6.2): "today", "yesterday", "on 22 Oct", "yet". */
export function dateWhen(date: OrdersDate): string {
  if (date.kind === "today") return "today";
  if (date.kind === "yesterday") return "yesterday";
  if (date.kind === "all") return "yet";
  const day = parseDateInput(date.date);
  return day ? `on ${format(day, "d MMM")}` : "yet";
}

export type LaneTone = "warn" | "bill" | "plain";

export interface LaneSummary {
  count: string;
  amount: string;
  line: string;
  tone: LaneTone;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const sum = (rows: Order[], of: (o: Order) => number): number => rows.reduce((t, o) => t + of(o), 0);

/** How long a tab has been open, the HTML's way (values 0.1): whole minutes, rounded, at least 1. */
const openMinutes = (o: Order, now: Date): number => Math.max(1, Math.round((now.getTime() - openedAt(o)) / MINUTE_MS));

function laneLine(lane: OrdersLane, rows: Order[], count: string, date: OrdersDate, now: Date): { line: string; tone: LaneTone } {
  const n = rows.length;
  switch (lane) {
    case "open": {
      const billed = rows.filter((o) => billPrintedNow(o)).length;
      if (billed) return { line: `${plural(billed, "bill", "bills")} waiting to be paid`, tone: "warn" };
      const late = rows.filter((o) => openMinutes(o, now) >= LATE_MINUTES).length;
      return late ? { line: `${late} open 30+ min`, tone: "warn" } : { line: "All in service", tone: "plain" };
    }
    case "paid":
      return { line: n ? `Avg ${inr(sum(rows, (o) => o.total) / n)} per bill` : `No payments ${dateWhen(date)}`, tone: "plain" };
    case "due":
      return n ? { line: "Unpaid at billing", tone: "bill" } : { line: "Nothing to collect", tone: "plain" };
    case "cancelled":
      return { line: n ? "Not charged" : `None ${dateWhen(date)}`, tone: "plain" };
    default:
      return { line: n ? `${count} ${count === "1" ? "order" : "orders"}` : `No orders ${dateWhen(date)}`, tone: "plain" };
  }
}

/**
 * The chosen lane's numbers (Q1) from its loaded rows (laneRows): the count and the ₹ total (Due: the money owed),
 * each with "+" while more can be loaded (Q10), and its line with its colour (design 6.2: Open's bills waiting or tabs
 * open 30+ min in --warn-i, Due's "Unpaid at billing" in --bill-i, Q9).
 */
export function laneSummary(lane: OrdersLane, rows: Order[], more: boolean, date: OrdersDate, now: Date): LaneSummary {
  const plus = more ? "+" : "";
  const count = `${rows.length}${plus}`;
  const total = lane === "due" ? sum(rows, orderDue) : sum(rows, (o) => o.total);
  return { count, amount: `${inr(total)}${plus}`, ...laneLine(lane, rows, count, date, now) };
}

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_LANE: Record<string, OrdersLane> = { Pending: "open", Completed: "paid", Cancelled: "cancelled" };
const OPEN_TAB_PAYMENT = "Unpaid";

/**
 * The URL seeding (design 6.12; read once on mount, never written back): `status` Pending / Completed / Cancelled → the
 * Open / Paid / Cancelled lane; `payment=Unpaid` → the Open lane (an open tab's payment); another settled mode → that
 * payment filter; `date=YYYY-MM-DD` → that day. A link with a status or a payment and no date opens on All dates (as
 * today's list); a link with no status that names a day or a payment opens All, so a report's day drill-down shows every
 * order of that day and a payment link lists every bill paid that way, as today. Plain /orders seeds nothing.
 */
export function seedFromUrl(search: string): Partial<OrdersFilterState> {
  const params = new URLSearchParams(search);
  const seed: Partial<OrdersFilterState> = {};
  const status = params.get("status") ?? "";
  const payment = params.get("payment") ?? "";
  const date = params.get("date") ?? "";
  const statusLane = Object.hasOwn(STATUS_LANE, status) ? STATUS_LANE[status] : undefined;
  const knownPayment = (PAYMENT_MODES as readonly string[]).includes(payment);
  const settledPayment = (SETTLEMENT_PAY_MODES as readonly string[]).includes(payment) ? (payment as SettlementPayMode) : null;
  const day = DATE_PARAM.test(date) ? date : null;
  if (statusLane) seed.lane = statusLane;
  else if (payment === OPEN_TAB_PAYMENT) seed.lane = "open";
  else if (day || settledPayment) seed.lane = "all";
  if (settledPayment) seed.payment = settledPayment;
  if (day) seed.date = { kind: "day", date: day };
  else if (statusLane || knownPayment) seed.date = { kind: "all" };
  return seed;
}
