import mongoose from "mongoose";
import { Customer } from "@/models/Customer";
import { type PaymentMode, type GstMode, type OrderStatus, type DiscountKind } from "@/lib/constants";
import {
  type GstConfig,
  type OrderTotals,
  computeOrderTotals,
  gstConfigFromOrder,
  resolveDiscountKind,
} from "@/lib/receipt";
import type { RedeemedReward } from "@pos/shared/reward-redemption";
import {
  chargesFromOrder,
  splitChargeTotals,
  withTableCharge,
  applyExtraCharges,
  DEFAULT_TABLE_CHARGE_LABEL,
  type OrderCharge,
} from "@pos/shared/order-charges";

// Server-only order-domain helpers: payment derivation, the customer-ledger
// contribution model, ledger reconciliation, and settle-time money resolution.
// Imported by the order API routes only (pulls in the Customer model + mongoose).

// ── Payment derivation ───────────────────────────────────────────────────────
// Server-authoritative payment fields, validated against a known total. The
// client may assert what it COLLECTED, never what the bill is worth: paidAmount
// is clamped to the server's own total, and the mode still decides the rest.

export type PaymentDerivation =
  | { paidAmount: number; splitCash?: number; splitOnline?: number }
  | { error: string };

export function derivePayment(
  payment: PaymentMode,
  total: number,
  splitCash?: number,
  splitOnline?: number,
  paidAmount?: number,
): PaymentDerivation {
  // Held open tab — fired to the kitchen, nothing collected yet.
  if (payment === "Unpaid") return { paidAmount: 0 };
  // Due/Credit: nothing collected now — the full total becomes the customer's due.
  if (payment === "Due" || payment === "Credit") return { paidAmount: 0 };
  if (payment === "Split") {
    const cash = Math.max(0, Math.round(splitCash ?? 0));
    const online = Math.max(0, Math.round(splitOnline ?? 0));
    if (cash + online !== total) {
      return { error: "Split cash + online must equal the total" };
    }
    // Split ignores paidAmount — a split settle is always exact-total; partial
    // payment is not a thing a split can represent.
    return { paidAmount: total, splitCash: cash, splitOnline: online };
  }
  // Cash / Online: the client may assert what was actually COLLECTED (undefined
  // still means "paid in full", unchanged). The server clamps it to the total —
  // cash tendered above the bill is CHANGE, not revenue.
  if (paidAmount === undefined) return { paidAmount: total };
  return { paidAmount: Math.min(Math.max(0, Math.round(paidAmount)), total) };
}

// ── Customer-ledger contribution model ───────────────────────────────────────
// What a single order contributes to its customer's ledger. A held "Unpaid"
// open tab contributes NOTHING (it is neither a realized sale nor a receivable
// until it's settled); a CANCELLED order likewise contributes nothing (it stays
// in the ledger as a record, but it is not a sale); every other order contributes
// one visit, its full total as spend, and any unpaid balance as a due. The whole
// create/edit/delete/settle/cancel ledger math is expressed as deltas of this one
// function, so held → settle applies the full effect exactly once at settlement,
// and settled → cancelled reverses exactly that effect (CR1.3) — the same
// mechanism a delete uses, without destroying the row.

export interface LedgerContribution {
  visits: number;
  spend: number;
  due: number;
}

const ZERO_CONTRIBUTION: LedgerContribution = { visits: 0, spend: 0, due: 0 };

export function ledgerContribution(order: {
  payment: PaymentMode;
  total: number;
  paidAmount: number;
  status: OrderStatus;
}): LedgerContribution {
  if (order.status === "Cancelled") return { ...ZERO_CONTRIBUTION };
  if (order.payment === "Unpaid") return { ...ZERO_CONTRIBUTION };
  return {
    visits: 1,
    spend: order.total,
    due: Math.max(0, order.total - order.paidAmount),
  };
}

export const validCustomer = (id?: string | mongoose.Types.ObjectId) =>
  id && mongoose.isValidObjectId(id) ? String(id) : null;

// Floor ledger counters at 0 so a reconciliation delta (edit/delete/settle/retry)
// can never leave a customer with negative dues/spend/visits that persist forever.
export async function clampLedger(customerId: string) {
  await Customer.updateOne({ _id: customerId }, [
    {
      $set: {
        visits: { $max: [0, "$visits"] },
        totalSpend: { $max: [0, "$totalSpend"] },
        totalDue: { $max: [0, "$totalDue"] },
      },
    },
  ]);
}

