// Why a new file: Send to Kitchen and Pay Now need runtime-tested rules and no
// test in this repo mounts hooks, so — like lib/settle-flow.ts — the state
// machine is a pure controller over ports (the POST, the key minter) and
// hooks/use-pos-send.ts is a thin shell that subscribes to it
// (lib/pos-send.test.ts). F4's pos-send and its controller, merged; no read
// port — the server's replay of the same key IS the check (R4).
//
// Owner decision 2 (2026-09-28): a send is ONE confirmed foreground request.
// The tap sends it at once and locks the POS while it flies; the cart is freed
// only after the server answers (confirm). A definite refusal frees nothing
// (the mutation hook's toast says why). No answer — a timeout, the network, a
// 5xx — is "Couldn't confirm": the POS stays FROZEN (an edit sent under the
// kept key would replay the stored order at money the cashier never took, or
// 409 and let a fresh key duplicate it), and the only ways on are Send again —
// the SAME request with the SAME idemKey, so a first try that landed is
// replayed, never made twice — or Discard. Nothing here resends on its own,
// and nothing outlives the page (a reload forgets the attempt). An answer that
// lands after the POS unmounted has no notice or print surface left, so it is
// said once as a toast (the settle flow's rule, lib/settle-flow.ts).

import { kotRoundOfIdemKey } from "@pos/shared/order-idem";
import { classifyFailure, NOTICE_TITLES, signedOut, tabLabel, type WriteNotice, type WriteNoticeAction } from "@/lib/pending-writes";
import { roundSkipsKitchen } from "@/lib/kitchen-lines";
import type { Order } from "@/types";

/** Which surface a send belongs to: the cart (Send to Kitchen) or the payment popup (Pay Now). */
export type SendKind = "kitchen" | "pay";

export interface SendJob {
  kind: SendKind;
  /** "create" for a new order / sale, the tab's id for a round. */
  scope: string;
  /** Sends this job's body with this key (undefined = no key, the pre-F5 request). */
  request: (idemKey: string | undefined) => Promise<Order>;
  /** The server answered with `order`: print, toast, free the cart. Runs once. */
  confirm: (order: Order, idemKey: string | undefined) => void;
}

/** What an answer after unmount says: it went through, or it could not be confirmed. */
export interface UnmountedToast {
  tone: "success" | "warning";
  message: string;
}

export interface PosSendPorts {
  /** A fresh idempotency key, or undefined when this device has no entropy. */
  mintKey: () => string | undefined;
  /** The POS unmounted mid-flight (the operator left the page): say it once. */
  toastUnmounted: (toast: UnmountedToast) => void;
}

export interface SendNotice {
  job: SendKind;
  notice: WriteNotice;
}

/** Immutable: a new object on every change, so it can be a React snapshot. */
export interface PosSendState {
  /** The send in flight — the lock and the "Sending…" label. */
  sending: SendKind | null;
  /** An unconfirmed send whose key must go out again: its surface is frozen. */
  frozen: SendKind | null;
  /** The last unanswered send's notice, shown by the surface it belongs to. */
  notice: SendNotice | null;
}

export interface PosSend {
  getState: () => PosSendState;
  subscribe: (listener: () => void) => () => void;
  /** Marks the POS mounted; returns the unmount. */
  mount: () => () => void;
  /** The operator's Send / Place Order / Send again tap. Never throws. */
  run: (job: SendJob) => Promise<void>;
  /** True from the tap until the answer, and while frozen — for handlers and fences. */
  isLocked: () => boolean;
  /** resetOrder / enterResume / Discard: forget the attempt; the next send gets a new key. */
  reset: () => void;
  /** An unconfirmed `kind` send whose key must go out again (Pay Now's popup stays open, R13). */
  holds: (kind: SendKind) => boolean;
}

export const SEND_UNCONFIRMED_KITCHEN =
  "The kitchen may not have this order yet. Tap Send again — it can never go through twice.";
export const SEND_UNCONFIRMED_PAY =
  "This sale may not be saved yet. Tap Send again — it can never go through twice.";
export const SEND_STILL_UNREACHABLE = "Still can't reach the server. Check the internet, then tap Send again.";
/** No key to repeat, so a resend could make a second order: look first. */
export const SEND_UNCONFIRMED_UNKEYED_KITCHEN = "We couldn't confirm this. Check Open tabs before sending it again.";
export const SEND_UNCONFIRMED_UNKEYED_PAY = "We couldn't confirm this sale. Check Orders before taking payment again.";
/** K3 — a 401/403 on Send again: the sign-in is checked before the replay, so the first try may still have landed. */
export const SEND_SIGNED_OUT = "You were signed out. Sign in again, then tap Send again.";
/** K2 — the answer landed after the POS unmounted. */
export const SEND_LOST_KITCHEN = "Couldn't confirm the order was sent. Check Open tabs before sending it again.";
export const SEND_LOST_PAY = "Couldn't confirm the sale. Check Orders before taking payment again.";
export const SEND_DONE_AWAY_KITCHEN = "Sent to the kitchen, but the ticket may not have printed. Reprint it from Orders.";
export const SEND_DONE_AWAY_PAY = "Sale saved, but the bill may not have printed. Reprint it from Orders.";
/** R-d — what Discard asks before it drops an unconfirmed send. */
export const SEND_DISCARD_KITCHEN = "The order may already have reached the kitchen. Check Open tabs before sending it again.";
export const SEND_DISCARD_PAY = "The sale may already be saved. Check Orders before taking payment again.";

