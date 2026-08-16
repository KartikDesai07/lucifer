import mongoose, { type FilterQuery } from "mongoose";
import { connectDB } from "@/lib/db";
import { Order, type IOrder } from "@/models/Order";
import cache from "@/lib/cache";
import {
  success,
  failure,
  notFound,
  validateBody,
  requireAuth,
  serverError,
} from "@/lib/api-helpers";
import { orderSummaryCacheKey } from "@/lib/utils";
import { getSettings, gstConfigOf } from "@/lib/settings";
import { computeOrderTotals, gstConfigFromOrder } from "@/lib/receipt";
import { printConfigOf, printedSlipNumber } from "@/lib/print";
import { nextSlipSequence } from "@/models/Counter";
import { voidGuardFilter } from "@/lib/order-void";
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
    const settings = await getSettings();
    const gstCfg = gstConfigFromOrder(old, gstConfigOf(settings));
    // The tab's table charge is carried forward untouched unless the operator
    // deliberately changed it — omitted means unchanged, exactly like discount.
    // Adding a round is never an occasion to RE-READ the table: the charge was
    // snapshotted when the tab opened, and an admin editing the table mid-
    // service must not re-price a bill the kitchen is already cooking.
    const totals = computeOrderTotals({
      items: fullItems,
      discount,
      charge: parsed.data.chargeAmount ?? old.chargeAmount ?? 0,
      cfg: gstCfg,
    });

    // Guarded on still-open, the round we read, AND the void trail's length, so this
    // read-modify-write can't silently clobber a concurrent add (the loser 409s and
    // the client retries with its items intact) or append to a just-settled bill.
    // The trail term is NOT redundant: a void changes neither status nor kotRounds,
    // so without it a void committing inside this window is silently undone — the
    // `items` below re-appends the voided line from our stale read and re-bills it,
    // while voids[] still records it as voided (arbiter live-probe, CR1.3 review).
    // It mirrors the void route's own guard, so the two routes fence each other.
    const filter: FilterQuery<IOrder> = {
      _id: id,
      status: "Pending",
      payment: "Unpaid",
      kotRounds: old.kotRounds ?? 0,
      ...voidGuardFilter(old.voids?.length ?? 0),
    };
    // A waived charge is REMOVED, not stored as 0: the receipt keys its charge
    // line off the amount being present, so a 0 left beside the label would
    // print a named zero-rupee line on the customer's slip (same rule as the
    // settle route).
    // Every fired round is its own kitchen ticket, so every round draws its own
    // number. Written at kotNumbers[round - 1] so a REPRINT of round 2 shows the
    // ticket the kitchen is already holding rather than issuing a second number
    // for food that was ordered once. Allocated before the guarded write: if
    // that write loses its CAS race the number is spent, which costs a gap in
    // the series — strictly better than two rounds sharing one ticket number.
    const printCfg = printConfigOf(settings);
    const ticket = printCfg.kot.showNumber
      ? printedSlipNumber(await nextSlipSequence("kot"), printCfg.kot.numberStart)
      : undefined;
    // Built POSITIONALLY, not appended. The slip is read back by index
    // (use-pos-print: kotNumbers[kotRounds - 1]), and a tab can carry a SHORT
    // array — every tab already open when numbering ships has none at all, and
    // any round fired while the toggle was off adds no entry. Appending would
    // then file this round's ticket under an earlier round's index: the slip
    // would print no number at all while the series still spent one, and the
    // stored array would claim a number for a round that was never numbered.
    // 0 is a safe "this round was never numbered" sentinel — printedSlipNumber
    // floors at PRINT_NUMBER_START_MIN (1), so 0 is not a printable number.
    const kotNumbers =
      ticket === undefined
        ? undefined
        : Array.from({ length: round }, (_, i) =>
            i === round - 1 ? ticket : (old.kotNumbers?.[i] ?? 0),
          );

    const update: Record<string, unknown> = {
      $set: {
        items: fullItems,
        subtotal: totals.subtotal,
        discount: totals.discount,
        gstAmount: totals.gstAmount,
        total: totals.total,
        kotRounds: round,
        ...(totals.charge > 0 ? { chargeAmount: totals.charge } : {}),
        ...(kotNumbers ? { kotNumbers } : {}),
      },
    };
    if (totals.charge <= 0) {
      update.$unset = { chargeAmount: "", chargeLabel: "" };
    }
    const updated = await Order.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!updated) {
      return failure("Tab changed or already settled — reopen it and try again", 409);
    }

    // In-progress KPI value (Σ pending totals) grew — refresh today's summary.
    cache.del(orderSummaryCacheKey());
    return success(updated);
  } catch (error) {
    return serverError("Failed to add items", error);
  }
}
