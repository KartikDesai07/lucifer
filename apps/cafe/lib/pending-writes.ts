// Settling a tab as ONE confirmed foreground request — the pure half. No
// React, no fetch: the rules that turn a settle's answer (or its silence) into
// what the payment popup says next live here and are unit-tested
// (lib/pending-writes.test.ts); hooks/use-settle-flow.ts wires them to the API.
//
// The owner's rule (decision 1, 2026-09-28): the operator starts exactly one
// POST; the popup stays open, and cannot be closed or sent again, until the
// server answers; every outcome shows inside the popup. A timeout, network
// error or 5xx is "Couldn't confirm" with a Check button that does ONE GET of
// the order and reads it with reconcileSettle. Nothing is ever resent by
// itself, and nothing survives a reload. The server guarantees "at most once,
// and only on the tab that was priced": POST /api/orders/[id]/settle lands
// only on a still-Pending tab whose stored total and void trail are the ones
// the payload echoes (expectedTotal/expectedVoids, lib/settle-guard.ts), so a
// manual settle after an unanswered one can neither double-settle nor close a
// tab that grew — at worst it gets a 409, and the order then says whose
// settle landed.

import { ApiError } from "@pos/shared/api-client";
import { chargesFromOrder } from "@pos/shared/order-charges";
import { inr } from "@pos/shared/utils";
import { settleRefusal, TAB_CHANGED, type SettleSeen } from "@/lib/settle-guard";
import type { Order, SettleOrderInput } from "@/types";

/** What a failed request means:
 *  "definite"  — the server refused and wrote nothing (a 4xx other than 409).
 *  "conflict"  — 409: the server answered, but the tab was not the one we
 *                priced — or an earlier attempt of ours already settled it.
 *                Read the order to tell which.
 *  "uncertain" — no answer, or a 5xx: the write may or may not have landed
 *                (the settle route can fail AFTER its CAS committed). */
export type FailureKind = "definite" | "conflict" | "uncertain";

const HTTP_CONFLICT = 409;
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;
/** A 408 / 429 is the network or the platform pushing back, not a refusal. */
const HTTP_RETRYABLE = new Set([408, 429]);

export function classifyFailure(error: unknown): FailureKind {
  if (!(error instanceof ApiError)) return "uncertain";
  if (error.kind !== "http" || error.status === null) return "uncertain";
  if (error.status === HTTP_CONFLICT) return "conflict";
  if (error.status >= HTTP_SERVER_ERROR_MIN || HTTP_RETRYABLE.has(error.status)) return "uncertain";
  if (error.status >= HTTP_CLIENT_ERROR_MIN) return "definite";
  return "uncertain";
}

/** What the operator asked for — enough to recognise our own settle on the
 *  order afterwards. `paidAmount` undefined = paid in full (the route's own
 *  rule, lib/order.ts derivePayment). */
export interface SettleIntent {
  payment: string;
  paidAmount?: number;
  splitCash?: number;
  splitOnline?: number;
}

type SettledShape = Pick<Order, "status" | "payment" | "paidAmount" | "total" | "splitCash" | "splitOnline">;

/** Reading an order after an unanswered or conflicting attempt:
 *  "adopt"     — Completed exactly as we asked: our settle landed.
 *  "elsewhere" — Completed some other way (another device settled it).
 *  "open"      — still Pending.
 *  "cancelled" — cancelled meanwhile. */
export type SettleReading = "adopt" | "elsewhere" | "open" | "cancelled";

export function reconcileSettle(intent: SettleIntent, order: SettledShape): SettleReading {
  if (order.status === "Cancelled") return "cancelled";
  if (order.status !== "Completed") return "open";
  if (order.payment !== intent.payment) return "elsewhere";
  // Same mode — the amount must match what derivePayment would have stored.
  const paid = order.paidAmount ?? 0;
  switch (intent.payment) {
    case "Due":
    case "Credit":
      return paid === 0 ? "adopt" : "elsewhere";
    case "Split":
      return order.splitCash === Math.round(intent.splitCash ?? 0) &&
        order.splitOnline === Math.round(intent.splitOnline ?? 0)
        ? "adopt"
        : "elsewhere";
    default: {
      const expected =
        intent.paidAmount === undefined
          ? order.total
          : Math.min(Math.max(0, Math.round(intent.paidAmount)), order.total);
      return paid === expected ? "adopt" : "elsewhere";
    }
  }
}

