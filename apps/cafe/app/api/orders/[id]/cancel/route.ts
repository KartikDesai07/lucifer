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
import { reconcileLedger, validCustomer } from "@/lib/order";
import { returnRewardStamps } from "@/lib/reward-claim";
import { releaseAssignedRewardForRung } from "@/lib/assigned-reward-gate";
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

    // CB-5B S6 (D2) — a cancelled bill gives the stamps back. The cancel CAS
    // above has ALREADY LANDED, so this runs against a definite, committed
    // write: `updated` is non-null, the order IS Cancelled, and nothing after
    // this point can un-cancel it. That is the direction never-revert-on-
    // write-throw actually cares about — the settle/create paths reverse a
    // claim only on a CONFIRMED non-write (a CAS miss, an E11000), whereas
    // here the reversal is the compensating half of a write that certainly
    // happened.
    //
    // Gated on `rewardStamps`, the stamp COST stored on the order at claim
    // time, NOT re-derived from the live ladder: the owner may have retuned
    // the rung's `at` since, and returning today's price for yesterday's
    // purchase would credit the wrong number of stamps. A `rewardStamps` of 0
    // or absent means no claim was ever funded against this order, so there is
    // nothing to give back (an item reward discounts ₹0 but still stores a
    // non-zero cost, so this gate does not miss one).
    //
    // returnRewardStamps is idempotent and reciprocal-guarded in its own
    // FILTER (`redeemedOrders: orderId` AND `returnedOrders: {$ne: orderId}`),
    // which is also what keeps a customer REASSIGNMENT safe: PUT
    // /api/orders/[id] can move a tab to another customer, and the new
    // customer's row carries no redemption mark for this orderId, so the
    // return is refused rather than crediting stamps to someone who never
    // spent any. `false` is therefore an expected outcome here — already
    // returned, never claimed, or claimed by a different row — never an error.
    //
    // Stated plainly, because refusing is only the SAFE half: on a reassigned
    // order the original spender's stamps are then stranded, since the marker
    // authorising a refund sits on THEIR row while this code only ever reads
    // the order's CURRENT customerId. Crediting the new owner would be worse
    // (it MINTS stamps nobody spent), so the refusal is right and must stay.
    // The fix belongs at the PUT — it should refuse to reassign a
    // reward-carrying order at all — and is booked as an open item in
    // cb5b-plan.md. Unreachable from the shipped UI today: useUpdateOrder
    // (hooks/use-orders.ts) has no call sites.
    //
    // EARN-SIDE IS NOT REVERSED (D2, explicit): the stamp GRANTED for settling
    // this bill (lib/diner-loyalty-earn.ts) stays. That is a pre-existing CB-4
    // gap the owner chose to keep, so a cancel returns what the diner SPENT
    // without clawing back what they earned.
    //
    // Swallowed: the cancel is already committed and the operator has been
    // told it worked. A marker write that fails must never turn a completed
    // cancel into a 500 the operator would retry — the retry would hit the
    // "Order is already cancelled" 409 guard at the top of this handler,
    // leaving them stuck with a bill that IS cancelled and an error that says
    // it is not.
    const rewardCustomer = validCustomer(updated.customerId);
    const rewardCost = updated.rewardStamps ?? 0;
    if (rewardCustomer && rewardCost > 0) {
      try {
        const returned = await returnRewardStamps(rewardCustomer, updated.orderId, rewardCost);
        // Only on a return that ACTUALLY fired — a refused one changed no
        // row, so there is nothing to invalidate (mirrors the earn-side
        // grant's own `if (granted.granted)` shape in settle/route.ts).
        //
        // This is a SEPARATE del from the `if (touched.size)` one above, and
        // it is not redundant: the commonest S6 path is a reward claimed at
        // order-taking on an Unpaid/Pending tab that is cancelled before
        // payment, and ledgerContribution (lib/order.ts:79-80) returns zero
        // for BOTH an Unpaid and a Cancelled order — so the delta is zero on
        // every field, `touched` comes back empty, and that block never
        // fires on exactly the orders this one exists for.
        //
        // Scope, stated honestly: the cached list payload does not project
        // `stamps` today (LIST_FIELDS in app/api/customers/route.ts), so this
        // del corrects no stale balance YET — the diner surface reads stamps
        // straight from the row (app/api/public/diner/me/route.ts:76). It is
        // here because this route just wrote the Customer document the list
        // caches, which is what the repo's invalidate-after-write rule asks
        // for, and because the staff-side stamp read S9 adds will project
        // from that same row.
        // CB-5D part 2 DEFECT FIX — a cancel must un-assign what the claim
        // assigned, not just refund the stamps. The asymmetry was a real,
        // live-probed exploit: claim 8 stamps -> stamps 0 + a minted code;
        // cancel -> stamps 8 AND the code still there. The diner ended up
        // holding both, repeatably. Gated on `returned` for the same reason
        // the cache del is: a refused return changed no row, so this order's
        // claim was never the one that landed and its grant is not ours to
        // pull. `rewardAt` is the rung the Order itself stored.
        if (returned) {
          cache.del("customers");
          if (updated.rewardAt !== undefined) {
            await releaseAssignedRewardForRung(rewardCustomer, updated.rewardAt);
          }
        }
      } catch {
        // Deliberately empty — see above. The stamps stay spent; the cancel stands.
      }
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
