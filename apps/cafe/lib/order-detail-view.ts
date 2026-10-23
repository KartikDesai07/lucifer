// The order detail's head, body and actions as a pure model (U2 Tasks 5-7, 2026-10-23; docs/superpowers/specs/
// 2026-10-23-orders-match-html-design.md 6.7-6.9, Q7, Q9; docs/superpowers/specs/2026-10-22-orders-html-values.md 0.1
// clock, 11.2 head, 11.4-11.6 body, 11.7 / 11.9 actions, 11.10 per kind): the meta row and the steps
// components/orders/OrderDetailHead.tsx draws, the customer row, the items head, a line's meta, the sums, the cancel note
// and a void's line components/orders/OrderDetailBody.tsx and OrderVoidTrail.tsx draw, the quick actions' words and the
// foot OrderDetailSheet.tsx draws. The code tile, the title and the number are the list row's (lib/orders-row.ts), so the
// head names an order exactly as its row does. Client-safe: no Mongoose, no React.
import { CHANNEL_LABELS } from "@/lib/dashboard/fold";
import { channelOf } from "@/lib/dashboard/channel";
import { billPrintedNow } from "@/lib/dashboard/live-tables";
import { orderSkipsKitchen } from "@/lib/kitchen-lines";
import { orderDue } from "@/lib/orders-lanes";
import { clockTime, orderAge, rowInstant, type AgeTone, type ListedOrder } from "@/lib/orders-row";
import { receiptGst, type GstConfig } from "@/lib/receipt";
import { tokenLabelOf } from "@/lib/token-view";
import { chargesFromOrder, chargesTotal } from "@pos/shared/order-charges";
import { REWARD_ITEM_LINE_NOTE } from "@pos/shared/reward-redemption";
import { cafeDateString, discountLineLabel, formatDate, inr, orderItemModifierLines } from "@pos/shared/utils";
import type { Order, OrderItem, OrderVoid } from "@/types";

/** The meta item's icon: the HTML's table, person and clock glyphs, and our ticket glyph for the token. */
export type DetailMetaIcon = "type" | "staff" | "token" | "clock";

export interface DetailMetaItem {
  icon: DetailMetaIcon;
  text: string;
  /** The open clock's colour, as the row's age (values 0.1): --bad-i / --warn-i 600, else the meta's --text-2 400. */
  tone: AgeTone;
}

/**
 * The meta row (values 11.2; design 6.7), in the HTML's order: our channel word ("Dine-in" / "Takeaway" / "QR
 * self-order" / "Counter"), the staff name (our `receiver`: who took the order, the HTML's creator), "Token n" when the
 * order has one (our option), then the clock: an open tab "8:22 PM · 1h 8m" coloured as its age, a closed order its time
 * (a cancelled one its cancel time, Ruling P8) with its day first when it is not today ("17 Oct · 8:16 PM").
 */
export function detailMeta(o: ListedOrder, now: Date): DetailMetaItem[] {
  const items: DetailMetaItem[] = [{ icon: "type", text: CHANNEL_LABELS[channelOf(o)], tone: "plain" }];
  const staff = o.receiver?.trim();
  if (staff) items.push({ icon: "staff", text: staff, tone: "plain" });
  const token = typeof o.tokenNumber === "number" && tokenLabelOf(o.tokenNumber);
  if (token) items.push({ icon: "token", text: token, tone: "plain" });
  const age = orderAge(o, now);
  if (o.status === "Pending") {
    items.push({ icon: "clock", text: `${clockTime(o.createdAt)} · ${age.short}`, tone: age.tone });
    return items;
  }
  // A closed order (orderAge: `short` its clock time, `text` its day): the day only when it is not today.
  const today = cafeDateString(new Date(rowInstant(o))) === cafeDateString(now);
  items.push({ icon: "clock", text: today ? age.short : `${age.text} · ${age.short}`, tone: "plain" });
  return items;
}

/** The step's look (values 11.2 `ST`): done --ok with a tick; the current step white in the --accent ring; to do
 *  --surface-3; bad (Cancelled) --bad; due --bill. */
