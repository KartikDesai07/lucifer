// The Orders list's words as a pure model (U2 Task 4, 2026-10-23; docs/superpowers/specs/2026-10-23-orders-match-html-design.md
// 6.4 list head and rows, 6.5 empty, Q9-Q11; docs/superpowers/specs/2026-10-22-orders-html-values.md 0.1 clock, 7 list head,
// 8 table, 9 cards, 10.1 status, 13 empty): a row's code tile, title, number, status pill, age and items, the whole row
// as components/orders/OrderTable.tsx draws it (the table row and the card row read the same view), the list head and
// the empty box's words. The code tile is the dashboard's too (components/dashboard/RecentOrders.tsx).
// Client-safe: no Mongoose, no React.
import { cafeDateString, inr } from "@pos/shared/utils";
import { CAFE_TIMEZONE } from "@/lib/constants";
import { channelOf } from "@/lib/dashboard/channel";
import { CHANNEL_LABELS } from "@/lib/dashboard/fold";
import { billPrintedNow } from "@/lib/dashboard/live-tables";
import { dateWhen, orderDue, type OrdersDate, type OrdersLane } from "@/lib/orders-lanes";
import { timeLabel } from "@/lib/time-input";
import { tokenLabelOf } from "@/lib/token-view";
import type { StatusKind } from "@/lib/ui";
import type { Order } from "@/types";

/** The order's channel as the API returns it: `source` and `parcel` ride on the list rows (GET /api/orders). */
export type ListedOrder = Order & { source?: string; parcel?: boolean };

/** The most digits the code tile holds after the "T" (the dashboard's 40px tile at 12.5/600). */
const CODE_DIGITS = 3;

/**
 * The HTML's code tile, our closest codes: T + the first run of digits in the table's name ("T-12" → "T12", "Patio 2
 * seat 4" → "T2", at most three digits; a table named without digits shows its first two letters), TA a takeaway, QR a
 * diner's QR order, WI a walk-in at the counter. (Moved from the dashboard's RecentOrders, U2 Task 4: same output.)
 */
export function recentOrderCode(order: ListedOrder): string {
  const channel = channelOf(order);
  if (channel === "takeaway") return "TA";
  if (channel === "qr") return "QR";
  if (channel === "counter") return "WI";
  const table = order.tableNo ?? "";
  const digits = /\d+/.exec(table)?.[0];
  return digits ? `T${digits.slice(0, CODE_DIGITS)}` : table.replace(/[^\p{L}]/gu, "").slice(0, 2).toUpperCase() || "T";
}

/** The row's title (our words, as U1's tabs): "Takeaway", else the table "Table T-4" (a QR order at a table too), else
 *  "QR order", else "Walk-In". */
export function orderTitle(o: ListedOrder): string {
  const channel = channelOf(o);
  if (channel === "takeaway") return "Takeaway";
  if (o.tableNo) return `Table ${o.tableNo}`;
  return channel === "qr" ? "QR order" : "Walk-In";
}

/** "#" + an order id's last segment, its number of the day ("ORD-20261019-014" → "#014"); the Kitchen card's where line
 *  reads it from the card's printed number (U4 Task 3, lib/kitchen-view.ts). */
export function orderNumberOf(orderId: string): string {
  return `#${orderId.split("-").pop() ?? orderId}`;
}

/** The order's number of the day ("#014"). */
export function orderNumber(o: Order): string {
  return orderNumberOf(o.orderId);
}

export interface OrderStatusPill {
  label: string;
  kind: StatusKind;
}

const PAID_MODES: readonly string[] = ["Cash", "Online", "Split"];

/**
 * The status pill (design 6.4; values 10.1): an open tab "Bill printed" when the server knows of the print (Q11,
 * billPrintedNow) else "In kitchen"; "Cancelled"; a settled bill with money owed "Due" (any mode: Due, Credit, a short
 * payment, Q3); else "Paid · {Cash | Online | Split}".
 */
