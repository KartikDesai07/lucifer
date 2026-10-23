"use client";

import { useRef, useState } from "react";

import { useCancelOrder } from "@/hooks/use-orders";
import { cancelSheet, type CancelSheet } from "@/lib/orders-cancel-sheet";
import type { Order } from "@/types";

export interface CancelSheetState extends CancelSheet {
  /** The order the cancel sheet is open for (null: closed). */
  order: Order | null;
  /** The cancel request is in flight (the dialog's spinner and its disabled field and buttons). */
  isPending: boolean;
}

// The Orders page's cancel sheet (admins; Ruling P6; U2 final fix wave): the rules are lib/orders-cancel-sheet.ts's,
// tested there; this holds the sheet's order twice — in state for the render, and in a ref the request's success reads
// after its await (a render's value is stale by then) — and hands today's request (useCancelOrder: its toasts and
// invalidations) and the page's setDetail (`choose`) to the controller.
export function useCancelSheet(choose: (order: Order) => void): CancelSheetState {
  const cancelOrder = useCancelOrder();
  const [order, setOrder] = useState<Order | null>(null);
  const openFor = useRef<Order | null>(null);
  const sheet = cancelSheet({
    openFor: () => openFor.current,
    setOpenFor: (o) => {
      openFor.current = o;
      setOrder(o);
    },
    pending: () => cancelOrder.isPending,
    send: (id, reason) => cancelOrder.mutateAsync({ id, data: { reason } }),
    choose,
  });
  return { ...sheet, order, isPending: cancelOrder.isPending };
}
