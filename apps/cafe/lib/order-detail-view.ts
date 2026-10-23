// The order detail's head as a pure model (U2 Task 5, 2026-10-23; docs/superpowers/specs/2026-10-23-orders-match-html-design.md
// 6.7; docs/superpowers/specs/2026-10-22-orders-html-values.md 0.1 clock, 11.2 head, 11.10 per kind): the meta row and the
// steps components/orders/OrderDetailHead.tsx draws. The code tile, the title and the number are the list row's
// (lib/orders-row.ts), so the head names an order exactly as its row does. Client-safe: no Mongoose, no React.
import { CHANNEL_LABELS } from "@/lib/dashboard/fold";
import { channelOf } from "@/lib/dashboard/channel";
import { billPrintedNow } from "@/lib/dashboard/live-tables";
import { orderSkipsKitchen } from "@/lib/kitchen-lines";
import { orderDue } from "@/lib/orders-lanes";
import { clockTime, orderAge, rowInstant, type AgeTone, type ListedOrder } from "@/lib/orders-row";
import { tokenLabelOf } from "@/lib/token-view";
import { cafeDateString } from "@pos/shared/utils";
import type { Order } from "@/types";

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