export function orderStatus(o: Order): OrderStatusPill {
  if (o.status === "Pending") return billPrintedNow(o) ? { label: "Bill printed", kind: "bill" } : { label: "In kitchen", kind: "info" };
  if (o.status === "Cancelled") return { label: "Cancelled", kind: "bad" };
  if (orderDue(o) > 0) return { label: "Due", kind: "bill" };
  return { label: PAID_MODES.includes(o.payment) ? `Paid · ${o.payment}` : "Paid", kind: "ok" };
}

export type AgeTone = "bad" | "warn" | "plain";

export interface OrderAge {
  /** The table row's line under the time: "Open 1h 8m", or "Today" / "17 Oct". */
  text: string;
  /** The card's line under the amount: the age without "Open ", or the clock time today, else the day ("17 Oct",
   *  Ruling P18). */
  short: string;
  tone: AgeTone;
}

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const LATE_MINUTES = 30;
// "21:30" (24-hour, zero-padded), the stored shape timeLabel reads (as lib/pos-clock.ts), in the cafe's time zone.
const CLOCK_24 = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: CAFE_TIMEZONE });
const DAY_MONTH = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: CAFE_TIMEZONE });

/** The cafe's (IST) clock time of an instant, the HTML's `hm`: "8:22 PM". */
export function clockTime(iso: string): string {
  return timeLabel(CLOCK_24.format(new Date(iso)));
}

/** The instant a row's time shows (Ruling P8): a cancelled order its cancel time (the HTML's closed rows show the
 *  cancel time, values 10.3), else when it was opened; a settled bill its opening (we store no paid-at time). */
export function rowInstant(o: Order): string {
  return (o.status === "Cancelled" && o.cancelledAt) || o.createdAt;
}

/**
 * How old the row is (values 0.1): an open tab "Open {m} min" / "Open {h}h {m}m" with m = max(1, round(minutes)),
 * --warn-i from 30 minutes and --bad-i from 60 (600); any other order "Today" with the clock time on the card, or its
 * day ("17 Oct") on both (rowInstant: a cancelled one its cancel time), in --text-3. Ruling P18 (the verification fix,
 * V-B): the HTML's card shows the clock (its seed holds only today's bills); ours lists older days too (All dates,
 * Yesterday, a picked day), where the clock alone made rows of two days alike ("#014" repeats daily).
 */
export function orderAge(o: Order, now: Date): OrderAge {
  if (o.status === "Pending") {
    const m = Math.max(1, Math.round((now.getTime() - Date.parse(o.createdAt)) / MINUTE_MS));
    const short = m < HOUR_MINUTES ? `${m} min` : `${Math.floor(m / HOUR_MINUTES)}h ${m % HOUR_MINUTES}m`;
    const tone: AgeTone = m >= HOUR_MINUTES ? "bad" : m >= LATE_MINUTES ? "warn" : "plain";
    return { text: `Open ${short}`, short, tone };
  }
  const instant = rowInstant(o);
  const at = new Date(instant);
  if (cafeDateString(at) === cafeDateString(now)) return { text: "Today", short: clockTime(instant), tone: "plain" };
  const day = DAY_MONTH.format(at);
  return { text: day, short: day, tone: "plain" };
}

/** The items (the HTML's): "{qty}× {first item}" + " +{n} more" for more lines; "—" for none. */
export function itemsSummary(o: Order): string {
  const first = o.items[0];
  if (!first) return "—";
  const more = o.items.length - 1;
  return `${first.qty}× ${first.name}${more > 0 ? ` +${more} more` : ""}`;
}

export interface OrderRowView {
  key: string;
  code: string;
  /** A billed open tab's tile in the bill tint (values 8.1 bBg / bFg). */
  codeTone: "bill" | "plain";
  title: string;
  number: string;
  /** "#014 · Dine-in" + " · Token 12" when it has one (our channel words; today's token label stays). */
  sub: string;
  customer: string;
  customerSub: string | null;
  items: string;
  time: string;
  age: OrderAge;
  status: OrderStatusPill;
  amount: string;
  /** A cancelled order's amount is struck in --text-3. */
  struck: boolean;
  dueText: string | null;
  /** An open tab: the table row's "Settle" (it opens the detail, Q6). */
  settle: boolean;
}

