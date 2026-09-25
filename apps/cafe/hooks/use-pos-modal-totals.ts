"use client";

import { useMemo } from "react";
import { computeOrderTotals, gstConfigFromOrder, gstConfigOfSettings } from "@/lib/receipt";
import type { DiscountKind } from "@/lib/constants";
import { chargesFromOrder, chargesTotal, type OrderCharge } from "@pos/shared/order-charges";
import type { Order, Settings } from "@/types";

interface PosModalTotalsInput {
  resumedOrder: Order | null;
  discount: number;
  // The operator's CURRENT intent (from the unit) — the settle branch re-derives
  // against the tab's snapshot exactly as the settle route will.
  discountKind: DiscountKind | undefined;
  // The operator's deliberate override, if any. `undefined` = untouched, so the
  // tab's snapshotted charge stands — matching what the settle route does with
  // an omitted chargeAmount.
  chargeOverride: number | undefined;
  // The resolved charge + its name, used verbatim on the "pay" branch the same
  // way the other live-cart figures are.
  charge: number;
  chargeLabel: string;
  // CB-CHG — the live cart's extras (label/amount only), used verbatim on the
  // "pay" branch, same as `charge` above.
  extraCharges: { label: string; amount: number }[];
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
  discountKind?: DiscountKind;
  gstAmount: number;
  gstRate?: number;
  charge: number;
  chargeLabel: string;
  // CB-CHG — every charge line (table + extras), so the modal can itemise
  // instead of showing one folded figure. Empty on a legacy tab with neither.
  charges: OrderCharge[];
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
  discountKind,
  chargeOverride,
  charge,
  chargeLabel,
  extraCharges,
  settings,
  paymentIntent,
  subtotal,
  gstAmount,
  gstRate,
  total,
  count,
}: PosModalTotalsInput): PosModalTotals {
  // CB-CHG — the tab's own extras (the operator's live cart carries the
  // authoritative set once touched; chargesFromOrder is only the READ path
  // for what the server already stored). Extras ride on TOP of
  // computeOrderTotals' single-scalar `charge`, uncapped (decision 8) — that
  // function's own clamp is the TABLE charge's bound and must not also cap
  // the extras' sum, so they are added here instead of folded into the
  // argument.
  const settleExtrasTotal = useMemo(
    () => chargesTotal(chargesFromOrder(resumedOrder).filter((c) => c.type === "extra")),
    [resumedOrder],
  );

  const settleTotals = useMemo(
    () =>
      resumedOrder
        ? computeOrderTotals({
            items: resumedOrder.items,
            discount,
            discountKind,
            // The tab's own snapshotted charge, so the modal shows exactly the
            // figure the server will re-derive when it settles.
            charge: chargeOverride ?? resumedOrder.chargeAmount ?? 0,
            cfg: gstConfigFromOrder(resumedOrder, gstConfigOfSettings(settings)),
          })
        : null,
    [resumedOrder, discount, discountKind, chargeOverride, settings],
  );

  const settling = paymentIntent === "settle" && resumedOrder && settleTotals;
  if (settling) {
    // The tab's own snapshotted table entry (chargeOverride wins if the
    // operator touched it this session — same precedence computeOrderTotals
    // was just called with) plus its extras, itemised for the modal.
    const tableEntry: OrderCharge | null =
      settleTotals.charge > 0
        ? { type: "table", label: resumedOrder.chargeLabel ?? chargeLabel, amount: settleTotals.charge }
        : null;
    const extraEntries = chargesFromOrder(resumedOrder).filter((c) => c.type === "extra");
    return {
      subtotal: settleTotals.subtotal,
      discount: settleTotals.discount,
      discountKind,
      gstAmount: settleTotals.gstAmount,
      gstRate: resumedOrder.gstRate ?? gstRate,
      charge: settleTotals.charge + settleExtrasTotal,
      // The tab's own snapshotted name — the table may have been renamed or
      // re-priced since this tab opened, and the bill keeps what it sold.
      chargeLabel: resumedOrder.chargeLabel ?? chargeLabel,
      charges: tableEntry ? [tableEntry, ...extraEntries] : extraEntries,
      total: settleTotals.total + settleExtrasTotal,
      itemCount: resumedOrder.items.reduce((n, it) => n + it.qty, 0),
      confirmLabel: "Settle",
    };
  }

  const payExtraEntries: OrderCharge[] = extraCharges.map((e) => ({
    type: "extra",
    label: e.label,
    amount: e.amount,
  }));
  const payTableEntry: OrderCharge | null = charge > 0 ? { type: "table", label: chargeLabel, amount: charge } : null;
  return {
    subtotal,
    discount,
    discountKind,
    gstAmount,
    gstRate,
    charge,
    chargeLabel,
    charges: payTableEntry ? [payTableEntry, ...payExtraEntries] : payExtraEntries,
    total,
    itemCount: count,
    confirmLabel: "Place Order",
  };
}
