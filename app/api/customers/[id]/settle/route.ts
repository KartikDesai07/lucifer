import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Customer } from "@/models/Customer";
import cache from "@/lib/cache";
import { success, failure, notFound, requireAdmin } from "@/lib/api-helpers";
import { orderSummaryCacheKey } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/customers/[id]/settle — admin: clear a customer's outstanding dues.
// A dedicated, authorized action that replaces the old "PUT totalDue: 0" path so
// the financial ledger can no longer be rewritten via a general customer update.
export async function POST(_req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Customer not found");

  try {
    await connectDB();
    const updated = await Customer.findByIdAndUpdate(
      id,
      { totalDue: 0 },
      { new: true },
    ).lean();
    if (!updated) return notFound("Customer not found");

    cache.del("customers");
    // The dashboard's Outstanding Dues KPI reads the live ledger via the summary.
    cache.del(orderSummaryCacheKey());
    return success(updated);
  } catch {
    return failure("Failed to settle dues");
  }
}