export type DetailStepState = "done" | "cur" | "todo" | "bad" | "due";

export interface DetailStep {
  label: string;
  state: DetailStepState;
  /** The line under the label ("" for none). */
  time: string;
}

const step = (label: string, state: DetailStepState, time = ""): DetailStep => ({ label, state, time });

/** A round was fired: the order counts one, or a line carries its round (0 / absent = never sent). */
const kitchenSent = (o: Order): boolean => o.kotRounds > 0 || o.items.some((it) => (it.kotRound ?? 0) > 0);

/**
 * The steps (design 6.7; values 11.2): an open tab Opened (its time) → Kitchen ("Sent" once a round was fired; an order
 * whose every fired line skips the kitchen "Not needed", done; else "Not sent") → Bill printed ("Printed" when the server
 * knows of the print, billPrintedNow, Q11) → Paid, the first step not done the current one, "Next" when it has no time of
 * its own; a settled bill four done steps ("Paid" with no time: we store no paid-at time), the last "Due" in the bill look
 * when money is owed (Q3); a cancelled order Opened → Cancelled (its cancel time).
 */
export function detailSteps(o: Order): DetailStep[] {
  if (o.status === "Cancelled") return [step("Opened", "done"), step("Cancelled", "bad", o.cancelledAt ? clockTime(o.cancelledAt) : "")];
  if (o.status !== "Pending") {
    return [step("Opened", "done"), step("Kitchen", "done"), step("Bill printed", "done"), orderDue(o) > 0 ? step("Due", "due") : step("Paid", "done")];
  }
  const printed = billPrintedNow(o);
  const kitchen: [boolean, string] = orderSkipsKitchen(o) ? [true, "Not needed"] : kitchenSent(o) ? [true, "Sent"] : [false, "Not sent"];
  const seq: [string, boolean, string][] = [
    ["Opened", true, clockTime(o.createdAt)],
    ["Kitchen", ...kitchen],
    ["Bill printed", printed, printed ? "Printed" : ""],
    ["Paid", false, ""],
  ];
  const current = seq.findIndex(([, done]) => !done);
  return seq.map(([label, done, time], i) =>
    step(label, done ? "done" : i === current ? "cur" : "todo", i === current && !time ? "Next" : time),
  );
}

// ── The body (U2 Task 6; design 6.8; values 11.4-11.6, 11.10) ───────────────────────────────────────────────────────

/** The customer row (values 11.4): a named customer's initials on --accent-t; a walk-in "?" on --surface-3. */
export interface DetailCustomer {
  initials: string;
  name: string;
  /** The line under the name: a walk-in's "No customer added" (we hold no phone or visits for a named customer). */
  sub: string | null;
  named: boolean;
}

/** The customer row (values 11.4; design 6.8): the initials of the first two words of an attached customer's name and
 *  the name; else the HTML's walk-in "?" and "Walk-in customer" with our "No customer added" under it (our data has no
 *  phone, so the HTML's "No phone · bill can’t be sent" is not used). */
export function detailCustomer(o: Order): DetailCustomer {
  const name = o.customerId ? o.customerName.trim() : "";
  if (!name) return { initials: "?", name: "Walk-in customer", sub: "No customer added", named: false };
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join("").toUpperCase();
  return { initials, name, sub: null, named: true };
}

/** The items box's head (values 11.5): Σ quantity, "1 item" / "6 items". */
export function detailItemsHead(o: Order): string {
  const n = o.items.reduce((sum, it) => sum + it.qty, 0);
  return `${n} ${n === 1 ? "item" : "items"}`;
}

/** A sums row's colour (values 11.5): the discount --bad-i, "Due at billing" --bill-i, else the sums' --text-2. */
export type DetailSumTone = "bad" | "bill" | "plain";

export interface DetailSumRow {
  label: string;
  value: string;
  tone: DetailSumTone;
}

export interface DetailSums {
  rows: DetailSumRow[];
  totalLabel: "To pay" | "Bill total" | "Not charged";
  total: string;
  /** A cancelled order's total is struck in --text-3. */
  struck: boolean;
}

