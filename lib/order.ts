import mongoose from "mongoose";
import { Customer } from "@/models/Customer";
import { type PaymentMode, type GstMode } from "@/lib/constants";
import { type GstConfig } from "@/lib/receipt";

// Server-only order-domain helpers: payment derivation, the customer-ledger
// contribution model, ledger reconciliation, and the per-order GST snapshot.
// Imported by the order API routes only (pulls in the Customer model + mongoose).

// ── Payment derivation ───────────────────────────────────────────────────────
// Server-authoritative payment fields, validated against a known total. The
// client never asserts paidAmount; we compute it from the chosen mode + total.

export type PaymentDerivation =
  | { paidAmount: number; splitCash?: number; splitOnline?: number }
  | { error: string };

export function derivePayment(
  payment: PaymentMode,
  total: number,
  splitCash?: number,
  splitOnline?: number,
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
    return { paidAmount: total, splitCash: cash, splitOnline: online };
  }
  // Cash / Online: settled in full at the counter.
  return { paidAmount: total };
}

// ── Customer-ledger contribution model ───────────────────────────────────────
// What a single order contributes to its customer's ledger. A held "Unpaid"
// open tab contributes NOTHING (it is neither a realized sale nor a receivable
// until it's settled); every other order contributes one visit, its full total
// as spend, and any unpaid balance as a due. The whole create/edit/delete/settle
// ledger math is expressed as deltas of this one function, so held → settle
// applies the full effect exactly once at settlement.

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
}): LedgerContribution {
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

// ── GST snapshot ─────────────────────────────────────────────────────────────
// Rebuild the GstConfig that was in effect when an order was created, from the
// rate/mode snapshotted on the order — so recomputing money while adding items
// to an open tab uses the tab's original tax, not whatever the cafe set later.
// Pre-snapshot legacy orders (gstMode == null) fall back to the live config;
// those are always already-Completed historical orders, never open tabs (POST
// writes a snapshot on every order).
export function gstConfigFromOrder(
  order: { gstRate?: number; gstMode?: GstMode },
  liveFallback: GstConfig,
): GstConfig {
  if (order.gstMode == null) return liveFallback;
  return {
    gstEnabled: (order.gstRate ?? 0) > 0,
    gstRate: order.gstRate ?? 0,
    gstMode: order.gstMode,
  };
}
