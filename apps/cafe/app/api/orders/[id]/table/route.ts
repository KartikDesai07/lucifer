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
import { freeTableFilter, unknownTableMessage, resolveTableCharge } from "@/lib/table-admin";
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
import { orderSummaryCacheKey } from "@/lib/utils";
import { getSettings, gstConfigOf } from "@/lib/settings";
import { computeOrderTotals, gstConfigFromOrder } from "@/lib/receipt";
import { rewardFromOrderSnapshot } from "@pos/shared/reward-redemption";
import { chargesFromOrder, withTableCharge, splitChargeTotals } from "@pos/shared/order-charges";
import { chargeWriteFields } from "@/lib/order-charges-write";

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
    // CB-CHG plan §5A — widened so this route can re-price the move: the
    // charge lanes, the items/discount/discountKind the bill is priced from,
    // the tab's own GST snapshot (never live settings — gstConfigFromOrder),
    // the reward snapshot (rewardFromOrderSnapshot fails CLOSED at 0, so
    // omitting it would re-bill a reward tab at full price), and the terms
    // the widened CAS filter (moveOrderFilter) now guards on.
    const order = await Order.findById(id)
      .select(
        "orderId status tableNo charges chargeAmount chargeLabel items discount discountKind " +
          "gstRate gstMode total kotRounds voids rewardAt rewardKind rewardValue rewardItem " +
          "rewardItemProductId createdAt",
      )
      .lean();
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

    // CB-CHG plan §5A — the move now RE-PRICES: replace the source table's
    // charge entry with the DESTINATION's own configured charge (withTableCharge
    // — never touches an extra, the owner's headline invariant), leaving every
    // staff-entered extra untouched. resolveTableCharge doubles as the
    // destination's existence check, but the claim above already proved it
    // exists, so only its charge config is needed here.
    const destTable = await resolveTableCharge(to);
    if ("error" in destTable) {
      await Table.findOneAndUpdate(freeTableFilter(to, order.orderId), RELEASE_UPDATE);
      cache.del("tables");
      return failure(destTable.error, 400);
    }
    const charges = withTableCharge(
      chargesFromOrder(order),
      destTable.charge.amount > 0 ? { label: destTable.charge.label, amount: destTable.charge.amount } : null,
    );
    const settings = await getSettings();
    // CB-CHG — split, never summed: the table portion keeps its shipped
    // TABLE_CHARGE_MAX ceiling, the staff-entered extras ride on top uncapped
    // (decision 8) — summing them first would silently cap a legitimate bill
    // and leave `total` disagreeing with the stored charges[]/chargeAmount.
    const { table: tableChargeTotal, extra: extraChargeTotal } = splitChargeTotals(charges);
    const totals = computeOrderTotals({
      items: order.items,
      discount: order.discount,
      // discountKind carries through UNTOUCHED — a move is not the moment an
      // operator picks or clears a discount preset.
      discountKind: order.discountKind,
      charge: tableChargeTotal,
      extraCharge: extraChargeTotal,
      // The tab's OWN GST snapshot, never live settings — a move must not
      // move the tax a tab was opened under.
      cfg: gstConfigFromOrder(order, gstConfigOf(settings)),
      // MUST be passed: rewardDiscountAmount fails CLOSED at 0, so omitting
      // this would re-bill a reward tab at full price with the stamps the
      // diner already spent still gone.
      reward: rewardFromOrderSnapshot(order),
    });
    const chargeFields = chargeWriteFields(charges);

    // Step 2: move the order AND re-price it under CAS, in ONE write (still on
    // the table we just read, still open, still the exact money state the
    // filter above widened to guard — see moveOrderFilter). Two distinct
    // failure modes here need two different responses:
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
        moveOrderFilter(id, order.tableNo, order),
        {
          $set: {
            tableNo: to,
            subtotal: totals.subtotal,
            discount: totals.discount,
            gstAmount: totals.gstAmount,
            total: totals.total,
            ...(chargeFields.set ?? {}),
          },
          ...(chargeFields.unset ? { $unset: chargeFields.unset } : {}),
        },
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

    cache.del("tables");
    // CB-CHG — a move now changes a live tab's total (the prior "nothing in
    // orders/summary derives from tableNo" reasoning no longer holds: the
    // MONEY changed, even though tableNo is what triggered it).
    cache.del(orderSummaryCacheKey());
    return success(moved);
  } catch (error) {
    return serverError("Failed to move the order", error);
  }
}
