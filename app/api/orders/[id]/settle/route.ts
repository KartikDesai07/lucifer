import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { Table } from "@/models/Table";
import cache from "@/lib/cache";
import {
  success,
  failure,
  notFound,
  validateBody,
  requireAuth,
} from "@/lib/api-helpers";
import { orderSummaryCacheKey } from "@/lib/utils";
import { derivePayment, reconcileLedger, validCustomer } from "@/lib/order";
import { settleOrderSchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/orders/[id]/settle — take payment on an open tab and close it.
// Server-authoritative: paidAmount is derived from the order's STORED total
// (price locked at tab-open), the customer ledger gets the order's full
// contribution applied now (a held tab contributed nothing at open), and the
// table is freed. Idempotent-safe: the update is conditional on the order still
// being Pending, so a double-fired settle applies the ledger delta exactly once.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Order not found");

  const parsed = await validateBody(req, settleOrderSchema);
  if ("error" in parsed) return parsed.error;
  const data = parsed.data;

  try {
    await connectDB();
    const old = await Order.findById(id).lean();
    if (!old) return notFound("Order not found");
    if (old.status === "Completed") return failure("Order already settled", 409);

    // Payment derived against the stored total — no item recompute on settle.
    const pay = derivePayment(data.payment, old.total, data.splitCash, data.splitOnline);
    if ("error" in pay) return failure(pay.error, 400);

    // The order's own customer is authoritative; the body may only ATTACH a
    // customer to a tab opened without one (never reassign an existing one).
    const attachId = !old.customerId ? validCustomer(data.customerId) : null;
    const isDeferred = data.payment === "Due" || data.payment === "Credit";

    // Resolve the attaching customer's name up front (snapshot server-side, never
    // trust a client-supplied name). attachName stays undefined if it was deleted.
    let attachName: string | undefined;
    if (attachId) {
      const cust = await Customer.findById(attachId).select("name").lean();
      attachName = cust?.name;
    }

    // A Due/Credit sale parks its full balance on a customer, so that customer
    // must EXIST — an ObjectId that's well-formed but deleted would otherwise
    // complete the order with the balance recorded against nobody (money lost).
    if (isDeferred) {
      const carrierExists = old.customerId
        ? (await Customer.exists({ _id: old.customerId })) != null
        : !!attachName;
      if (!carrierExists) {
        return failure("Select an existing customer for Due or Credit orders", 400);
      }
    }

    const update: Record<string, unknown> = {
      payment: data.payment,
      paidAmount: pay.paidAmount,
      status: "Completed",
    };
    if (data.payment === "Split") {
      update.splitCash = pay.splitCash;
      update.splitOnline = pay.splitOnline;
    }
    if (attachId && attachName) {
      update.customerId = attachId;
      update.customerName = attachName;
    }

    // Conditional on still-Pending AND the total we priced against being
    // unchanged. This makes a double-settle apply the ledger delta exactly once,
    // AND prevents a stale underpayment if a new KOT round raced in between the
    // read and the write (changed total → match fails → the staff reopens the
    // now-larger bill). The loser matches nothing and 409s.
    const updated = await Order.findOneAndUpdate(
      { _id: id, status: "Pending", total: old.total },
      update,
      { new: true, runValidators: true },
    ).lean();
    if (!updated) {
      return failure("Tab changed or already settled — reopen it and try again", 409);
    }

    // Apply the full ledger effect now (the open tab contributed nothing at open).
    const touched = await reconcileLedger(old, updated);
    if (touched.size) cache.del("customers");

    // Free the table only if it still points to this order.
    if (updated.tableNo) {
      await Table.findOneAndUpdate(
        { tableNo: updated.tableNo, currentOrderId: updated.orderId },
        { status: "Available", currentOrderId: "" },
      );
      cache.del("tables");
    }

    // Today's KPIs change (tab leaves In-progress; collected/sales/dues move).
    cache.del(orderSummaryCacheKey());
    cache.del(orderSummaryCacheKey(new Date(updated.createdAt)));
    return success(updated);
  } catch {
    return failure("Failed to settle order");
  }
}
