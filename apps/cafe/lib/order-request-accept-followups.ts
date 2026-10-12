import { Customer } from "@/models/Customer";
import { Table } from "@/models/Table";
import cache from "@/lib/cache";
import { ledgerContribution } from "@/lib/order";
import type { AcceptTarget } from "@/lib/order-request-accept-core";

// The QR accept's two best-effort follow-ups (customer ledger, table claim),
// split out of order-request-accept.ts (S5a, behaviour-preserving move; the
// order-create-followups precedent). Neither can fail the accept.

export interface AcceptFollowUpsArgs {
  customerId: string | undefined;
  // The landed order's total and what was collected, in rupees.
  total: number;
  paidAmount: number;
  target: AcceptTarget;
  tableNo: string | undefined;
  orderId: string;
}

export async function runAcceptFollowUps({
  customerId,
  total,
  paidAmount,
  target,
  tableNo,
  orderId,
}: AcceptFollowUpsArgs): Promise<void> {
  // Ledger contribution — best-effort, mirrors POST /api/orders exactly.
  if (customerId) {
    const c = ledgerContribution({ payment: "Unpaid", total, paidAmount, status: "Pending" });
    if (c.visits || c.spend || c.due) {
      try {
        await Customer.findByIdAndUpdate(customerId, {
          $inc: { visits: c.visits, totalSpend: c.spend, totalDue: c.due },
        });
        cache.del("customers");
      } catch {
        /* best-effort — recoverable via reconcile */
      }
    }
  }

  // Claim the table only if still free (same guard as POST /api/orders) — a parcel claims nothing.
  if (target === "create" && tableNo) {
    try {
      await Table.findOneAndUpdate(
        { tableNo, status: "Available" },
        { status: "Occupied", currentOrderId: orderId },
      );
      cache.del("tables");
    } catch {
      /* best-effort */
    }
  }
}