const FIRST_KOT_ROUND = 1;
const IDLE: PosSendState = { sending: null, frozen: null, notice: null };

function unconfirmed(kind: SendKind, again: boolean, keyed: boolean, authFailed: boolean): WriteNotice {
  const action: WriteNoticeAction = keyed ? "send-again" : "confirm";
  const message = !keyed
    ? kind === "pay"
      ? SEND_UNCONFIRMED_UNKEYED_PAY
      : SEND_UNCONFIRMED_UNKEYED_KITCHEN
    : authFailed
      ? SEND_SIGNED_OUT
      : again
      ? SEND_STILL_UNREACHABLE
      : kind === "pay"
        ? SEND_UNCONFIRMED_PAY
        : SEND_UNCONFIRMED_KITCHEN;
  return { kind: "uncertain", title: NOTICE_TITLES.uncertain, message, action };
}

/** M5 — the KOT round a confirmed send prints. A new order is round 1 even when
 *  a replay returns a tab that has gained rounds since; a round is the one its
 *  key landed as, else the latest (a keyless send, or a server without F5). */
export function kotRoundOfSend(order: Order, isRound: boolean, idemKey: string | undefined): number {
  if (!isRound) return FIRST_KOT_ROUND;
  return (idemKey ? kotRoundOfIdemKey(order, idemKey) : undefined) ?? order.kotRounds;
}

/** The one success toast of a Send to Kitchen. `round` null = a new order. */
export function kitchenSentMessage(order: Pick<Order, "tableNo" | "orderId" | "items">, round: number | null): string {
  // Skip-KOT: a round of only no-kitchen lines made no ticket, so the toast must not claim one.
  if (roundSkipsKitchen(order.items, round ?? FIRST_KOT_ROUND)) {
    return round === null
      ? `Order saved. ${tabLabel(order)} is in Open tabs. Nothing went to the kitchen.`
      : `Round ${round} added. ${tabLabel(order)} is still open. Nothing went to the kitchen.`;
  }
  return round === null
    ? `Sent to kitchen. ${tabLabel(order)} is in Open tabs.`
    : `Round ${round} sent. ${tabLabel(order)} is still open.`;
}

/** An unanswered send: the key it went out with, and the request itself. */
interface Held {
  kind: SendKind;
  scope: string;
  key: string;
  /** Send again repeats exactly this — never a request rebuilt from the screen. */
  request: SendJob["request"];
}

export function createPosSend(ports: PosSendPorts): PosSend {
  let state: PosSendState = IDLE;
  const listeners = new Set<() => void>();
  // Synchronous double-tap fence — a rendered busy flag lands a macrotask late.
  let inFlight = false;
  let mounted = false;
  let held: Held | null = null;
  // Bumped by reset(): an answer to a request from before it is not this cart's.
  let generation = 0;

  const commit = (next: PosSendState) => {
    state = next;
    for (const l of listeners) l();
  };

  const run = async (job: SendJob): Promise<void> => {
    if (inFlight) return;
    const scope = `${job.kind}:${job.scope}`;
    const again = held;
    // One write at a time: nothing else goes out over an unconfirmed send.
    if (again && again.scope !== scope) return;
    const key = again ? again.key : ports.mintKey();
    const request = again ? again.request : job.request;
    const started = generation;
    inFlight = true;
    commit({ ...state, sending: job.kind });
    let order: Order;
    try {
      order = await request(key);
    } catch (e) {
      inFlight = false;
      // Discarded meanwhile: the cart this request belonged to is gone.
      if (started !== generation) return commit({ ...state, sending: null });
      // K3: the routes check the sign-in BEFORE the replay, so a 401/403 on
      // Send again proves nothing about the first try — keep it held.
      const authFailed = again !== null && signedOut(e);
      if (classifyFailure(e) !== "uncertain" && !authFailed) {
        // R-c: a definite refusal wrote nothing — and of the SAME request, it
        // proves the first try did not land either. The attempt is over.
        held = null;
        return commit(IDLE);
      }
      held = key === undefined ? null : { kind: job.kind, scope, key, request };
      if (!mounted) ports.toastUnmounted({ tone: "warning", message: job.kind === "pay" ? SEND_LOST_PAY : SEND_LOST_KITCHEN });
      const notice = unconfirmed(job.kind, again !== null, key !== undefined, authFailed);
      return commit({ sending: null, frozen: held ? job.kind : null, notice: { job: job.kind, notice } });
    }
    inFlight = false;
    if (started === generation) held = null;
    commit(IDLE);
    // The page's print surface and toasts are gone: say it here, once, instead.
    if (!mounted) return ports.toastUnmounted({ tone: "success", message: job.kind === "pay" ? SEND_DONE_AWAY_PAY : SEND_DONE_AWAY_KITCHEN });
    job.confirm(order, key);
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount: () => {
      mounted = true;
      return () => {
        mounted = false;
      };
    },
    run,
    isLocked: () => inFlight || held !== null,
    reset: () => {
      generation += 1;
      held = null;
      if (state.notice || state.frozen) commit({ ...state, frozen: null, notice: null });
    },
    holds: (kind) => held?.kind === kind,
  };
}
