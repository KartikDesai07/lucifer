import { inr } from "@pos/shared/utils";
import {
  chargesFromOrder,
  chargesTotal,
  withTableCharge,
  type OrderCharge,
} from "@pos/shared/order-charges";
import { tableChargeOf } from "@/lib/receipt";

// CB-CHG — the money PREVIEW behind the move-table confirm step, split out of
// MoveTableDialog.tsx so it is pure (no React, no fetch) and unit-testable:
// this is the figure a staff member reads before agreeing to change a live
// bill, so it must be pinned, not eyeballed.
//
// It deliberately reuses the SAME helpers the server-side writer uses
// (chargesFromOrder / withTableCharge / chargesTotal), so client and server can
// never disagree about WHICH entry changes — only, possibly, about its exact
// figure when the 30s tables cache is stale. That is exactly what "preview"
// means here: the server re-reads the destination table and is authoritative.
//
// Extras are never touched by a move (withTableCharge's fence), so the delta is
// driven entirely by the table entry, and because a charge sits outside both
// GST and the discount, no other figure on the bill moves with it.

export interface MoveChargePreview {
  /** The bill total after the move, previewed. */
  total: number;
  /** The table-charge entry the bill carries now (absent when it has none). */
  from: OrderCharge | undefined;
  /** The table-charge entry it would carry after the move. */
  to: OrderCharge | undefined;
  /**
   * One plain-English sentence naming the money change for the operator, or
   * null when there is nothing to say — a destination (or unseat) with no
   * table charge configured either side. Callers must not show a ₹0 line in
   * that case; they show nothing instead.
   */
  note: string | null;
}

type PreviewOrder =
  | (NonNullable<Parameters<typeof chargesFromOrder>[0]> & { total?: number })
  | null
  | undefined;
type PreviewTable = { chargeAmount?: number; chargeLabel?: string } | null | undefined;

export function moveChargePreview(order: PreviewOrder, destination: PreviewTable): MoveChargePreview {
  const currentCharges = chargesFromOrder(order);
  // Always run through withTableCharge, including destination === null/
  // undefined — that is the UNSEAT preview (assign/move's opposite: leaving a
  // table rather than claiming one), and tableChargeOf(null) -> NO_TABLE_CHARGE
  // ({amount:0, label:""}) is exactly the "drop the table entry" input
  // withTableCharge/normalizeCharges already handle: a zero-amount/blank-label
  // entry never survives the normalize pass. No separate branch needed.
  const nextCharges = withTableCharge(currentCharges, tableChargeOf(destination));

  const from = currentCharges.find((c) => c.type === "table");
  const to = nextCharges.find((c) => c.type === "table");
  const total =
    (order?.total ?? 0) - chargesTotal(currentCharges) + chargesTotal(nextCharges);

  return { total, from, to, note: chargeChangeNote(from, to) };
}

/**
 * The operator-facing sentence. Plain English, no Hinglish, no emoji. Null
 * when neither side carries a table charge — a ₹0 line would be noise, not
 * information, so the caller shows nothing at all instead.
 */
export function chargeChangeNote(
  from: OrderCharge | undefined,
  to: OrderCharge | undefined,
): string | null {
  if (!from && to) return `Adds the ${to.label} of ${inr(to.amount)} to the bill.`;
  if (from && !to) return `Removes the ${from.label} of ${inr(from.amount)} from the bill.`;
  if (from && to) return `The charge stays the same: ${to.label}, ${inr(to.amount)}.`;
  return null;
}