/** One row as drawn (design 6.4): a walk-in reads "Walk-in" with "No customer added" under it; a named customer has no
 *  second line (we have no phone or visits in a row). */
export function orderRowView(o: ListedOrder, now: Date): OrderRowView {
  const number = orderNumber(o);
  const channel = CHANNEL_LABELS[channelOf(o)];
  const token = typeof o.tokenNumber === "number" && tokenLabelOf(o.tokenNumber);
  const due = orderDue(o);
  return {
    key: o._id,
    code: recentOrderCode(o),
    codeTone: o.status === "Pending" && billPrintedNow(o) ? "bill" : "plain",
    title: orderTitle(o),
    number,
    sub: [number, channel, token].filter(Boolean).join(" · "),
    customer: o.customerId ? o.customerName : "Walk-in",
    customerSub: o.customerId ? null : "No customer added",
    items: itemsSummary(o),
    time: clockTime(rowInstant(o)),
    age: orderAge(o, now),
    status: orderStatus(o),
    amount: inr(o.total),
    struck: o.status === "Cancelled",
    dueText: due > 0 ? `${inr(due)} due` : null,
    settle: o.status === "Pending",
  };
}

// ── The list head and the empty box ───────────────────────────────────────────────────────────────────────────────

export interface ListHead {
  /** The bold count: "8", "12+" while more can be loaded. */
  count: string;
  /** The words after the count: "open orders", "match in all orders". */
  scope: string;
  /** The whole left line, the count first: "8 open orders", "1 match in all orders". */
  left: string;
  right: string;
  /** The Due lane's line under the head (Q9). */
  dueNote: boolean;
}

/** values 7: "{n} {lane} orders" ("{n}+" while more can be loaded; All plain "orders"), or while a phone is typed "{n}
 *  matches in all orders"; right the sort ("Bills printed first, then oldest" on Open, else "Newest first"). */
export function listHead(lane: OrdersLane, count: number, more: boolean, searching: boolean): ListHead {
  const n = `${count}${more ? "+" : ""}`;
  const one = count === 1 && !more;
  const scope = searching
    ? `${one ? "match" : "matches"} in all orders`
    : `${lane === "all" ? "" : `${lane} `}${one ? "order" : "orders"}`;
  return {
    count: n,
    scope,
    left: `${n} ${scope}`,
    right: !searching && lane === "open" ? "Bills printed first, then oldest" : "Newest first",
    dueNote: !searching && lane === "due",
  };
}

export interface EmptyTextInput {
  lane: OrdersLane;
  /** The searched phone ("" when none). */
  searching: string;
  /** A payment or a table filter is on (Ruling P5: the date never counts, the phone's date chip included). */
  filtersOn: boolean;
  /** More orders can be loaded. */
  more: boolean;
  /** The orders loaded (on Paid and Due: the settled orders the page holds). */
  loaded: number;
  date: OrdersDate;
}

/** The empty box's words (design 6.5, values 13, Q10): a phone that matches nothing, then a filter on, then a Paid or Due
 *  page with more settled orders to load, else "No {lane} orders {today | yesterday | on 22 Oct | yet}" (Open always
 *  "today"). */
export function emptyText(i: EmptyTextInput): { title: string; text: string } {
  if (i.searching) return { title: `No orders match “${i.searching}”`, text: "Try another phone number." };
  if (i.filtersOn) return { title: "No orders match these filters", text: "Remove a filter to see more." };
  if ((i.lane === "paid" || i.lane === "due") && i.more) {
    return { title: `No ${i.lane} bills in the latest ${i.loaded} settled orders`, text: "Load more to check older ones." };
  }
  const lane = i.lane === "all" ? "" : `${i.lane} `;
  // Ruling P5: the Open lane ignores the date (Q5), so its words always say "today".
  const when = i.lane === "open" ? "today" : dateWhen(i.date);
  return { title: `No ${lane}orders ${when}`, text: "They will show up here as they happen." };
}
