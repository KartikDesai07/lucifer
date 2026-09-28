"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import { runSettle, type SettleIntent, type SettleOutcome } from "@/lib/pending-writes";
import { billPrintJob } from "@/lib/print-routing";
import { inr } from "@/lib/utils";
import { useHostRouting } from "@/hooks/use-host-routing";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { CUSTOMER_KEYS } from "@/hooks/use-customers";
import type { Customer, Order, SettleOrderInput } from "@/types";
import type { DiscountUnit } from "@/components/pos/Cart";
import type { ExtraChargeEntry } from "@/components/pos/CartExtraCharges";

// Settles tabs in the BACKGROUND so the cashier never waits on the network
// (owner rule 2026-09-28): the POS closes the payment popup at once; this
// provider (in the dashboard layout, so it outlives any screen) finishes the
// write, prints the bill when the server confirms, and raises a loud, lasting
// alert when it could not settle. The failure rules are pure and unit-tested
// in lib/pending-writes.ts. Only when a print host owns printing
// (`backgroundReady`): the bill is then a host job built from the SERVER's
// order, never the POS page's local print surface, which reads page state a
// background write must not race.
// Completion lives here, never in a mutate() callback (dropped on unmount —
// "the cashier opened Orders mid-settle" is the very case). Not registered
// under ORDER_KEYS.mutation: that would pause the live polls for the whole
// retry window, and nothing optimistic is written for a poll to clobber.

/** What the operator had set at settle time, put back by "Reopen tab". */
export interface SettleDraft {
  discountRaw: number;
  discountUnit: DiscountUnit;
  chargeOverride?: number;
  extraCharges: ExtraChargeEntry[];
  customer?: Customer;
}

/** failed = refused, the tab is still open · unknown = no answer at all ·
 *  gone = the tab was cancelled or deleted, so there is nothing to settle. */
export type PendingSettleState = "sending" | "retrying" | "failed" | "unknown" | "gone";

export interface PendingSettle {
  /** The order's _id — at most one live settle per tab. */
  key: string;
  label: string;
  state: PendingSettleState;
  message?: string;
}

interface SettleJob {
  label: string;
  intent: SettleIntent;
  payload: SettleOrderInput;
  draft: SettleDraft;
}

export interface ReopenRequest {
  orderId: string;
  draft: SettleDraft;
}

interface PendingWritesValue {
  writes: PendingSettle[];
  /** True when a settle may be handed to the background (a host owns printing). */
  backgroundReady: boolean;
  /** Starts a background settle; false (and a toast) when that tab is already settling. */
  enqueueSettle: (order: Order, payload: SettleOrderInput, draft: SettleDraft) => boolean;
  /** A tab that must not be resumed right now — its settle is still being sent. */
  isSettling: (orderId: string) => boolean;
  /** Forget a finished-with-problems entry (the tab itself is untouched on the server). */
  dismiss: (key: string) => void;
  retry: (key: string) => void;
  reopen: (key: string) => void;
  reopenRequest: ReopenRequest | null;
  clearReopenRequest: () => void;
}

const NOOP_VALUE: PendingWritesValue = {
  writes: [],
  backgroundReady: false,
  enqueueSettle: () => false,
  isSettling: () => false,
  dismiss: () => {},
  retry: () => {},
  reopen: () => {},
  reopenRequest: null,
  clearReopenRequest: () => {},
};

const PendingWritesContext = createContext<PendingWritesValue>(NOOP_VALUE);

/** Outside the provider (tests, a screen outside the dashboard) every settle
 *  stays in the foreground — the no-op value says "not ready". */
export function usePendingWrites(): PendingWritesValue {
  return useContext(PendingWritesContext);
}

/** Long enough to read in a rush; the header chip is the lasting record. */
const ALERT_TOAST_MS = 20 * 1000;
const RETRY_SLEEP = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const LIVE_STATES: ReadonlySet<PendingSettleState> = new Set(["sending", "retrying"]);

