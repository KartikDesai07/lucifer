"use client";

import { useMemo } from "react";
import { computeOrderTotals, gstConfigFromOrder, gstConfigOfSettings } from "@/lib/receipt";
import type { Order, Settings } from "@/types";

interface PosModalTotalsInput {
  resumedOrder: Order | null;
  discount: number;
  settings: Settings | undefined;
  paymentIntent: "pay" | "settle";
  // Live-cart totals, used verbatim on the "pay" (non-resumed) branch.
  subtotal: number;
  gstAmount: number;
  gstRate: number;
  total: number;
  count: number;
}

export interface PosModalTotals {
  subtotal: number;
  discount: number;
  gstAmount: number;
  gstRate?: number;
  total: number;
  itemCount: number;
  confirmLabel: string;
}

// The settle/pay modal's totals — extracted out of usePosTab to keep that file
// under the line budget. The settle branch is driven by the tab's stored ITEMS
// + its GST SNAPSHOT with the operator's live discount applied — i.e. exactly
// what the server will recompute and charge, so the modal can never disagree
// with the bill. The pay branch is driven by the live cart instead.
export function usePosModalTotals({
  resumedOrder,
  discount,
  settings,
  paymentIntent,
  subtotal,
  gstAmount,
  gstRate,
  total,
  count,
}: PosModalTotalsInput): PosModalTotals {
  const settleTotals = useMemo(
    () =>
      resumedOrder
        ? computeOrderTotals(
            resumedOrder.items,
            discount,
            gstConfigFromOrder(resumedOrder, gstConfigOfSettings(settings)),
          )
        : null,
    [resumedOrder, discount, settings],
  );

  const settling = paymentIntent === "settle" && resumedOrder && settleTotals;
  return settling
    ? {
        subtotal: settleTotals.subtotal,
        discount: settleTotals.discount,
        gstAmount: settleTotals.gstAmount,
        gstRate: resumedOrder.gstRate ?? gstRate,
        total: settleTotals.total,
        itemCount: resumedOrder.items.reduce((n, it) => n + it.qty, 0),
        confirmLabel: "Settle",
      }
    : {
        subtotal,
        discount,
        gstAmount,
        gstRate,
        total,
        itemCount: count,
        confirmLabel: "Place Order",
      };
}