/** The intent a settle payload carries — read off the very payload sent. */
export function intentOf(p: Pick<SettleOrderInput, "payment" | "paidAmount" | "splitCash" | "splitOnline">): SettleIntent {
  return { payment: p.payment, paidAmount: p.paidAmount, splitCash: p.splitCash, splitOnline: p.splitOnline };
}

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
export const SIGNED_OUT = "You were signed out — sign in again, then settle it";
/** A Check's read was refused for the sign-in: the next tap is another Check. */
export const SIGNED_OUT_CHECK = "You were signed out. Sign in again, then tap Check.";
export const TAB_CANCELLED = "The tab was cancelled";
export const TAB_MISSING = "The tab no longer exists";
const GONE_ADVICE = ". If you took payment for it, give it back or ring it up again.";
const REQUEST_FAILED = "Request failed";

export const SETTLE_UNCONFIRMED =
  "We couldn't confirm this payment. Tap Check to see if it went through before taking payment again.";
export const SETTLE_STILL_UNREACHABLE = "Still can't reach the server. Check the internet, then tap Check again.";
export const SETTLE_NOT_SETTLED = "Not settled — nothing went through. It is safe to settle again.";
export const SETTLE_TAB_CHANGED = "This tab changed after the bill was opened. Check the new total, then settle.";
/** K1 — our settle landed but its bill number is not on the order yet (the
 *  server numbers the bill after the settle): printing now would print none. */
export const SETTLE_BILL_SAVING = "The bill is still being saved. Tap Check again in a moment.";

/** A 401/403: the sign-in failed. The routes check it BEFORE anything else, so
 *  it says nothing about whether an earlier try of the same request landed. */
export function signedOut(error: unknown): boolean {
  return error instanceof ApiError && (error.status === HTTP_UNAUTHORIZED || error.status === HTTP_FORBIDDEN);
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError && error.status === HTTP_UNAUTHORIZED) return SIGNED_OUT;
  return error instanceof Error && error.message ? error.message : REQUEST_FAILED;
}

export function tabLabel(o: Pick<Order, "tableNo" | "orderId">): string {
  return o.tableNo ? `Table ${o.tableNo}` : o.orderId;
}

export function settledMessage(o: Pick<Order, "orderId">): string {
  return `Order ${o.orderId} settled`;
}

export function settledElsewhereMessage(o: Pick<Order, "tableNo" | "orderId" | "payment" | "paidAmount">): string {
  return `${tabLabel(o)} was already settled on another device (${o.payment} ${inr(o.paidAmount)}). Check before giving change.`;
}

/** What the order says after an unanswered attempt or a 409. */
export type SettleStep =
  | { kind: "settled" | "elsewhere" | "changed" | "open"; order: Order }
  | { kind: "gone"; message: string; order: Order | null };

/** `unanswered` = the intents of this tab's attempts that never got an answer:
 *  only one of THOSE can be ours on a Completed order (a 409 is the server
 *  saying "this request wrote nothing"). `seen` = the echo of the bill the
 *  operator is paying, to tell a tab that moved from one that did not. */
export function stepFromOrder(order: Order, unanswered: readonly SettleIntent[], seen: SettleSeen): SettleStep {
  if (order.status === "Completed") {
    return unanswered.some((i) => reconcileSettle(i, order) === "adopt")
      ? { kind: "settled", order }
      : { kind: "elsewhere", order };
  }
  if (order.status === "Cancelled") return { kind: "gone", message: TAB_CANCELLED, order };
  return settleRefusal(order, seen) === TAB_CHANGED ? { kind: "changed", order } : { kind: "open", order };
}

/** One outcome of a write, shown inside its popup (settle here; Send to
 *  Kitchen and Pay Now reuse it with action "send-again"). `action` is what the
 *  popup's main button does next. */
export type WriteNoticeKind = "refused" | "changed" | "open" | "uncertain" | "elsewhere" | "gone";
export type WriteNoticeAction = "confirm" | "check" | "send-again" | "close";
export interface WriteNotice {
  kind: WriteNoticeKind;
  title: string;
  message: string;
  action: WriteNoticeAction;
}