const sumRow = (label: string, value: string, tone: DetailSumTone = "plain"): DetailSumRow => ({ label, value, tone });

/** No live settings here: an order taken before the GST snapshot existed (always settled long ago) is read from its own
 *  stored figures only (gstRow). */
const NO_LIVE_GST: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "inclusive" };

/** The GST row as the printed bill shows it (receiptGst on the order's snapshot): exclusive "GST @5%" (added to the
 *  total), inclusive "Incl. GST @5%" (inside it). An order stored before the mode snapshot existed but with an exclusive
 *  amount (inclusive orders store 0) shows that stored amount in a plain "GST" row ("GST @{rate}%" with a stored rate),
 *  so its rows still add up — never the cafe's live settings. */
function gstRow(o: Order, chargeAmount: number): DetailSumRow | null {
  const gst = receiptGst({ ...o, chargeAmount }, NO_LIVE_GST);
  if (gst.show && gst.gstAmount > 0) return sumRow(`${gst.inclusive ? "Incl. GST" : "GST"} @${gst.rate}%`, inr(gst.gstAmount));
  const stored = o.gstAmount ?? 0;
  if (o.gstMode != null || stored <= 0) return null;
  return sumRow((o.gstRate ?? 0) > 0 ? `GST @${o.gstRate}%` : "GST", inr(stored));
}

/** A bill paid in full in one mode (design 6.8): "Paid by Cash" / "Paid online". */
const PAID_IN_FULL: Readonly<Record<string, string>> = { Cash: "Paid by Cash", Online: "Paid online" };

/** A settled bill's payment rows (design 6.8, Q9): a split's two parts "Paid in cash" + "Paid online", else what was
 *  paid ("Paid by Cash" / "Paid online" in full, "Paid ₹x" short of the total), then "Due at billing" for what was owed
 *  when it was settled (a due paid later goes to the customer's account, never back to the bill: so never "Still due"). */
function paidRows(o: Order): DetailSumRow[] {
  const due = orderDue(o);
  const rows: DetailSumRow[] = [];
  if (o.payment === "Split" && (o.splitCash !== undefined || o.splitOnline !== undefined)) {
    rows.push(sumRow("Paid in cash", inr(o.splitCash ?? 0)), sumRow("Paid online", inr(o.splitOnline ?? 0)));
  } else if (o.paidAmount > 0) {
    rows.push(sumRow((due === 0 && PAID_IN_FULL[o.payment]) || "Paid", inr(o.paidAmount)));
  }
  if (due > 0) rows.push(sumRow("Due at billing", inr(due), "bill"));
  return rows;
}

/**
 * The sums and the total (design 6.8, Q9; values 11.5, 11.10), all from the order's stored figures so they add up as the
 * printed bill does (lib/receipt.ts; the HTML's settled sums skip charges and tax, values 20 #15, not copied):
 * "Subtotal"; the discount (discountLineLabel) "−₹x" in --bad-i; each charge of the order's snapshot; the GST when the
 * bill carries some — exclusive "GST @5%" (added: Subtotal − discount + charges + GST = the total), inclusive
 * "Incl. GST @5%" (inside the total; receiptGst's figure, the untaxed charges lifted out first); a settled bill's payment
 * rows. The total: "To pay" (an open tab), "Bill total" (settled), "Not charged" struck (cancelled: its payment is history
 * the books no longer count, so no payment rows).
 */
export function detailSums(o: Order): DetailSums {
  const charges = chargesFromOrder(o);
  const rows: DetailSumRow[] = [sumRow("Subtotal", inr(o.subtotal))];
  if (o.discount > 0) rows.push(sumRow(discountLineLabel(o.discountKind), `−${inr(o.discount)}`, "bad"));
  for (const c of charges) rows.push(sumRow(c.label, inr(c.amount)));
  const gst = gstRow(o, chargesTotal(charges));
  if (gst) rows.push(gst);
  if (o.status === "Completed") rows.push(...paidRows(o));
  const totalLabel = o.status === "Pending" ? "To pay" : o.status === "Cancelled" ? "Not charged" : "Bill total";
  return { rows, totalLabel, total: inr(o.total), struck: o.status === "Cancelled" };
}

