// Why a new file: the settle flow's rules need runtime tests without React —
// no test in this repo mounts hooks — so the state machine that
// hooks/use-settle-flow.ts used to hold lives here as a pure controller over
// ports (the POST, the GET, the handlers, the toasts, the cache refresh), and
// the hook is a thin shell that subscribes to it (lib/settle-flow.test.ts).
//
// Settling a tab as ONE confirmed foreground request (owner decision 1,
// 2026-09-28): `submit` sends the one POST the operator asked for; the popup
// stays open until the server answers. An answer that is not a settle becomes
// a notice inside the popup (lib/pending-writes.ts decides which). A timeout,
// network error or 5xx is "Couldn't confirm" and the tab is remembered as
// unread: its next tap is a Check (one GET), never a resend. Nothing here
// resends on its own, and the memory lives only as long as the page (a reload
// forgets it — the server's echo fence still holds).

import {
  intentOf,
  noticeOfReadError,
  noticeOfSendError,
  noticeOfStep,
  noticeOfUnnumbered,
  stepFromOrder,
  type ReadCause,
  type SettleIntent,
  type WriteNotice,
} from "@/lib/pending-writes";
import type { SettleSeen } from "@/lib/settle-guard";
import type { Order, SettleOrderInput } from "@/types";

export interface SettleFlowHandlers {
  /** The server confirmed the settle (a direct answer, or a Check that found ours). */
  onSettled: (order: Order) => void;
  /** The tab changed on another device — show the fresh bill in place. */
  onChanged: (order: Order) => void;
  /** The operator closed a finished notice (settled elsewhere / gone). */
  onFinished: (order: Order | null) => void;
}

export interface SettleFlowPorts {
  /** The settle POST (the hook passes useSettleOrder's mutateAsync). */
  send: (tabId: string, payload: SettleOrderInput) => Promise<Order>;
  /** ONE GET of the order. */
  read: (tabId: string) => Promise<Order>;
  handlers: SettleFlowHandlers;
  /** A Check found our settle: the POST that landed was never answered, so no toast said so. */
  toastSettled: (order: Order) => void;
  /** Unmounted mid-flight (browser Back): the popup is gone, so say it once. */
  toastUnmounted: (notice: WriteNotice) => void;
  /** Refresh the order / table / customer caches after a read. */
  invalidate: () => void;
  /** Whether this cafe prints bill numbers — read when a Check adopts a settle. */
  billNumbered: () => boolean;
  /** This device's clock (ms) — K1's wait never compares server timestamps. */
  now: () => number;
}

/** Immutable: a new object on every change, so it can be a React snapshot and
 *  noticeFor(id) keeps its identity for PaymentModal's memo. */
export interface SettleFlowState {
  busy: boolean;
  notices: ReadonlyMap<string, WriteNotice>;
}

export interface SettleFlow {
  getState: () => SettleFlowState;
  subscribe: (listener: () => void) => () => void;
  /** Marks the owner mounted; returns the unmount. */
  mount: () => () => void;
  /** The operator's Settle (or Check) tap. Never throws. */
  submit: (tab: Order, payload: SettleOrderInput) => Promise<void>;
  /** Closing the popup. False while a request is in flight (it must not close).
   *  A finished notice ends the tab here (onFinished); a Check notice stays, so
   *  reopening the popup shows Check again; any other notice is cleared. */
  dismiss: (id?: string) => boolean;
  noticeFor: (id: string) => WriteNotice | null;
  busy: () => boolean;
}

/** A tab's attempts that never got an answer. `unread` = not looked at since. */
interface Attempt {
  seen: SettleSeen;
  intents: SettleIntent[];
  unread: boolean;
}

/** K1 — how long our settle may read back without its bill number before it is
 *  adopted as stored (numbering failed for good: the paper then matches the record). */
export const BILL_NUMBER_WAIT_MS = 30 * 1000;

const seenOf = (p: SettleOrderInput): SettleSeen => ({ expectedTotal: p.expectedTotal, expectedVoids: p.expectedVoids });

