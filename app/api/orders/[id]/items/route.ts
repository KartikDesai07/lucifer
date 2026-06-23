import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import cache from "@/lib/cache";
import {
  success,
  failure,
  notFound,
  validateBody,
  requireAuth,
} from "@/lib/api-helpers";
import { orderSummaryCacheKey } from "@/lib/utils";
import { getSettings, gstConfigOf } from "@/lib/settings";
import { computeOrderTotals } from "@/lib/receipt";
import { gstConfigFromOrder } from "@/lib/order";
import { addItemsSchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/orders/[id]/items — fire another KOT round on an open tab: append the
// new items (stamped with the next round number), recompute money from the FULL
// item set using the tab's GST SNAPSHOT (so a tab opened earlier keeps its
// original tax), and bump the round counter. The tab stays Pending/Unpaid/unpaid.
//
// This is a read-modify-write, but the conditional update is guarded on the
// round we read (kotRounds) plus {status:Pending, payment:Unpaid}: a concurrent
// add from a second device, or a settle that landed first, makes the match fail
// → 409 (the client retries with its items intact / reopens), so a round is never
// silently lost and items can never be appended to an already-settled bill.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Order not found");

  const parsed = await validateBody(req, addItemsSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const old = await Order.findById(id).lean();
    if (!old) return notFound("Order not found");
    if (old.status !== "Pending" || old.payment !== "Unpaid") {
      return failure("Can only add items to an open tab", 409);
    }

    const round = (old.kotRounds ?? 0) + 1;
    const newItems = parsed.data.items.map((it) => ({ ...it, kotRound: round }));
    const fullItems = [...old.items, ...newItems];

    // Recompute from the tab's GST snapshot, not live settings. An updated
    // discount may ride along (server re-clamps it to the new subtotal).
    const discount = parsed.data.discount ?? old.discount;
    const gstCfg = gstConfigFromOrder(old, gstConfigOf(await getSettings()));
    const totals = computeOrderTotals(fullItems, discount, gstCfg);

    // Guarded on still-open AND the round we read, so this read-modify-write
    // can't silently clobber a concurrent add (the loser 409s and the client
    // retries with its items intact) or append to a just-settled bill.
    const updated = await Order.findOneAndUpdate(
      { _id: id, status: "Pending", payment: "Unpaid", kotRounds: old.kotRounds ?? 0 },
      {
        $set: {
          items: fullItems,
          subtotal: totals.subtotal,
          discount: totals.discount,
          gstAmount: totals.gstAmount,
          total: totals.total,
          kotRounds: round,
        },
      },
      { new: true, runValidators: true },
    ).lean();
    if (!updated) {
      return failure("Tab changed or already settled — reopen it and try again", 409);
    }

    // In-progress KPI value (Σ pending totals) grew — refresh today's summary.
    cache.del(orderSummaryCacheKey());
    return success(updated);
  } catch {
    return failure("Failed to add items");
  }
}
