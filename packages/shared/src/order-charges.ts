// CB-CHG — typed charges[] on Order. Pure, client-safe (no Mongoose): the ONE
// place the charges[] invariants live, shared by the cafe's routes AND its
// client components. See .claude/plan/v2/cb-chg-typed-charges-plan.md.

export const ORDER_CHARGE_TYPES = ["table", "extra"] as const;
export type OrderChargeType = (typeof ORDER_CHARGE_TYPES)[number];

export interface OrderCharge {
  type: OrderChargeType; // "table" = the seat this bill is on; "extra" = staff-entered
  label: string; // what it prints as; never empty
  amount: number; // whole rupees, > 0
}

// The SAME fallback the two shipped renderers already print when a legacy
// order carries chargeAmount but no chargeLabel (OrderReceipt.tsx,
// OrderDetailSheet.tsx) — reused here so chargesFromOrder's upgrade-in-place
// never invents new paper text.
export const DEFAULT_TABLE_CHARGE_LABEL = "Table charge";

// Floors at 0 and rounds to a whole rupee — same rounding discipline as every
// other money path in this repo. Deliberately has NO upper ceiling: owner
// decision 8 (2026-09-25) — "hame hamari panel me aesi koi limitation nahi
// rakhni hai" — the new extra charge is uncapped and uncounted. Do NOT add a
// ceiling back here; the table's own admin bound (TABLE_CHARGE_MAX, a
// DIFFERENT, still-bounded config on Table) is untouched and unrelated.
export function clampChargeAmount(n: number): number {
  return Math.max(0, Math.round(n));
}

// The ONE place every charges[] invariant lives, so no writer has to
// re-derive them. Drops an entry whose amount<=0 or whose (trimmed) label is
// blank — this inherits tableChargeOf's shipped rule (amount gates the
// label), pinned at lib/go-live-runbook.test.ts:272. Keeps at most ONE
// type:"table" entry (a later duplicate is dropped — "replace, don't stack"
// is enforced by the writers via withTableCharge, this is just the backstop).
// Orders the table entry first, then extras in insertion order (print order
// = array order). Returns [] for nothing (never null/undefined) — the CALLER
// decides omit-empty at the storage boundary (chargeWriteFields). No cap on
// count or on an extra's amount (decision 8, see clampChargeAmount above).
export function normalizeCharges(input: readonly OrderCharge[]): OrderCharge[] {
  let sawTable = false;
  const extras: OrderCharge[] = [];
  let table: OrderCharge | undefined;
  for (const c of input) {
    const amount = clampChargeAmount(c.amount);
    const label = c.label.trim();
    if (amount <= 0 || !label) continue;
    if (c.type === "table") {
      if (sawTable) continue; // drop a second table entry
      sawTable = true;
      table = { type: "table", label, amount };
    } else {
      extras.push({ type: "extra", label, amount });
    }
  }
  return table ? [table, ...extras] : extras;
}

// Sum of every entry — what chargeAmount mirrors. No sum cap (decision 8):
// summing normalized (already-clamped) entries, so this never re-clamps.
export function chargesTotal(charges: readonly OrderCharge[]): number {
  return charges.reduce((sum, c) => sum + c.amount, 0);
}

// The two totals computeOrderTotals needs SEPARATELY, and the reason it needs
// them apart rather than as one number.
//
// `computeOrderTotals` clamps its TABLE charge at TABLE_CHARGE_MAX (10000) —
// a deliberate, shipped fence on an admin config that rides onto every bill of
// that table until someone changes it. Feeding the table+extras SUM through
// that one parameter would silently cap a legitimate bill (owner decision 8:
// the new extra charge has no limit), and — worse — the stored `total` would
// then disagree with the stored `charges[]`/`chargeAmount`, which chargeMirror
// does NOT clamp. A customer billed one figure while the record says another
// is a money defect, not a rounding detail.
//
// So the split is the contract: `table` stays clamped exactly as before (its
// pins are untouched), `extra` rides on top uncapped.
export function splitChargeTotals(charges: readonly OrderCharge[]): { table: number; extra: number } {
  let table = 0;
  let extra = 0;
  for (const c of charges) {
    if (c.type === "table") table += c.amount;
    else extra += c.amount;
  }
  return { table, extra };
}

// The legacy scalar pair (chargeAmount/chargeLabel) this array mirrors, so
// every existing reader (receipt, detail sheet, print-job snapshot, D10
// $group, receiptGst, public bill) keeps reading byte-identical output. Label
// prefers the table entry (the historical meaning of chargeLabel); falls back
// to the first entry so a takeaway-only bill still names ITS charge. An empty
// array yields amount 0 / label "" — the caller (chargeWriteFields) treats
// amount<=0 as "nothing" and $unsets rather than storing this shape.
export function chargeMirror(charges: readonly OrderCharge[]): { amount: number; label: string } {
  if (charges.length === 0) return { amount: 0, label: "" };
  const table = charges.find((c) => c.type === "table");
  const label = (table ?? charges[0]).label;
  return { amount: chargesTotal(charges), label };
}

// The compat READ path (plan §2) — never a migration, never rewrites a
// document we are not already rewriting (no M0 backups). A new order's truth
// is charges[]; a pre-CB-CHG order carries only the scalars, so this upgrades
// it in place, in memory, to the same one-entry shape a re-pricing writer
// would have produced, which is why lib/order-charges.test.ts pins its output
// as money-equivalent to computeOrderTotals over the raw scalar.
export function chargesFromOrder(
  order: { charges?: OrderCharge[]; chargeAmount?: number; chargeLabel?: string } | null | undefined,
): OrderCharge[] {
  if (order?.charges) return normalizeCharges(order.charges);
  if (order?.chargeAmount && order.chargeAmount > 0) {
    return [
      { type: "table", label: order.chargeLabel ?? DEFAULT_TABLE_CHARGE_LABEL, amount: order.chargeAmount },
    ];
  }
  return [];
}

// The fence for the `type:"table"` lane (plan §3): replaces or removes ONLY
// the table entry, and can never express "touch an extra" — that is what
// makes "a move must not destroy a takeaway charge" true by construction,
// not by convention. `tableCharge: null` means the destination charges
// nothing, so the table entry is dropped.
export function withTableCharge(
  charges: readonly OrderCharge[],
  tableCharge: { label: string; amount: number } | null,
): OrderCharge[] {
  const extras = charges.filter((c) => c.type === "extra");
  if (!tableCharge) return normalizeCharges(extras);
  return normalizeCharges([{ type: "table", label: tableCharge.label, amount: tableCharge.amount }, ...extras]);
}

// The reciprocal fence for the `type:"extra"` lane (plan §3): replaces the
// WHOLE extra set (decision 6 — extras save on Send/Settle, like today's
// charge waiver) and can never express "touch the table entry". Reciprocal
// to withTableCharge above — together they are the type-level guarantee that
// neither lane can clobber the other's entries.
export function applyExtraCharges(
  charges: readonly OrderCharge[],
  extras: readonly { label: string; amount: number }[],
): OrderCharge[] {
  const table = charges.filter((c) => c.type === "table");
  const newExtras: OrderCharge[] = extras.map((e) => ({ type: "extra", label: e.label, amount: e.amount }));
  return normalizeCharges([...table, ...newExtras]);
}