export function PendingWritesProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { shouldRoute, routePrint } = useHostRouting();
  // Latched: finish() runs after awaits, when the lane may have changed.
  const routePrintRef = useRef(routePrint);
  routePrintRef.current = routePrint;

  const jobs = useRef(new Map<string, SettleJob>());
  // Keys with a runSettle in flight (sync check: toast + chip Retry at once).
  const running = useRef(new Set<string>());
  // Tabs whose last settle went unanswered, so one of ours may be on the server
  // — kept past the alert (reopened and settled again), for runSettle.
  const maybeLanded = useRef(new Set<string>());
  const [writes, setWrites] = useState<PendingSettle[]>([]);
  const [reopenRequest, setReopenRequest] = useState<ReopenRequest | null>(null);

  // A tab/window close would abandon a write this device is still sending.
  useUnsavedGuard(writes.some((w) => LIVE_STATES.has(w.state)));

  const patch = useCallback((key: string, next: Partial<PendingSettle>) => {
    setWrites((all) => all.map((w) => (w.key === key ? { ...w, ...next } : w)));
  }, []);

  const drop = useCallback((key: string) => {
    jobs.current.delete(key);
    toast.dismiss(key);
    // Same list when absent, so a no-op dismiss re-renders nobody.
    setWrites((all) => (all.some((w) => w.key === key) ? all.filter((w) => w.key !== key) : all));
  }, []);

  const reopen = useCallback(
    (key: string) => {
      const job = jobs.current.get(key);
      if (!job || running.current.has(key)) return;
      // The alert stays until the tab is OPEN (the lane's `resumed`): the
      // resume may ask to discard an unsent cart, and be cancelled.
      toast.dismiss(key);
      setReopenRequest({ orderId: key, draft: job.draft });
      router.push("/pos");
    },
    [router],
  );

  // The toasts finish() raises call run, and run calls finish: a ref breaks the cycle.
  const runRef = useRef<(key: string) => void>(() => {});

  const finish = useCallback(
    (key: string, job: SettleJob, outcome: SettleOutcome) => {
      // Whatever happened, the server's view may have moved — refresh it.
      void qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      void qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
      void qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
      const { label } = job;
      if (outcome.kind !== "unknown" && outcome.kind !== "failed") maybeLanded.current.delete(key);
      switch (outcome.kind) {
        case "settled": {
          const order = outcome.order;
          drop(key);
          toast.success(`${label} settled · ${inr(order.total)}`);
          // A first print (bill:<id> key) from the SERVER's order — its bill number.
          routePrintRef.current(
            () => billPrintJob(order, { reprint: false }),
            () =>
              toast.warning(`${label} is settled, but its bill did not print here — reprint it from Orders.`, {
                duration: ALERT_TOAST_MS,
                closeButton: true,
              }),
          );
          return;
        }
        case "elsewhere": {
          const order = outcome.order;
          drop(key);
          toast.warning(
            `${label} was already settled on another device (${order.payment} ${inr(order.paidAmount)}). Check before giving change.`,
            { duration: ALERT_TOAST_MS, closeButton: true },
          );
          return;
        }
        case "failed":
          patch(key, { state: "failed", message: outcome.message });
          toast.error(`${label} was NOT settled`, {
            id: key,
            description: `${outcome.message}. The tab is still open.`,
            duration: ALERT_TOAST_MS,
            closeButton: true,
            action: { label: "Reopen tab", onClick: () => reopen(key) },
          });
          return;
        case "gone":
          patch(key, { state: "gone", message: outcome.message });
          toast.error(`${label} was NOT settled`, {
            id: key,
            description: `${outcome.message}. If you took payment for it, give it back or ring it up again.`,
            duration: ALERT_TOAST_MS,
            closeButton: true,
          });
          return;
        case "unknown":
          maybeLanded.current.add(key);
          patch(key, { state: "unknown", message: outcome.message });
          toast.error(`Couldn't confirm ${label}'s payment`, {
            id: key,
            description: "Check the internet before taking payment again.",
            duration: ALERT_TOAST_MS,
            closeButton: true,
            action: { label: "Retry", onClick: () => runRef.current(key) },
          });
      }
    },
    [drop, patch, qc, reopen],
  );

  const run = useCallback(
    (key: string) => {
      const job = jobs.current.get(key);
      if (!job || running.current.has(key)) return;
      running.current.add(key);
      toast.dismiss(key);
      patch(key, { state: "sending", message: undefined });
      void runSettle(
        job.intent,
        {
          send: () => apiSend<Order>(`/api/orders/${key}/settle`, "POST", job.payload),
          read: () => apiGet<Order>(`/api/orders/${key}`),
          sleep: RETRY_SLEEP,
          onRetry: () => patch(key, { state: "retrying" }),
        },
        { mayHaveLanded: maybeLanded.current.has(key) },
      ).then((outcome) => {
        running.current.delete(key);
        finish(key, job, outcome);
      });
    },
    [finish, patch],
  );
  runRef.current = run;

  const enqueueSettle = useCallback(
    (order: Order, payload: SettleOrderInput, draft: SettleDraft) => {
      const key = order._id;
      // What "our settle landed" looks like — read off the very payload sent.
      const intent: SettleIntent = {
        payment: payload.payment,
        paidAmount: payload.paidAmount,
        splitCash: payload.splitCash,
        splitOnline: payload.splitOnline,
      };
      const label = order.tableNo ? `Table ${order.tableNo}` : order.orderId;
      // Synchronous, so a double tap cannot start a second settle of one tab.
      if (jobs.current.has(key)) {
        toast.info(`${label} is still settling — wait a moment.`);
        return false;
      }
      jobs.current.set(key, { label, intent, payload, draft });
      setWrites((all) => [...all, { key, label, state: "sending" }]);
      run(key);
      return true;
    },
    [run],
  );

  // Only an unanswered settle is retried; a refused one needs the tab looked at.
  const retry = useCallback(
    (key: string) => {
      if (writes.find((x) => x.key === key)?.state === "unknown") run(key);
    },
    [run, writes],
  );

  // Never forgets a write that is still being sent.
  const dismiss = useCallback(
    (key: string) => {
      if (!running.current.has(key)) drop(key);
    },
    [drop],
  );

  const value = useMemo<PendingWritesValue>(
    () => ({
      writes,
      backgroundReady: shouldRoute,
      enqueueSettle,
      isSettling: (orderId) => writes.some((w) => w.key === orderId && LIVE_STATES.has(w.state)),
      dismiss,
      retry,
      reopen,
      reopenRequest,
      clearReopenRequest: () => setReopenRequest(null),
    }),
    [writes, shouldRoute, enqueueSettle, dismiss, retry, reopen, reopenRequest],
  );

  return <PendingWritesContext.Provider value={value}>{children}</PendingWritesContext.Provider>;
}