type LedgerOrder = {
  customerId?: string | mongoose.Types.ObjectId;
  payment: PaymentMode;
  total: number;
  paidAmount: number;
  status: OrderStatus;
};

// Reconcile the customer ledger when an order changes from `old` to `updated`
// (pass `updated: null` for a delete — the order's contribution is reversed).
// Applies `contribution(updated) − contribution(old)`, handling the case where
// the order moves between customers. Returns the touched customer ids so the
// caller can invalidate the customers cache. Best-effort, mirrors the prior
// inline logic in app/api/orders/[id]/route.ts.
export async function reconcileLedger(
  old: LedgerOrder,
  updated: LedgerOrder | null,
): Promise<Set<string>> {
  const oldCust = validCustomer(old.customerId);
  const newCust = updated ? validCustomer(updated.customerId) : null;
  const oldC = ledgerContribution(old);
  const newC = updated ? ledgerContribution(updated) : { ...ZERO_CONTRIBUTION };
  const touched = new Set<string>();

  if (oldCust && oldCust === newCust) {
    const visits = newC.visits - oldC.visits;
    const totalSpend = newC.spend - oldC.spend;
    const totalDue = newC.due - oldC.due;
    if (visits !== 0 || totalSpend !== 0 || totalDue !== 0) {
      await Customer.findByIdAndUpdate(oldCust, {
        $inc: { visits, totalSpend, totalDue },
      });
      touched.add(oldCust);
    }
  } else {
    if (oldCust) {
      await Customer.findByIdAndUpdate(oldCust, {
        $inc: { visits: -oldC.visits, totalSpend: -oldC.spend, totalDue: -oldC.due },
      });
      touched.add(oldCust);
    }
    if (newCust) {
      await Customer.findByIdAndUpdate(newCust, {
        $inc: { visits: newC.visits, totalSpend: newC.spend, totalDue: newC.due },
      });
      touched.add(newCust);
    }
  }

  if (touched.size) await Promise.all([...touched].map(clampLedger));
  return touched;
}

// ── Settle-time money resolution ─────────────────────────────────────────────
// Everything a settle needs to decide what's charged and what's collected, in
// one pure function so the route stays a thin orchestrator. Handles both the
// unchanged path (no settle-time discount — Orders-page settle) and the new
// discounted/partial-payment path (POS settle) with the same formula.

export interface SettleMoneyInput {
  order: {
    // `reward?: boolean` per line — CB-5B: a reward line must ride through to
    // computeOrderTotals with its flag intact, or the subtotal reducer there
    // has no way to skip it (the untotalled/untaxed mechanism, lib/receipt.ts).
    items: ReadonlyArray<{ price: number; qty: number; reward?: boolean }>;
    total: number;
    discount: number;
    discountKind?: DiscountKind;
    gstRate?: number;
    gstMode?: GstMode;
    chargeAmount?: number;
    // CB-CHG — the typed charge lines, source of truth when present;
    // chargesFromOrder derives the legacy equivalent when absent (upgrade in
    // place, money-neutral by construction).
    charges?: OrderCharge[];
  };
  payment: PaymentMode;
  discount?: number;
  // undefined = leave the tab's kind alone (the Orders-page settle path never
  // sends it); null = the operator switched back to a manual discount; "gst" =
  // the preset — then `discount` is ignored and re-derived from the tab's own
  // items + GST snapshot. Mirrors `chargeAmount`'s treatment above.
  discountKind?: DiscountKind | null;
  // Settle-time waiver/adjustment of the TABLE entry's amount only. Undefined
  // means "leave the tab's table charge alone" — NOT "no charge" — so a
  // settle path that knows nothing about charges cannot drop one off a bill.
  chargeAmount?: number;
  // CB-CHG — the staff-entered extra set (decision 6: extras save on Send/
  // Settle). Present = replace the whole extra set; absent = unchanged.
  extraCharges?: readonly { label: string; amount: number }[];
  paidAmount?: number;
  splitCash?: number;
  splitOnline?: number;
  liveGst: GstConfig;
  // CB-5B S5 — the milestone claimed AT settle time (a non-item reward only;
  // D9 refuses an item reward here). Passed straight through to
  // computeOrderTotals, same as `charge`/`discountKind` above: the route
  // resolves the claim (it needs the DB), this function stays pure.
  reward?: RedeemedReward;
}

