"use client";

import { useMemo } from "react";
import { computeExclusiveGst, gstConfigOfSettings, type GstConfig } from "@/lib/receipt";
import { TABLE_CHARGE_MAX } from "@/lib/constants";
import type { DiscountUnit } from "@/components/pos/Cart";
import type { Settings } from "@/types";

interface PosTotalsInput {
  subtotal: number;
  discountRaw: number; // raw value the user typed (₹ amount or %)
  discountUnit: DiscountUnit;
  charge: number; // the table's extra charge for this bill, already resolved
  settings: Settings | undefined; // live restaurant/GST settings
}

export interface PosTotals {
  discount: number; // resolved flat discount, clamped to [0, subtotal]
  gstAmount: number; // GST added on top in exclusive mode (0 otherwise)
  gstRate: number; // rate in effect (for receipt/payment display)
  total: number; // amount payable
}

// Derives the live bill figures for the POS terminal: clamps the discount, then
// applies the configured GST. Kept out of the page component so the pricing math
// is testable and the terminal stays presentation-only.
export function usePosTotals({
  subtotal,
  discountRaw,
  discountUnit,
  charge,
  settings,
}: PosTotalsInput): PosTotals {
  const discount = useMemo(() => {
    if (subtotal === 0) return 0;
    const amount =
      discountUnit === "%"
        ? Math.round((subtotal * discountRaw) / 100)
        : discountRaw;
    return Math.min(Math.max(0, amount), subtotal);
  }, [discountRaw, discountUnit, subtotal]);

  const gstCfg: GstConfig = useMemo(() => gstConfigOfSettings(settings), [settings]);

  // Taxable base, then GST added on top in exclusive mode (inclusive adds 0).
  // The table charge lands AFTER tax and outside the discount — it is not part
  // of the taxable base (owner decision) and a percentage off the food is not a
  // percentage off the cover charge. Mirrors lib/receipt.computeOrderTotals,
  // which is what the server will actually charge.
  const base = Math.max(0, subtotal - discount);
  const gstAmount = computeExclusiveGst(base, gstCfg);
  const clampedCharge = Math.min(Math.max(0, Math.round(charge)), TABLE_CHARGE_MAX);

  return {
    discount,
    gstAmount,
    gstRate: gstCfg.gstRate,
    total: base + gstAmount + clampedCharge,
  };
}
