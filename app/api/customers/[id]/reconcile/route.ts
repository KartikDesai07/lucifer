import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import cache from "@/lib/cache";
import { success, notFound, requireAdmin, serverError } from "@/lib/api-helpers";
import { orderSummaryCacheKey } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/customers/[id]/reconcile — admin recovery tool: rebuild the customer's
// ledger (visits / totalSpend / totalDue) from the authoritative Orders so any
// drift from a partial write or interrupted update self-heals.
export async function POST(_req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Customer not found");

  try {
    await connectDB();
    const exists = await Customer.exists({ _id: id });
    if (!exists) return notFound("Customer not found");

    const [agg] = await Order.aggregate([
      { $match: { customerId: id } },
      {
        $group: {
          _id: null,
          visits: { $sum: 1 },
          totalSpend: { $sum: "$total" },
          totalDue: {
            $sum: { $max: [0, { $subtract: ["$total", "$paidAmount"] }] },
          },
        },
      },
    ]);

    const updated = await Customer.findByIdAndUpdate(
      id,
      {
        visits: agg?.visits ?? 0,
        totalSpend: agg?.totalSpend ?? 0,
        totalDue: agg?.totalDue ?? 0,
      },
      { new: true },
    ).lean();

    cache.del("customers");
    // Rebuilding the ledger can change total dues — refresh the dashboard KPI.
    cache.del(orderSummaryCacheKey());
    return success(updated);
  } catch (error) {
    return serverError("Failed to reconcile customer", error);
  }
}