/** The red note under a cancelled order's items (values 11.6 in our words, design 6.8). */
export interface DetailCancelNote {
  text: string;
  reason: string | null;
}

/** "Cancelled at {time} by {who}." (the cancel time) and "Reason: {reason}"; the time, who and why only when they were
 *  stored (with no cancel time stored, no time: the opened time would read as the cancel time). Nothing for an order not
 *  cancelled. */
export function cancelNote(o: Order): DetailCancelNote | null {
  if (o.status !== "Cancelled") return null;
  const at = o.cancelledAt ? ` at ${clockTime(o.cancelledAt)}` : "";
  const who = o.cancelledBy?.trim();
  const reason = o.cancelReason?.trim();
  return { text: `Cancelled${at}${who ? ` by ${who}` : ""}.`, reason: reason ? `Reason: ${reason}` : null };
}

/** A line's meta (values 11.5; design 6.8): our removed / added modifiers (orderItemModifierLines), the instructions and,
 *  on a reward line, its stored note (a line stored before the note existed: the shared constant), joined ", ". */
export function detailLineMeta(item: OrderItem): string {
  const rewardNote = item.reward ? (item.note ?? REWARD_ITEM_LINE_NOTE) : "";
  return [...orderItemModifierLines(item), item.instructions?.trim() ?? "", rewardNote].filter(Boolean).join(", ");
}

/** The line under a voided line in the trail (design 6.8): "round {n} · {reason} — {who}, {date}" (today's words, the
 *  round first; none named when the line carries no round). */
export function voidLineNote(v: OrderVoid): string {
  return `${v.kotRound > 0 ? `round ${v.kotRound} · ` : ""}${v.reason} — ${v.voidedBy}, ${formatDate(v.at)}`;
}

// ── The actions (U2 Task 7; design 6.9, Q7; values 11.7, 11.9, 11.10) ───────────────────────────────────────────────

/** A quick action: today's Print, KOT, Share, Token and Move under the HTML's words. */
export type QuickActionKey = "bill" | "kot" | "share" | "token" | "move";

export interface QuickAction {
  key: QuickActionKey;
  label: string;
}

/**
 * The quick actions in the grid's order (design 6.9; values 11.7): "Print bill" (an open tab whose bill is not printed
 * for its current total, billPrintedNow, Q11) / "Reprint bill" (today's Print, always a duplicate); "Reprint KOT"
 * (today's KOT), "Notify kitchen" on a cancelled order (today's stop notice); "Share bill" (today's WhatsApp link);
 * "Reprint token" when the order has a token and is not cancelled (the sheet's hasToken); "Move table" / "Assign table"
 * (a walk-in tab) on an open tab (the sheet's isOpenTab).
 */
export function quickActions(o: Order): QuickAction[] {
  const open = o.status === "Pending";
  const cancelled = o.status === "Cancelled";
  const actions: QuickAction[] = [
    { key: "bill", label: open && !billPrintedNow(o) ? "Print bill" : "Reprint bill" },
    { key: "kot", label: cancelled ? "Notify kitchen" : "Reprint KOT" },
    { key: "share", label: "Share bill" },
  ];
  if (o.tokenNumber !== undefined && !cancelled) actions.push({ key: "token", label: "Reprint token" });
  if (open) actions.push({ key: "move", label: o.tableNo ? "Move table" : "Assign table" });
  return actions;
}

/** The foot (values 11.9): the table "Edit items" hands to New Order (null: no Edit items) and the primary's words. */
export interface DetailFoot {
  editTable: string | null;
  settleLabel: string;
}

/** An open tab's foot (design 6.9, Q7): "Edit items" for a tab at a table (the Floor's hand-off to New Order), then
 *  "Settle & pay · ₹x" (today's Settle & Pay); a walk-in tab's Settle & pay alone. Settled and cancelled orders: none. */
export function detailFoot(o: Order): DetailFoot | null {
  if (o.status !== "Pending") return null;
  return { editTable: o.tableNo || null, settleLabel: `Settle & pay · ${inr(o.total)}` };
}
