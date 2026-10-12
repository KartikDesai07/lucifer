import {
  DEFAULT_TABLE_CHARGE_LABEL,
  applyExtraCharges,
  withTableCharge,
  type OrderCharge,
} from "@pos/shared/order-charges";

// The charges a RE-PRICING settle bills — ONE builder shared by the bill (lib/order.ts resolveSettleMoney) and the
// settle-time reward claim's minBill gate (lib/settle-reward.ts), so the gate can never read a different bill than the
// one charged (G2: the gate once read `chargeAmount ?? old.chargeAmount` with no extra lane). PURE: shared imports only.
//
// The two lanes apply through their own fences so neither clobbers the other: the TABLE entry's amount from the settle
// body's `chargeAmount` (absent = the stored table entry), the extras from its `extraCharges` (absent = the stored
// extras; present = replace the whole set, CB-CHG decision 6).
export function settleCharges(
  baseCharges: readonly OrderCharge[],
  chargeAmount: number | undefined,
  extraCharges: readonly { label: string; amount: number }[] | undefined,
): OrderCharge[] {
  const tableEntry = baseCharges.find((c) => c.type === "table");
  const tableChargeAmount = chargeAmount ?? tableEntry?.amount ?? 0;
  return applyExtraCharges(
    withTableCharge(
      baseCharges,
      tableChargeAmount > 0
        ? { label: tableEntry?.label ?? DEFAULT_TABLE_CHARGE_LABEL, amount: tableChargeAmount }
        : null,
    ),
    extraCharges ?? baseCharges.filter((c) => c.type === "extra"),
  );
}
