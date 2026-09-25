"use client";

import { useMemo } from "react";
import {
  computeExclusiveGst,
  gstConfigOfSettings,
  gstEquivalentDiscount,
  rewardDiscountAmount,
  type GstConfig,
} from "@/lib/receipt";
import type { RedeemedReward } from "@pos/shared/reward-redemption";
import { chargesTotal, type OrderCharge } from "@pos/shared/order-charges";
import { TABLE_CHARGE_MAX } from "@/lib/constants";
import type { DiscountUnit } from "@/components/pos/Cart";
import type { Settings } from "@/types";

interface PosTotalsInput {
  subtotal: number;
  discountRaw: number; // raw value the user typed (₹ amount or %)
  discountUnit: DiscountUnit;
  charge: number; // the table's own charge for this bill, already resolved
  // CB-CHG — the staff-entered extras, ADDED ON TOP of the table charge.
  // Deliberately NOT folded into `charge` above and NOT run through
  // TABLE_CHARGE_MAX below: that clamp is the TABLE's own admin bound (a
  // different, still-bounded config) and owner decision 8 (2026-09-25) is
  // that an extra has no cap on amount or count. Defaults to [] so every
  // existing caller (none of whom know about extras yet) keeps behaving
  // exactly as before.
  extraCharges?: OrderCharge[];
  settings: Settings | undefined; // live restaurant/GST settings
  // CB-5B S9 — the rung the counter has SELECTED, if any. A reward is the third
  // server-derived discount source alongside the GST preset, so the cart must
  // preview it exactly the way computeOrderTotals will price it. Without this,
  // picking a Rs 100 reward left the cart, the mobile bar and the payment modal
  // all showing the UNDISCOUNTED total while the server stored the discounted
  // one — staff collected the higher figure against a bill that recorded the
  // lower, and a Split payment could not be placed at all (the modal enforces
  // splitCash+splitOnline === its own total, which the server then rejected).
  // Still a PREVIEW only: the claim on the wire is the rung's `at` (intent),
  // and the server re-resolves value/kind/cost from Settings + the customer's
  // own row. Nothing here is ever sent.
  reward?: RedeemedReward;
}

export interface PosTotals {
  discount: number; // resolved flat discount, clamped to [0, subtotal]
  gstAmount: number; // GST added on top in exclusive mode (0 otherwise)
  gstRate: number; // rate in effect (for receipt/payment display)
  gstEnabled: boolean; // the live GST config would tax this bill — drives the GST Discount button's visibility
  total: number; // amount payable
}

// Derives the live bill figures for the POS terminal: clamps the discount, then
// applies the configured GST. Kept out of the page component so the pricing math
// is testable and the terminal stays presentation-only. The GST preset
// re-derives live on every cart change — Cart gains no arithmetic.
export function usePosTotals({
  subtotal,
  discountRaw,
  discountUnit,
  charge,
  extraCharges = [],
  settings,
  reward,
}: PosTotalsInput): PosTotals {
  const gstCfg: GstConfig = useMemo(() => gstConfigOfSettings(settings), [settings]);

  const discount = useMemo(() => {
    if (subtotal === 0) return 0;
    // Mirrors computeOrderTotals' rawDiscount ladder in the SAME order
    // (lib/receipt.ts): a reward first, because a claimed rung REPLACES the
    // discountKind server-side and the two are mutually exclusive (A2/D6); then
    // the GST preset; then the operator's manual figure. Both server-derived
    // arms call the shared derivation rather than re-implementing it, so the
    // preview cannot drift from what the bill will actually say. An `item`
    // reward correctly derives 0 here — its benefit is the free LINE, which the
    // server appends and excludes from the subtotal, so the local cart's
    // subtotal is already the right base.
    if (reward) {
      return Math.min(rewardDiscountAmount(subtotal, reward), subtotal);
    }
    if (discountUnit === "GST") return gstEquivalentDiscount(subtotal, gstCfg);
    const amount =
      discountUnit === "%"
        ? Math.round((subtotal * discountRaw) / 100)
        : discountRaw;
    return Math.min(Math.max(0, amount), subtotal);
  }, [discountRaw, discountUnit, subtotal, gstCfg, reward]);

  // Taxable base, then GST added on top in exclusive mode (inclusive adds 0).
  // The table charge lands AFTER tax and outside the discount — it is not part
  // of the taxable base (owner decision) and a percentage off the food is not a
  // percentage off the cover charge. Mirrors lib/receipt.computeOrderTotals,
  // which is what the server will actually charge.
  const base = Math.max(0, subtotal - discount);
  const gstAmount = computeExclusiveGst(base, gstCfg);
  const clampedCharge = Math.min(Math.max(0, Math.round(charge)), TABLE_CHARGE_MAX);
  // The extras' sum rides on top, uncapped (decision 8) — chargesTotal never
  // re-clamps a normalized entry, and normalizeCharges itself has no ceiling.
  const extrasTotal = chargesTotal(extraCharges);

  return {
    discount,
    gstAmount,
    gstRate: gstCfg.gstRate,
    gstEnabled: gstCfg.gstEnabled && gstCfg.gstRate > 0,
    total: base + gstAmount + clampedCharge + extrasTotal,
  };
}
