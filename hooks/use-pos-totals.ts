"use client";

import { useMemo } from "react";
import { computeExclusiveGst, type GstConfig } from "@/lib/receipt";
import type { DiscountUnit } from "@/components/pos/Cart";
import type { Settings } from "@/types";

interface PosTotalsInput {
  subtotal: number;
  discountRaw: number; // raw value the user typed (₹ amount or %)
  discountUnit: DiscountUnit;
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

  const gstCfg: GstConfig = useMemo(
    () => ({
      gstEnabled: settings?.gstEnabled ?? false,
      gstRate: settings?.gstRate ?? 0,
      gstMode: settings?.gstMode ?? "inclusive",
    }),
    [settings],
  );

  // Taxable base, then GST added on top in exclusive mode (inclusive adds 0).
  const base = Math.max(0, subtotal - discount);
  const gstAmount = computeExclusiveGst(base, gstCfg);

  return { discount, gstAmount, gstRate: gstCfg.gstRate, total: base + gstAmount };
}
