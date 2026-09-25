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
  /** One plain-English sentence naming the money change for the operator. */
  note: string;
}

type PreviewOrder =
  | (NonNullable<Parameters<typeof chargesFromOrder>[0]> & { total?: number })
  | null
  | undefined;
type PreviewTable = { chargeAmount?: number; chargeLabel?: string } | null | undefined;

export function moveChargePreview(order: PreviewOrder, destination: PreviewTable): MoveChargePreview {
  const currentCharges = chargesFromOrder(order);
  // tableChargeOf(null) -> NO_TABLE_CHARGE ({amount:0, label:""}), and
  // withTableCharge's normalizeCharges pass drops a zero-amount/blank-label
  // entry anyway — so no separate null-check is needed for "no destination".
  const nextCharges = destination
    ? withTableCharge(currentCharges, tableChargeOf(destination))
    : currentCharges;

  const from = currentCharges.find((c) => c.type === "table");
  const to = nextCharges.find((c) => c.type === "table");
  const total =
    (order?.total ?? 0) - chargesTotal(currentCharges) + chargesTotal(nextCharges);

  return { total, from, to, note: chargeChangeNote(from, to) };
}

/** The operator-facing sentence. Plain English, no Hinglish, no emoji. */
export function chargeChangeNote(
  from: OrderCharge | undefined,
  to: OrderCharge | undefined,
): string {
  if (!from && to) return `This table adds ${to.label} of ${inr(to.amount)} to the bill.`;
  if (from && !to) return `Moving here removes the ${from.label} of ${inr(from.amount)} from the bill.`;
  if (from && to) return `The charge stays the same: ${to.label}, ${inr(to.amount)}.`;
  return "No charge change.";
}
