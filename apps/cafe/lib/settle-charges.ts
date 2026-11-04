import {
  DEFAULT_TABLE_CHARGE_LABEL,
  applyExtraCharges,
  withTableCharge,
  type OrderCharge,
} from "@pos/shared/order-charges";
import { sameTable } from "@/lib/settle-guard";

// The charges a RE-PRICING settle bills — ONE builder shared by the bill (lib/order.ts resolveSettleMoney) and the
// settle-time reward claim's minBill gate (lib/settle-reward.ts), so the gate can never read a different bill than the
// one charged (G2: the gate once read `chargeAmount ?? old.chargeAmount` with no extra lane). PURE: shared imports and
// the pure settle guard only.
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
  const tableChargeAmount = fenceTableChargeAmount(chargeAmount, tableEntry?.amount ?? 0) ?? tableEntry?.amount ?? 0;
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

// T1 (owner 2026-11-04): a sent `chargeAmount > 0` adjusts the table charge only while the TAB carries a saved table entry
// with an amount > 0 (the source the POS shows, hooks/use-pos-charge.ts; never the table's live setting). A move drops
// that entry when the destination has no charge, so an old client's stale amount cannot re-create a "Table charge" line;
// 0 (a waiver) and undefined (omitted) pass through untouched.
export function fenceTableChargeAmount(chargeAmount: number | undefined, tabTableAmount: number): number | undefined {
  return chargeAmount !== undefined && chargeAmount > 0 && tabTableAmount <= 0 ? 0 : chargeAmount;
}

// T1 echo (2026-11-05): a move made on ANOTHER device never reaches this POS before its next round, so its change to
// the old table's charge (lowered or waived) would land on the new table. The POS sends the table it held
// (`expectedTableNo`, null = a walk-in); once the tab sits elsewhere the change is dropped and the new table's own
// saved charge applies, exactly as the POS drops it on seeing the move (chargeOverrideAfterTabUpdate). The add-round
// uses this; a settle refuses instead (lib/settle-guard.ts), so the cashier sees the new bill before taking money.
// Omitted (a POS tab not reloaded since the deploy) = not checked.
export function chargeAmountSeenAt(
  chargeAmount: number | undefined,
  expectedTableNo: string | null | undefined,
  tabTableNo: string | null | undefined,
): number | undefined {
  return expectedTableNo !== undefined && !sameTable(expectedTableNo, tabTableNo) ? undefined : chargeAmount;
}
