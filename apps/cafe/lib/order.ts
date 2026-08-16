import mongoose from "mongoose";
import { Customer } from "@/models/Customer";
import { type PaymentMode, type GstMode, type OrderStatus } from "@/lib/constants";
import {
  type GstConfig,
  type OrderTotals,
  computeOrderTotals,
  gstConfigFromOrder,
} from "@/lib/receipt";

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

export const validCustomer = (id?: string) =>
  id && mongoose.isValidObjectId(id) ? id : null;

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
  customerId?: string;
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
    items: ReadonlyArray<{ price: number; qty: number }>;
    total: number;
    discount: number;
    gstRate?: number;
    gstMode?: GstMode;
    chargeAmount?: number;
  };
  payment: PaymentMode;
  discount?: number;
  // Settle-time waiver/adjustment of the table charge. Undefined means "leave
  // the tab's charge alone" — NOT "no charge" — so a settle path that knows
  // nothing about charges cannot drop one off a bill.
  chargeAmount?: number;
  paidAmount?: number;
  splitCash?: number;
  splitOnline?: number;
  liveGst: GstConfig;
}

export type SettleMoney =
  | {
      total: number;
      paidAmount: number;
      splitCash?: number;
      splitOnline?: number;
      totals: OrderTotals | null;
      leavesDue: boolean;
    }
  | { error: string };

export function resolveSettleMoney(input: SettleMoneyInput): SettleMoney {
  // Neither a settle-time discount NOR a charge change supplied — preserve
  // today's behavior byte-for-byte: no recompute, charge exactly the stored
  // total (the Orders-page settle path). When either IS supplied the bill is
  // re-priced from the order's own items, and the field that was NOT supplied
  // is carried over from the stored order rather than reset — re-pricing to
  // apply a discount must not also wipe the table charge, and vice versa.
  const totals =
    input.discount === undefined && input.chargeAmount === undefined
      ? null
      : computeOrderTotals({
          items: input.order.items,
          discount: input.discount ?? input.order.discount,
          charge: input.chargeAmount ?? input.order.chargeAmount ?? 0,
          cfg: gstConfigFromOrder(input.order, input.liveGst),
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
  };
}
