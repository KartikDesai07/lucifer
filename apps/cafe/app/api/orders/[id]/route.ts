import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Table } from "@/models/Table";
import cache from "@/lib/cache";
import {
  success,
  notFound,
  failure,
  validateBody,
  requireAuth,
  requireAdmin,
  serverError,
} from "@/lib/api-helpers";
import { orderSummaryCacheKey } from "@/lib/utils";
import { reconcileLedger } from "@/lib/order";
import { updateOrderSchema } from "@/schemas";
import { FREE_TABLE_FILTER, unknownTableMessage } from "@/lib/table-admin";
import { tableUnavailableReason } from "@/lib/order-table-move";

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
  } catch (error) {
    return serverError("Failed to fetch order", error);
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

    // A cancelled order is a closed record — its money is already reversed out of
    // the ledger and its table freed, so PUT's table reconciliation below would
    // otherwise re-Occupy a table for something that is no longer a sale.
    if (old.status === "Cancelled") {
      return failure("A cancelled order can no longer be edited", 409);
    }

    // Only a table CHANGE is checked against the live floor plan. Re-submitting
    // the table an order already carries must keep working even if that table
    // was since removed — otherwise a deleted table would freeze every past
    // order that ever sat at it, blocking edits unrelated to seating.
    const changingTable =
      parsed.data.tableNo !== undefined && parsed.data.tableNo !== old.tableNo;
    if (changingTable && parsed.data.tableNo) {
      // ONE read answers both existence and availability — checkTableExists
      // alone let this PUT re-occupy a table another live order already holds,
      // silently stealing it and orphaning that order from the Live Floor Panel.
      const dest = await Table.findOne({ tableNo: parsed.data.tableNo })
        .select("status currentOrderId")
        .lean();
      if (!dest) return failure(unknownTableMessage(parsed.data.tableNo), 400);
      const reason = tableUnavailableReason(dest, old.orderId);
      if (reason) return failure(reason, 409);
    }

    // Conditional on the status we READ, so the freeze above is enforced at the
    // WRITE and not merely checked beforehand: a cancel landing between that read
    // and this write would otherwise let the ledger delta below run a SECOND
    // reversal of the same order (contribution(Cancelled) − contribution(Completed)),
    // which clampLedger would then quietly floor at zero — an under-counted customer
    // ledger with nothing in the logs (arbiter live-probe, CR1.3 review).
    const filter = {
      _id: id,
      status: old.status,
      // Guard the field we are about to overwrite: without this, a table MOVE
      // (POST /api/orders/[id]/table) landing between our read and this write
      // is silently reversed — its claim on the new table stays, but this PUT
      // overwrites tableNo back to the old value, leaving the new table
      // Occupied by nobody (project lesson: reciprocal-cas-guards).
      ...(changingTable ? { tableNo: old.tableNo ?? { $in: [null, ""] } } : {}),
    };
    const updated = await Order.findOneAndUpdate(filter, parsed.data, {
      new: true,
      runValidators: true,
    }).lean();
    if (!updated) return failure("Order changed — reload and try again", 409);

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
        // Conditional on the table still being free: the check above already
        // rejected an unavailable table at read time, but a second claim
        // landing in the gap before this write must not be forced through — a
        // miss here just leaves the table alone (the stolen-table bug this
        // guards against), and the operator sees the conflict on their next
        // read rather than silently displacing another live order.
        await Table.findOneAndUpdate(
          { tableNo: updated.tableNo, ...FREE_TABLE_FILTER },
          { status: "Occupied", currentOrderId: updated.orderId },
        );
      }
      cache.del("tables");
    }

    cache.del(orderSummaryCacheKey(new Date(old.createdAt)));
    cache.del(orderSummaryCacheKey(new Date(updated.createdAt)));
    return success(updated);
  } catch (error) {
    return serverError("Failed to update order", error);
  }
}

// DELETE /api/orders/[id] — admin-only break-glass. A hard delete destroys the
// audit trail, so this is no longer the cashier's path; the operator path is
// POST .../cancel, which keeps the row plus the reason (CR1.3).
export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Order not found");

  try {
    await connectDB();
    const order = await Order.findById(id).lean();
    if (!order) return notFound("Order not found");

    // Only the caller whose delete actually removed the row may reverse the ledger.
    // Two deletes racing (or a retry after a timeout) both read the same doc, and an
    // unconditional reversal would apply twice — clampLedger floors the result, so
    // the damage is a silently under-counted customer rather than a visible error.
    const deleted = await Order.findByIdAndDelete(id);
    if (!deleted) return notFound("Order not found");

    // Reverse the order's ledger contribution (a held "Unpaid" tab contributed
    // nothing, so deleting it touches no ledger).
    const touched = await reconcileLedger(order, null);
    if (touched.size) {
      cache.del("customers");
      // Ledger-wide Outstanding Dues KPI lives in today's summary regardless of
      // this (possibly prior-day) order's own date — refresh it too.
      cache.del(orderSummaryCacheKey());
    }

    // Free the table only if it still points to this order — and read the table
    // off `deleted` (the document as it was AT REMOVAL), not off the earlier
    // `order` snapshot. A table move landing between the two reads makes those
    // two values different tables: freeing the snapshot's table is a harmless
    // no-op (the move already freed it) while the table the order actually
    // occupied stays Occupied forever, pointing at an order that no longer
    // exists. Every other writer in this file already derives this from the
    // post-write document.
    if (deleted.tableNo) {
      await Table.findOneAndUpdate(
        { tableNo: deleted.tableNo, currentOrderId: deleted.orderId },
        { status: "Available", currentOrderId: "" },
      );
      cache.del("tables");
    }

    cache.del(orderSummaryCacheKey(new Date(order.createdAt)));
    return success({ deleted: true });
  } catch (error) {
    return serverError("Failed to delete order", error);
  }
}
