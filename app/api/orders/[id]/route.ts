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
  requireAuth,
} from "@/lib/api-helpers";
import { orderSummaryCacheKey } from "@/lib/utils";
import { reconcileLedger } from "@/lib/order";
import { updateOrderSchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/orders/[id]
export async function GET(_req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Order not found");

  try {
    await connectDB();
    const order = await Order.findById(id).lean();
    if (!order) return notFound("Order not found");
    return success(order);
  } catch {
    return failure("Failed to fetch order");
  }
}

// PUT /api/orders/[id] — update + reconcile customer stats and table status
export async function PUT(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Order not found");

  const parsed = await validateBody(req, updateOrderSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const old = await Order.findById(id).lean();
    if (!old) return notFound("Order not found");

    const updated = await Order.findByIdAndUpdate(id, parsed.data, {
      new: true,
      runValidators: true,
    }).lean();
    if (!updated) return notFound("Order not found");

    // Reconcile the customer ledger by the contribution delta so moving a tab
    // between customers stays accurate. (PUT can no longer change money/status —
    // those flow through /items and /settle — so the only delta here comes from
    // a customer change.)
    const touched = await reconcileLedger(old, updated);
    if (touched.size) {
      cache.del("customers");
      // Dues changed → refresh the dashboard's ledger-wide Outstanding Dues KPI,
      // which lives in TODAY's summary regardless of this order's own date (the
      // createdAt-keyed dels below don't cover today when editing a prior-day order).
      cache.del(orderSummaryCacheKey());
    }

    // Reconcile table occupancy if the order's table changed.
    if (old.tableNo !== updated.tableNo) {
      if (old.tableNo) {
        await Table.findOneAndUpdate(
          { tableNo: old.tableNo, currentOrderId: old.orderId },
          { status: "Available", currentOrderId: "" },
        );
      }
      if (updated.tableNo) {
        await Table.findOneAndUpdate(
          { tableNo: updated.tableNo },
          { status: "Occupied", currentOrderId: updated.orderId },
        );
      }
      cache.del("tables");
    }

    cache.del(orderSummaryCacheKey(new Date(old.createdAt)));
    cache.del(orderSummaryCacheKey(new Date(updated.createdAt)));
    return success(updated);
  } catch {
    return failure("Failed to update order");
  }
}

// DELETE /api/orders/[id] — delete + reverse the order's customer/table effects
export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Order not found");

  try {
    await connectDB();
    const order = await Order.findById(id).lean();
    if (!order) return notFound("Order not found");

    await Order.findByIdAndDelete(id);

    // Reverse the order's ledger contribution (a held "Unpaid" tab contributed
    // nothing, so deleting it touches no ledger).
    const touched = await reconcileLedger(order, null);
    if (touched.size) {
      cache.del("customers");
      // Ledger-wide Outstanding Dues KPI lives in today's summary regardless of
      // this (possibly prior-day) order's own date — refresh it too.
      cache.del(orderSummaryCacheKey());
    }

    // Free the table only if it still points to this order.
    if (order.tableNo) {
      await Table.findOneAndUpdate(
        { tableNo: order.tableNo, currentOrderId: order.orderId },
        { status: "Available", currentOrderId: "" },
      );
      cache.del("tables");
    }

    cache.del(orderSummaryCacheKey(new Date(order.createdAt)));
    return success({ deleted: true });
  } catch {
    return failure("Failed to delete order");
  }
}