export type SettleMoney =
  | {
      total: number;
      paidAmount: number;
      splitCash?: number;
      splitOnline?: number;
      totals: OrderTotals | null;
      leavesDue: boolean;
      discountKind: DiscountKind | undefined;
      // CB-CHG — the charges[] this settle prices from, always resolved (even
      // on the no-recompute path) so the route can write it via
      // chargeWriteFields without re-deriving it a second time.
      charges: OrderCharge[];
    }
  | { error: string };

export function resolveSettleMoney(input: SettleMoneyInput): SettleMoney {
  // Neither a settle-time discount, charge change, discount-kind change, a
  // reward claim, NOR an extra-charges change supplied — preserve today's
  // behavior byte-for-byte: no recompute, charge exactly the stored total
  // (the Orders-page settle path). When any IS supplied the bill is
  // re-priced from the order's own items, and the fields that were NOT
  // supplied are carried over from the stored order rather than reset —
  // re-pricing to apply a discount must not also wipe the table charge, and
  // vice versa.
  //
  // PIN WIDENED (CB-5B S5): `input.reward !== undefined` was added to this
  // condition — a reward claim MUST trigger the same recompute a discount or
  // charge change does, or a redeemed settle would charge the stored
  // (undiscounted) total while silently dropping the reward on the floor.
  // WIDENED AGAIN (CB-CHG, same precedent): `input.extraCharges !== undefined`
  // — a settle that only ADDS an extra charge (no discount/chargeAmount/kind/
  // reward change) must still re-price, or the new extra would be accepted by
  // the schema but never reach the bill.
  // The source pin in lib/gst-discount.test.ts asserting this branch's
  // original terms must widen to include each new one.
  const effectiveKind = resolveDiscountKind(input.discountKind, input.order.discountKind);
  const noRecompute =
    input.discount === undefined &&
    input.chargeAmount === undefined &&
    input.discountKind === undefined &&
    input.reward === undefined &&
    input.extraCharges === undefined;
  // CB-CHG — charges[] resolved on EITHER path: chargesFromOrder upgrades a
  // legacy scalar-only order in memory (money-neutral by construction), and
  // the two lanes (table via chargeAmount, extra via extraCharges) apply
  // through their own fences so neither can clobber the other's entries.
  const baseCharges = chargesFromOrder(input.order);
  const tableEntry = baseCharges.find((c) => c.type === "table");
  const tableChargeAmount = input.chargeAmount ?? tableEntry?.amount ?? 0;
  const charges = noRecompute
    ? baseCharges
    : applyExtraCharges(
        withTableCharge(
          baseCharges,
          tableChargeAmount > 0
            ? { label: tableEntry?.label ?? DEFAULT_TABLE_CHARGE_LABEL, amount: tableChargeAmount }
            : null,
        ),
        input.extraCharges ?? baseCharges.filter((c) => c.type === "extra"),
      );
  // CB-CHG — split, never summed: the table portion keeps its shipped
  // TABLE_CHARGE_MAX ceiling, the staff-entered extras ride on top uncapped
  // (decision 8) — summing them first would silently cap a legitimate bill
  // and leave `total` disagreeing with the stored charges[]/chargeAmount.
  const { table: tableChargeTotal, extra: extraChargeTotal } = splitChargeTotals(charges);
  const totals = noRecompute
    ? null
    : computeOrderTotals({
        items: input.order.items,
        discount: input.discount ?? input.order.discount,
        discountKind: effectiveKind,
        charge: tableChargeTotal,
        extraCharge: extraChargeTotal,
        cfg: gstConfigFromOrder(input.order, input.liveGst),
        reward: input.reward,
      });
  const total = totals ? totals.total : input.order.total;

  const pay = derivePayment(
    input.payment,
    total,
    input.splitCash,
    input.splitOnline,
    input.paidAmount,
  );
  if ("error" in pay) return pay;

  // Whether this settle parks a balance on a customer — asked as "did the
  // collected amount fall short of the total" rather than "is the mode Due/
  // Credit", because a partial Cash settle leaves a due exactly like a Due
  // sale would, and a fully-discounted Rs 0 bill leaves NO due (even though
  // Due/Credit "collect" paidAmount=0) so it must never demand a customer.
  const leavesDue = pay.paidAmount < total;

  return {
    total,
    paidAmount: pay.paidAmount,
    splitCash: pay.splitCash,
    splitOnline: pay.splitOnline,
    totals,
    leavesDue,
    discountKind: effectiveKind,
    charges,
  };
}