export function createSettleFlow(ports: SettleFlowPorts): SettleFlow {
  let state: SettleFlowState = { busy: false, notices: new Map() };
  const listeners = new Set<() => void>();
  // Synchronous double-tap fence — a rendered busy flag lands a macrotask late.
  let inFlight = false;
  let mounted = false;
  const attempts = new Map<string, Attempt>();
  // Tabs whose notice ends the popup (settled elsewhere / gone), with the order read.
  const terminal = new Map<string, Order | null>();
  // K1: when this device FIRST read our settle back without its bill number.
  const unnumberedSince = new Map<string, number>();

  const commit = (next: SettleFlowState) => {
    state = next;
    for (const l of listeners) l();
  };

  const show = (id: string, notice: WriteNotice | null) => {
    if (!mounted) {
      if (notice) ports.toastUnmounted(notice);
      return;
    }
    if (!notice && !state.notices.has(id)) return;
    const notices = new Map(state.notices);
    if (notice) notices.set(id, notice);
    else notices.delete(id);
    commit({ ...state, notices });
  };

  const hold = (on: boolean) => {
    inFlight = on;
    if (mounted && state.busy !== on) commit({ ...state, busy: on });
  };

  /** ONE GET of the order, read against this tab's unanswered attempts. */
  const look = async (id: string, cause: ReadCause, seen: SettleSeen, conflictMsg?: string): Promise<void> => {
    const attempt = attempts.get(id);
    const unanswered = attempt?.intents ?? [];
    let order: Order;
    try {
      order = await ports.read(id);
    } catch (e) {
      // Nothing was read, so whatever the notice says, the next tap is another
      // look — never a new POST — against the same intents and the same echo.
      attempts.set(id, { seen, intents: unanswered, unread: true });
      const notice = noticeOfReadError(e, cause, conflictMsg, unanswered.length > 0);
      if (notice.kind === "gone") {
        terminal.set(id, null);
        unnumberedSince.delete(id);
      }
      show(id, notice);
      return;
    }
    const step = stepFromOrder(order, unanswered, seen);
    // K1: the server numbers the bill only after the settle lands, so ours
    // without its number is still being saved — printing now would print none.
    // Only for BILL_NUMBER_WAIT_MS from the first sight: then it is adopted.
    if (step.kind === "settled" && ports.billNumbered() && typeof step.order.billNumber !== "number") {
      const since = unnumberedSince.get(id) ?? ports.now();
      unnumberedSince.set(id, since);
      if (ports.now() - since < BILL_NUMBER_WAIT_MS) {
        attempts.set(id, { seen, intents: unanswered, unread: true });
        show(id, noticeOfUnnumbered());
        ports.invalidate();
        return;
      }
    }
    unnumberedSince.delete(id);
    if (attempt) attempt.unread = false;
    // The earlier attempt can only still land while the tab stays open as priced.
    if (step.kind !== "open") attempts.delete(id);
    if (step.kind === "elsewhere" || step.kind === "gone") terminal.set(id, step.order);
    show(id, noticeOfStep(step, cause, conflictMsg));
    if (step.kind === "settled") {
      ports.toastSettled(step.order);
      ports.handlers.onSettled(step.order);
    } else if (step.kind === "changed") {
      ports.handlers.onChanged(step.order);
    }
    ports.invalidate();
  };

  /** Check: look at a tab whose last settle went unanswered. */
  const check = async (id: string): Promise<void> => {
    hold(true);
    try {
      await look(id, "check", attempts.get(id)?.seen ?? {});
    } finally {
      hold(false);
    }
  };

  const submit = async (tab: Order, payload: SettleOrderInput): Promise<void> => {
    if (inFlight) return;
    if (attempts.get(tab._id)?.unread) return check(tab._id);
    hold(true);
    show(tab._id, null);
    try {
      const order = await ports.send(tab._id, payload);
      attempts.delete(tab._id);
      ports.handlers.onSettled(order);
    } catch (e) {
      const verdict = noticeOfSendError(e);
      if (verdict === "read") {
        await look(tab._id, "conflict", seenOf(payload), e instanceof Error ? e.message : undefined);
      } else {
        if (verdict.kind === "uncertain") {
          const prior = attempts.get(tab._id)?.intents ?? [];
          attempts.set(tab._id, { seen: seenOf(payload), intents: [...prior, intentOf(payload)], unread: true });
        }
        // A finished notice ends the tab when it is closed (dismiss -> onFinished).
        if (verdict.kind === "gone") terminal.set(tab._id, null);
        show(tab._id, verdict);
      }
    } finally {
      hold(false);
    }
  };

  const dismiss = (id?: string): boolean => {
    if (inFlight) return false;
    if (!id) return true;
    const notice = state.notices.get(id);
    // A Check notice stays: the tab's next tap is still a look (K4c).
    if (!notice || notice.action === "check") return true;
    show(id, null);
    if (terminal.has(id)) {
      const order = terminal.get(id) ?? null;
      terminal.delete(id);
      ports.handlers.onFinished(order);
    }
    return true;
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
    submit,
    dismiss,
    noticeFor: (id) => state.notices.get(id) ?? null,
    busy: () => state.busy,
  };
}
