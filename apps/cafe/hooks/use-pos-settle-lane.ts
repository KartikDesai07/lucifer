"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { apiGet } from "@/lib/api-client";
import { usePendingWrites, type SettleDraft } from "@/components/layout/PendingWritesProvider";
import type { Order } from "@/types";

// The POS tab's side of background settling (components/layout/
// PendingWritesProvider.tsx): the guard that keeps a still-settling tab from
// being resumed, and the "Reopen tab" hand-off after a settle failed — the tab
// is read FRESH from the server (it may have changed since) and resumed
// through the POS's own requestResume (so an unsent cart still gets its
// "discard?" confirm), and once it is actually open, what the operator had set
// at settle time (discount, charges, customer) is put back so they only have
// to press Settle again. Kept out of use-pos-tab.ts, which is already over the
// file-size budget.

interface SettleLaneArgs {
  /** The POS's requestResume — confirms first when unsent items would be lost. */
  resume: (order: Order) => void;
  applyDraft: (draft: SettleDraft) => void;
  /** Changes whenever the POS moves on (another tab opened, the cart changed). */
  activity: string;
}

export function usePosSettleLane({ resume, applyDraft, activity }: SettleLaneArgs) {
  const lane = usePendingWrites();
  const { reopenRequest, clearReopenRequest } = lane;

  // The callbacks are rebuilt every render; the effect below must call the
  // CURRENT ones without re-running on every render.
  const latest = useRef({ resume, applyDraft });
  latest.current = { resume, applyDraft };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The draft waiting for its tab to actually open (the resume may first ask
  // to discard an unsent cart, and may be cancelled).
  const pendingDraft = useRef<{ orderId: string; draft: SettleDraft } | null>(null);
  // Bumped on every change of `activity` (declared BEFORE the reopen effect so
  // a mount counts first). A reopen whose read comes back after the operator
  // moved on is dropped — it must never swap the tab they are now working on
  // off the screen. Nothing is lost: the alert stays until the tab is opened.
  const activityGen = useRef(0);
  useEffect(() => {
    activityGen.current += 1;
  }, [activity]);

  useEffect(() => {
    if (!reopenRequest) return;
    const { orderId, draft } = reopenRequest;
    clearReopenRequest();
    const gen = activityGen.current;
    apiGet<Order>(`/api/orders/${orderId}`).then(
      (order) => {
        if (!mounted.current || activityGen.current !== gen) return;
        if (order.status !== "Pending") {
          toast.info(`That tab is no longer open — it is ${order.status.toLowerCase()}.`);
          return;
        }
        pendingDraft.current = { orderId: order._id, draft };
        latest.current.resume(order);
      },
      () => {
        if (mounted.current) toast.error("Could not reopen the tab — open it from Open tabs.");
      },
    );
  }, [reopenRequest, clearReopenRequest]);

  /** False (with a toast) while this tab's settle is still being sent. A tab
   *  whose settle FAILED may be resumed — opening it resolves its alert. */
  const mayResume = (order: Order): boolean => {
    if (!lane.isSettling(order._id)) return true;
    toast.info(`${order.tableNo ? `Table ${order.tableNo}` : order.orderId} is still settling — wait a moment.`);
    return false;
  };

  /** Called once a tab is actually open on the POS. */
  const resumed = (order: Order) => {
    lane.dismiss(order._id);
    const waiting = pendingDraft.current;
    pendingDraft.current = null;
    if (waiting?.orderId === order._id) latest.current.applyDraft(waiting.draft);
  };

  /** The operator kept their unsent cart instead — the alert stays, the draft goes. */
  const resumeCancelled = () => {
    pendingDraft.current = null;
  };

  return {
    backgroundReady: lane.backgroundReady,
    enqueueSettle: lane.enqueueSettle,
    mayResume,
    resumed,
    resumeCancelled,
  };
}
