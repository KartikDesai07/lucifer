import { chargeMirror, type OrderCharge } from "@pos/shared/order-charges";

// CB-CHG (plan §4) — the ONE server helper every money writer (create,
// add-round, settle, table-move) uses to turn a normalized charges[] into the
// exact Mongo update. Centralized so no writer re-derives the mirror or picks
// the wrong one of $set/$unset.
export interface ChargeWriteFields {
  set?: { charges: OrderCharge[]; chargeAmount: number; chargeLabel: string };
  unset?: { charges: ""; chargeAmount: ""; chargeLabel: "" };
}

// Entries present -> $set all three (charges[] + its derived mirror).
// None -> $unset all three, NEVER `chargeAmount: 0` — a named ₹0 line must
// never print, and a stored 0/"" would look like a real (if odd) charge to
// every reader that only checks `!== undefined`. $set/$unset stay mutually
// exclusive so a writer can spread exactly one branch into its update.
export function chargeWriteFields(charges: readonly OrderCharge[]): ChargeWriteFields {
  if (charges.length === 0) {
    return { unset: { charges: "", chargeAmount: "", chargeLabel: "" } };
  }
  const mirror = chargeMirror(charges);
  return {
    set: { charges: [...charges], chargeAmount: mirror.amount, chargeLabel: mirror.label },
  };
}