export const NOTICE_TITLES: Readonly<Record<WriteNoticeKind, string>> = {
  refused: "Not settled",
  changed: "The bill changed",
  open: "Not settled yet",
  uncertain: "Couldn't confirm",
  elsewhere: "Already settled",
  gone: "Not settled",
};

/** Check for an unanswered attempt; Close for a tab that is finished here. */
export function noticeAction(kind: WriteNoticeKind): WriteNoticeAction {
  if (kind === "uncertain") return "check";
  if (kind === "elsewhere" || kind === "gone") return "close";
  return "confirm";
}

function notice(kind: WriteNoticeKind, message: string): WriteNotice {
  return { kind, title: NOTICE_TITLES[kind], message, action: noticeAction(kind) };
}

const gone = (message: string) => notice("gone", `${message}${GONE_ADVICE}`);

/** A settle POST failed. "read" = a 409: read the order to see whose settle it was. */
export function noticeOfSendError(e: unknown): WriteNotice | "read" {
  const failure = classifyFailure(e);
  if (failure === "conflict") return "read";
  if (failure === "uncertain") return notice("uncertain", SETTLE_UNCONFIRMED);
  if (e instanceof ApiError && e.status === HTTP_NOT_FOUND) return gone(TAB_MISSING);
  return notice("refused", messageOf(e));
}

export type ReadCause = "conflict" | "check";

/** The notice for a read order; null when it settled (the popup just closes). */
export function noticeOfStep(step: SettleStep, cause: ReadCause, conflictMsg?: string): WriteNotice | null {
  switch (step.kind) {
    case "settled":
      return null;
    case "elsewhere":
      return notice("elsewhere", settledElsewhereMessage(step.order));
    case "changed":
      return notice("changed", SETTLE_TAB_CHANGED);
    case "gone":
      return gone(step.message);
    case "open":
      // After a 409 the tab is unchanged (the route's pricing refusal) — "safe
      // to settle again" would only earn the same refusal, so say what it said.
      return cause === "conflict" ? notice("refused", conflictMsg ?? REQUEST_FAILED) : notice("open", SETTLE_NOT_SETTLED);
  }
}

/** K1 — our settle, read back before its bill number: another Check, not a print. */
export function noticeOfUnnumbered(): WriteNotice {
  return notice("uncertain", SETTLE_BILL_SAVING);
}

/** The read itself failed — never claim a result that was not read. Nothing
 *  was read, so the next tap is another look: every button but Close is Check. */
export function noticeOfReadError(e: unknown, cause: ReadCause, conflictMsg: string | undefined, hasUnanswered: boolean): WriteNotice {
  if (e instanceof ApiError && e.status === HTTP_NOT_FOUND) return gone(TAB_MISSING);
  const read = signedOut(e)
    ? notice("refused", SIGNED_OUT_CHECK)
    : cause === "check"
      ? notice("uncertain", SETTLE_STILL_UNREACHABLE)
      : hasUnanswered
        ? notice("uncertain", SETTLE_UNCONFIRMED)
        : notice("refused", conflictMsg ?? REQUEST_FAILED);
  return { ...read, action: "check" };
}

/** The POS's money inputs, as the operator has them now. */
export interface MoneyState {
  discountRaw: number;
  discountUnit: string;
  chargeOverride: number | undefined;
  extraCharges: readonly { label: string; amount: number }[];
}

/** Whether the operator changed the money since `snapshot` seeded it (the
 *  enterResume / applyTabUpdate seed). A comparison, never a flag, so it cannot
 *  go stale. A refresh keeps edited money rather than overwrite it. */
export function moneyEditedSince(state: MoneyState, snapshot: Order): boolean {
  if (state.discountRaw !== snapshot.discount) return true;
  if (state.discountUnit !== (snapshot.discountKind === "gst" ? "GST" : "₹")) return true;
  if (state.chargeOverride !== undefined) return true;
  const seeded = chargesFromOrder(snapshot).filter((c) => c.type === "extra");
  if (seeded.length !== state.extraCharges.length) return true;
  return seeded.some((c, i) => c.label !== state.extraCharges[i].label || c.amount !== state.extraCharges[i].amount);
}
