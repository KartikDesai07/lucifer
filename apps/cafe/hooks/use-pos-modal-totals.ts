"use client";

import { useMemo } from "react";
import { computeOrderTotals, gstConfigFromOrder, gstConfigOfSettings } from "@/lib/receipt";
import type { Order, Settings } from "@/types";

interface PosModalTotalsInput {
  resumedOrder: Order | null;
  discount: number;
  // The operator's deliberate override, if any. `undefined` = untouched, so the
  // tab's snapshotted charge stands — matching what the settle route does with
  // an omitted chargeAmount.
  chargeOverride: number | undefined;
  // The resolved charge + its name, used verbatim on the "pay" branch the same
  // way the other live-cart figures are.
  charge: number;
  chargeLabel: string;
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
  charge: number;
  chargeLabel: string;
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
  chargeOverride,
  charge,
  chargeLabel,
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
        ? computeOrderTotals({
            items: resumedOrder.items,
            discount,
            // The tab's own snapshotted charge, so the modal shows exactly the
            // figure the server will re-derive when it settles.
            charge: chargeOverride ?? resumedOrder.chargeAmount ?? 0,
            cfg: gstConfigFromOrder(resumedOrder, gstConfigOfSettings(settings)),
          })
        : null,
    [resumedOrder, discount, chargeOverride, settings],
  );

  const settling = paymentIntent === "settle" && resumedOrder && settleTotals;
  return settling
    ? {
        subtotal: settleTotals.subtotal,
        discount: settleTotals.discount,
        gstAmount: settleTotals.gstAmount,
        gstRate: resumedOrder.gstRate ?? gstRate,
        charge: settleTotals.charge,
        // The tab's own snapshotted name — the table may have been renamed or
        // re-priced since this tab opened, and the bill keeps what it sold.
        chargeLabel: resumedOrder.chargeLabel ?? chargeLabel,
        total: settleTotals.total,
        itemCount: resumedOrder.items.reduce((n, it) => n + it.qty, 0),
        confirmLabel: "Settle",
      }
    : {
        subtotal,
        discount,
        gstAmount,
        gstRate,
        charge,
        chargeLabel,
        total,
        itemCount: count,
        confirmLabel: "Place Order",
      };
}
