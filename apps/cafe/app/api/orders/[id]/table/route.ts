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
  serverError,
} from "@/lib/api-helpers";
import { freeTableFilter, unknownTableMessage } from "@/lib/table-admin";
import {
  MOVABLE_ORDER_STATUS,
  ORDER_NOT_LIVE_ERROR,
  ORDER_NO_TABLE_ERROR,
  ORDER_STALE_ERROR,
  SAME_TABLE_ERROR,
  TABLE_TAKEN_ERROR,
  claimTableFilter,
  moveOrderFilter,
  occupyUpdate,
  tableUnavailableReason,
  RELEASE_UPDATE,
} from "@/lib/order-table-move";
import { moveOrderTableSchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/orders/[id]/table — move a live tab to another table. All staff
// (requireAuth, not requireAdmin) — moving a guest is a serving task, same
// authorization level as Settle, not the admin-gated Cancel.
//
// Order (LEDGER) and Table (CORE) live on different clusters, so a transaction
// across the two writes below is FORBIDDEN. The order of operations is the
// whole design, not a style choice — see the numbered steps.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Order not found");

  const parsed = await validateBody(req, moveOrderTableSchema);
  if ("error" in parsed) return parsed.error;
  const to = parsed.data.tableNo;

  try {
    await connectDB();
    const order = await Order.findById(id).select("orderId status tableNo").lean();
    if (!order) return notFound("Order not found");

    // Gated on status ONLY — unlike /items and /settle this carries no money,
    // so adding a `payment` term would only manufacture false 409s on a tab
    // that is genuinely still open.
    if (order.status !== MOVABLE_ORDER_STATUS) {
      return failure(ORDER_NOT_LIVE_ERROR, 409);
    }
    if (!order.tableNo) return failure(ORDER_NO_TABLE_ERROR, 400);
    if (order.tableNo === to) return failure(SAME_TABLE_ERROR, 400);

    // Step 1: claim the DESTINATION first, conditional on it being free right
    // now. Nothing has been written yet if this misses — that is exactly why
    // it goes first: freeing the source before this would risk leaving the
    // tab holding no table at all, and an unguarded claim (what PUT used to
    // do) steals a table from another live tab and hides that tab from the
    // Live Floor Panel.
    const claimed = await Table.findOneAndUpdate(
      claimTableFilter(to),
      occupyUpdate(order.orderId),
    );
    if (!claimed) {
      const dest = await Table.findOne({ tableNo: to })
        .select("status currentOrderId")
        .lean();
      if (!dest) return failure(unknownTableMessage(to), 400);
      // A claim THIS ORDER already holds is not a conflict. If a first attempt
      // claimed the table and then lost its order write (a throw, a function
      // timeout, or a response that never reached the tablet), the destination
      // is left pointing at this very order — and rejecting that stranded the
      // tab permanently: every retry 409'd with "already running a bill" about
      // the order's OWN claim, the tile went grey in the picker, and only an
      // admin on the Tables screen could unstick it (probed, then pinned by a
      // live leg). So fall through and finish the move; step 2's CAS is what
      // keeps that safe — it still refuses if the tab has closed or moved on.
      if (dest.currentOrderId !== order.orderId) {
        return failure(tableUnavailableReason(dest, order.orderId) ?? TABLE_TAKEN_ERROR, 409);
      }
      // Re-assert our own claim (guarded on our own pointer, so it can never
      // take a table from anyone else): a half-written state whose pointer is
      // ours but whose status is not Occupied would otherwise leave the table
      // reading free on the floor plan while a tab sits on it.
      await Table.findOneAndUpdate(
        freeTableFilter(to, order.orderId),
        occupyUpdate(order.orderId),
      );
    }

    // Step 2: move the order under CAS (still on the table we just read, still
    // open). Two distinct failure modes here need two different responses:
    //   - a THROW is NOT proof the write failed (project lesson: never revert
    //     on a write throw) — reverting the claim above could free a table
    //     the order now legitimately holds, so we leave it alone and only
    //     invalidate the cache.
    //   - a definite NO-MATCH (null) means the order genuinely did not move,
    //     so our claim must be released — guarded on our own order id so a
    //     table someone else has since taken is never freed out from under
    //     them.
    let moved;
    try {
      moved = await Order.findOneAndUpdate(
        moveOrderFilter(id, order.tableNo),
        { $set: { tableNo: to } },
        { new: true, runValidators: true },
      ).lean();
    } catch (error) {
      cache.del("tables");
      return serverError("Failed to move the order", error);
    }
    if (!moved) {
      await Table.findOneAndUpdate(freeTableFilter(to, order.orderId), RELEASE_UPDATE);
      cache.del("tables");
      return failure(ORDER_STALE_ERROR, 409);
    }

    // Step 3: release the OLD table, best-effort, CAS'd on this order. The
    // order has already moved, so failing the request now would only invite a
    // retry that cannot succeed (the CAS above would no-match a second time);
    // a table left flagged Occupied is recoverable from the Tables screen. A
    // no-match here is normal and fine — another order may have already
    // re-claimed it.
    try {
      await Table.findOneAndUpdate(freeTableFilter(order.tableNo, order.orderId), RELEASE_UPDATE);
    } catch {
      // Swallowed deliberately — see the comment above.
    }

    // Nothing in orders/summary derives from tableNo (verified), so that
    // cache is deliberately left untouched.
    cache.del("tables");
    return success(moved);
  } catch (error) {
    return serverError("Failed to move the order", error);
  }
}
