// Settling a tab WITHOUT making the cashier wait for the network — the pure
// half. No React, no fetch: the rules that decide what a failed attempt means
// and what to do next live here and are unit-tested over fake ports
// (lib/pending-writes.test.ts); components/layout/PendingWritesProvider.tsx
// wires them to the real API and the UI.
//
// The owner's rule (2026-09-28): the popup closes at once, the write finishes
// in the background, the bill prints when the server confirms, and a failure
// is LOUD with the tab still open — nothing silently lost, nothing settled
// twice. The server guarantees "at most once, and only on the tab that was
// priced": POST /api/orders/[id]/settle lands only on a still-Pending tab whose
// stored total and void trail are the ones the payload echoes
// (expectedTotal/expectedVoids, lib/settle-guard.ts), so re-sending after an
// unanswered attempt can neither double-settle nor close a tab that grew since
// the money was taken — at worst it gets a 409, and the order itself then says
// whether OUR settle is the one that landed.

import { ApiError } from "@pos/shared/api-client";
import type { Order } from "@/types";

/** Attempts before the write is reported as "could not confirm" (the tab is
 *  then either settled or still open on the server — the alert says which to
 *  check). The waits between attempts; the 15s request timeout sits on top. */
export const SETTLE_MAX_ATTEMPTS = 4;
export const SETTLE_RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 10000];

/** What a failed request means for a retrying writer:
 *  "definite"  — the server refused and wrote nothing (a 4xx other than 409):
 *                never resend.
 *  "conflict"  — 409: the server answered, but the tab was not the one we
 *                priced — or our own earlier attempt already settled it. Read
 *                the order to tell which.
 *  "uncertain" — no answer, or a 5xx: the write may or may not have landed
 *                (the settle route can fail AFTER its CAS committed). Read the
 *                order; resend only if it is still open. */
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

export type SettleOutcome =
  | { kind: "settled"; order: Order }
  /** Settled, but not by this attempt — never print a second bill for it. */
  | { kind: "elsewhere"; order: Order }
  /** The server refused; the tab is still open. */
  | { kind: "failed"; message: string }
  /** The tab was cancelled or no longer exists — nothing to settle or reopen. */
  | { kind: "gone"; message: string }
  /** Every attempt went unanswered — the tab may be settled OR open. */
  | { kind: "unknown"; message: string };

export interface SettlePorts {
  /** POST the settle. Resolves with the settled order or throws. */
  send: () => Promise<Order>;
  /** GET the order as the server holds it now. */
  read: () => Promise<Order>;
  sleep: (ms: number) => Promise<void>;
  /** Called before each re-send (attempt numbers start at 2). */
  onRetry?: (nextAttempt: number) => void;
}

const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const SIGNED_OUT = "You were signed out — sign in again, then settle it";
const TAB_CANCELLED = "The tab was cancelled";
const TAB_MISSING = "The tab no longer exists";

function messageOf(error: unknown): string {
  if (error instanceof ApiError && error.status === HTTP_UNAUTHORIZED) return SIGNED_OUT;
  return error instanceof Error && error.message ? error.message : "Request failed";
}

/** A refusal (definite) — "gone" when there is no tab left to settle. */
function refused(error: unknown): SettleOutcome {
  if (error instanceof ApiError && error.status === HTTP_NOT_FOUND) return { kind: "gone", message: TAB_MISSING };
  return { kind: "failed", message: messageOf(error) };
}

export interface RunSettleOptions {
  /** An earlier run of this settle ended unanswered — a settle of ours may
   *  already be on the server (a manual Retry after "could not confirm"). */
  mayHaveLanded?: boolean;
}

/** Drive one settle to a definite outcome, re-sending only when the server
 *  says the tab is still open (or cannot be asked). */
export async function runSettle(
  intent: SettleIntent,
  ports: SettlePorts,
  options: RunSettleOptions = {},
): Promise<SettleOutcome> {
  // Only an UNANSWERED attempt can have written: every 409 is the server
  // saying "this request wrote nothing". So until one of ours went unanswered,
  // a Completed order — however well it matches — was settled by someone else.
  let mayHaveLanded = options.mayHaveLanded ?? false;
  for (let attempt = 1; ; attempt++) {
    let sendError: unknown;
    try {
      return { kind: "settled", order: await ports.send() };
    } catch (e) {
      sendError = e;
    }
    const failure = classifyFailure(sendError);
    if (failure === "definite") return refused(sendError);
    if (failure === "uncertain") mayHaveLanded = true;

    let current: Order | null = null;
    try {
      current = await ports.read();
    } catch (readError) {
      // The order is gone or this session lost access — nothing to retry into.
      if (classifyFailure(readError) === "definite") return refused(readError);
    }
    if (current) {
      const reading = reconcileSettle(intent, current);
      if (reading === "adopt") return mayHaveLanded ? { kind: "settled", order: current } : { kind: "elsewhere", order: current };
      if (reading === "elsewhere") return { kind: "elsewhere", order: current };
      if (reading === "cancelled") return { kind: "gone", message: TAB_CANCELLED };
      // Still open after a 409: the tab changed under us (a new round, a
      // void) — the operator must look at it again, not the retry loop.
      if (failure === "conflict") return { kind: "failed", message: messageOf(sendError) };
    }
    if (attempt >= SETTLE_MAX_ATTEMPTS) return { kind: "unknown", message: messageOf(sendError) };
    await ports.sleep(SETTLE_RETRY_DELAYS_MS[Math.min(attempt, SETTLE_RETRY_DELAYS_MS.length) - 1]);
    ports.onRetry?.(attempt + 1);
  }
}
