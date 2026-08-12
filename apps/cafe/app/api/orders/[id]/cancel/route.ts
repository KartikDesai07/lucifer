import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Table } from "@/models/Table";
import cache from "@/lib/cache";
import {
  success,
  failure,
  notFound,
  validateBody,
  requireAdmin,
  serverError,
} from "@/lib/api-helpers";
import { orderSummaryCacheKey } from "@/lib/utils";
import { reconcileLedger } from "@/lib/order";
import { cancelOrderSchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/orders/[id]/cancel — admin-only, terminal, audited (CR1.3). Replaces
// the old cashier-facing delete: the order STAYS in the ledger with who/why/when,
// it just stops counting as a sale (ledgerContribution returns zero for it).
// requireAdmin() is the ONLY gate here — middleware does not cover /api.
export async function POST(req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Order not found");

  const parsed = await validateBody(req, cancelOrderSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const old = await Order.findById(id).lean();
    if (!old) return notFound("Order not found");
    if (old.status === "Cancelled") return failure("Order is already cancelled", 409);

    // Keyed on the status we READ (the CR1.2 CAS discipline), so a cancel racing
    // a settle has exactly one winner and the ledger reversal below applies
    // exactly once. cancelledBy comes from the SESSION, never the client.
    const updated = await Order.findOneAndUpdate(
      { _id: id, status: old.status },
      {
        $set: {
          status: "Cancelled",
          cancelReason: parsed.data.reason,
          cancelledBy: admin.session.user?.name ?? "",
          cancelledAt: new Date(),
        },
      },
      { new: true, runValidators: true },
    ).lean();
    if (!updated) return failure("Order changed — reload and try again", 409);

    // ledgerContribution returns zero for a Cancelled order, so this reverses a
    // settled bill's visit/spend/due through the same delta a delete used.
    const touched = await reconcileLedger(old, updated);
    if (touched.size) {
      cache.del("customers");
      // Ledger-wide Outstanding Dues KPI lives in TODAY's summary regardless of
      // this (possibly prior-day) order's own date.
      cache.del(orderSummaryCacheKey());
    }

    // Free the table only if it still points at this order.
    if (updated.tableNo) {
      await Table.findOneAndUpdate(
        { tableNo: updated.tableNo, currentOrderId: updated.orderId },
        { status: "Available", currentOrderId: "" },
      );
      cache.del("tables");
    }

    // Today's KPIs AND the order's own day, since a prior-day bill can be cancelled.
    cache.del(orderSummaryCacheKey());
    cache.del(orderSummaryCacheKey(new Date(updated.createdAt)));
    return success(updated);
  } catch (error) {
    return serverError("Failed to cancel order", error);
  }
}
