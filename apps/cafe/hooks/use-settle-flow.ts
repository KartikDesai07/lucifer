"use client";

// Why a new file: nothing existing keeps a per-tab memory of an unanswered
// settle, and both settle screens (the POS, the Orders/Dashboard sheet) need
// the same one. The rules — one POST per tap, "Couldn't confirm" then a Check
// (one GET), never a resend — live in the pure controller lib/settle-flow.ts
// (runtime-tested in lib/settle-flow.test.ts); this hook only wires its ports
// to the API, the toasts and the query cache.
//
// useSyncExternalStore, not a mirrored useState: the controller owns the state
// outside React, and this is React's tear-free contract for subscribing to
// such a store; its snapshot is immutable, so noticeFor(id) keeps its identity
// for PaymentModal's memo.

import { useEffect, useInsertionEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiGet } from "@/lib/api-client";
import { settledMessage } from "@/lib/pending-writes";
import { printConfigOf } from "@/lib/print";
import { createSettleFlow, type SettleFlowHandlers } from "@/lib/settle-flow";
import { ORDER_KEYS, useSettleOrder } from "@/hooks/use-orders";
import { useSettings } from "@/hooks/use-settings";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { CUSTOMER_KEYS } from "@/hooks/use-customers";
import type { Order } from "@/types";

export type { SettleFlowHandlers };

export function useSettleFlow(handlers: SettleFlowHandlers, options: { printsBill?: boolean } = {}) {
  // Session 1C (R1): only a settle that prints the bill (the POS) lets the server make it.
  const settleOrder = useSettleOrder({ printsBill: options.printsBill === true });
  const qc = useQueryClient();
  const settings = useSettings();
  // Called after awaits: always the handlers, the POST and the settings of the latest commit.
  const handlersRef = useRef(handlers);
  const sendRef = useRef(settleOrder.mutateAsync);
  const settingsRef = useRef(settings.data);
  useInsertionEffect(() => {
    handlersRef.current = handlers;
    sendRef.current = settleOrder.mutateAsync;
    settingsRef.current = settings.data;
  });
  // One controller per mounted hook; its ports read the refs only when called.
  const [flow] = useState(() =>
    createSettleFlow({
      send: (id, data) => sendRef.current({ id, data }),
      read: (id) => apiGet<Order>(`/api/orders/${id}`),
      handlers: {
        onSettled: (order) => handlersRef.current.onSettled(order),
        onChanged: (order) => handlersRef.current.onChanged(order),
        onFinished: (order) => handlersRef.current.onFinished(order),
      },
      toastSettled: (order) => toast.success(settledMessage(order)),
      toastUnmounted: (notice) => toast.warning(`${notice.title}: ${notice.message}`),
      invalidate: () => {
        void qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
        void qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
        void qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
      },
      billNumbered: () => printConfigOf(settingsRef.current).bill.showNumber,
      now: () => Date.now(),
    }),
  );
  useEffect(() => flow.mount(), [flow]);
  const state = useSyncExternalStore(flow.subscribe, flow.getState, flow.getState);

  const noticeFor = (id: string) => state.notices.get(id) ?? null;

  return { busy: state.busy, noticeFor, submit: flow.submit, dismiss: flow.dismiss };
}
