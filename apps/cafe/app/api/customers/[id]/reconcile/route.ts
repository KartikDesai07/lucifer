import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import cache from "@/lib/cache";
import { success, notFound, requireAdmin, serverError } from "@/lib/api-helpers";
import { orderSummaryCacheKey } from "@/lib/utils";
import { duesPaidTotal } from "@/lib/due-payment";
import { maskCustomer } from "@/lib/customer-privacy";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/customers/[id]/reconcile — admin recovery tool: rebuild the customer's
// ledger (visits / totalSpend / totalDue) from the authoritative Orders so any
// drift from a partial write or interrupted update self-heals.
export async function POST(_req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;
  const role = admin.session.user.role;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Customer not found");

  try {
    await connectDB();
    const exists = await Customer.exists({ _id: id });
    if (!exists) return notFound("Customer not found");

    // Cancelled orders are excluded because this rebuild is AUTHORITATIVE — it
    // overwrites the ledger rather than nudging it. A cancel reverses the order's
    // visit/spend/due (ledgerContribution → zero, applied as a reconcile delta), so
    // an unfiltered rebuild would hand that money straight back and silently undo
    // the cancellation (CR1.3).
    // CR1.4: this aggregate must mirror ledgerContribution exactly, not just the
    // Cancelled exclusion above — a held "Unpaid" tab is neither a sale nor a
    // receivable until settled, so it zero-rates for visits/totalSpend/totalDue
    // too (previously this route counted its full total as due, inflating the
    // rebuilt balance). Mirrors the `unlessZeroRated` shape in
    // lib/customer-rollup.ts's customerSumPipeline.
    const unlessZeroRated = (expr: unknown) => ({
      $cond: [
        {
          $or: [
            { $eq: ["$payment", "Unpaid"] },
            { $eq: ["$status", "Cancelled"] },
          ],
        },
        0,
        expr,
      ],
    });
    const [agg] = await Order.aggregate([
      { $match: { customerId: id, status: { $ne: "Cancelled" } } },
      {
        $group: {
          _id: null,
          visits: { $sum: unlessZeroRated(1) },
          totalSpend: { $sum: unlessZeroRated("$total") },
          totalDue: {
            $sum: unlessZeroRated({
              $max: [0, { $subtract: ["$total", "$paidAmount"] }],
            }),
          },
        },
      },
    ]);

    // CR1.4 §1 hazard: this rebuild re-derives totalDue from Orders ALONE — a
    // customer who already paid down their balance via a DuePayment (a write
    // OUTSIDE the Order collection) would otherwise have that money silently
    // restored on every reconcile run. Subtract it before the $set, exactly
    // like the recompute AUTHORITY (customer-rollup.ts recomputeCustomer).
    const paidDues = await duesPaidTotal(id);
    const totalDue = Math.max(0, (agg?.totalDue ?? 0) - paidDues);

    const updated = await Customer.findByIdAndUpdate(
      id,
      {
        visits: agg?.visits ?? 0,
        totalSpend: agg?.totalSpend ?? 0,
        totalDue,
      },
      { new: true },
    ).lean();
    if (!updated) return notFound("Customer not found");

    cache.del("customers");
    // Rebuilding the ledger can change total dues — refresh the dashboard KPI.
    cache.del(orderSummaryCacheKey());
    // This route is requireAdmin so masking is a no-op today — applied anyway
    // as deliberate uniformity, so a future guard change can't silently leak.
    return success(maskCustomer(updated, role));
  } catch (error) {
    return serverError("Failed to reconcile customer", error);
  }
}
