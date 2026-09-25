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
import { gstConfigFromOrder } from "@/lib/receipt";
import { rewardFromOrderSnapshot } from "@pos/shared/reward-redemption";
import { resolveItemVoid, voidGuardFilter } from "@/lib/order-void";
import { printConfigOf, printedSlipNumber } from "@/lib/print";
import { nextSlipSequence } from "@/models/Counter";
import { voidItemSchema } from "@/schemas";
import { shouldStoreDiscountKind } from "@pos/shared/reward-redemption";
import { chargesFromOrder, splitChargeTotals } from "@pos/shared/order-charges";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/orders/[id]/items/void — void or qty-reduce ONE already-fired line on
// an open tab (CR1.3). Staff-accessible, not admin: a mis-punch has to be fixable
// mid-service without a manager present; the controls are the REQUIRED reason,
// the session-stamped voidedBy, the append-only trail, and the VOID slip the
// kitchen receives (an operator cannot quietly remove a fired dish).
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Order not found");

  const parsed = await validateBody(req, voidItemSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const old = await Order.findById(id).lean();
    if (!old) return notFound("Order not found");
    if (old.status !== "Pending" || old.payment !== "Unpaid") {
      return failure("Can only void items on an open tab", 409);
    }
    const settings = await getSettings();

    // Recompute against the tab's own GST SNAPSHOT, not live settings — same
    // discipline as /items: a mid-tab GST change must never retroactively
    // reprice an open tab.
    const voidCharges = splitChargeTotals(chargesFromOrder(old));
    const resolved = resolveItemVoid({
      items: old.items,
      request: {
        index: parsed.data.index,
        lineKey: parsed.data.lineKey,
        qty: parsed.data.qty,
        reason: parsed.data.reason,
        voidedBy: authed.session.user?.name ?? "",
        at: new Date(),
      },
      discount: old.discount,
      discountKind: old.discountKind,
      // Rebuilt from the order's own stored snapshot: a void must shrink the
      // bill without stripping a reward the diner already spent stamps on.
      reward: rewardFromOrderSnapshot(old),
      // CB-CHG — derive only (plan §4): a void never touches charges, table
      // or extra. chargesFromOrder upgrades a legacy scalar-only order to the
      // equivalent single-entry charges[] in memory (money-neutral by
      // construction), so this reads correctly whether `old` predates the
      // feature or not. Split (never summed) — the table portion keeps its
      // TABLE_CHARGE_MAX ceiling, extras ride on top uncapped.
      charge: voidCharges.table,
      extraCharge: voidCharges.extra,
      gstCfg: gstConfigFromOrder(old, gstConfigOf(settings)),
    });
    if ("error" in resolved) return failure(resolved.error, resolved.status);

    // A void slip is a kitchen ticket too — it is printed, carried to the pass
    // and acted on — so when the cafe numbers its tickets this one draws from
    // the SAME daily series. Without a number of its own a void slip is the one
    // piece of paper the kitchen cannot reconcile against anything.
    const printCfg = printConfigOf(settings);
    const voidTicket =
      printCfg.kot.showNumber && printCfg.kot.numberVoidSlips
        ? printedSlipNumber(await nextSlipSequence("kot"), printCfg.kot.numberStart)
        : undefined;

    // Guarded on still-open, the round we read (a void never bumps kotRounds — it
    // isn't a new round), and voidGuardFilter (see there for why the trail's own
    // length is the CAS term for a void).
    // The trail length comes from the CLIENT's `expectedVoids`, not from our own
    // re-read: anchoring it to what the operator saw makes the write idempotent
    // against a retry. A resend whose first attempt actually landed carries the old
    // count, matches nothing, and 409s — where a server-read count would happily
    // void a second unit off the same line (CR1.3 review).
    const filter: FilterQuery<IOrder> = {
      _id: id,
      status: "Pending",
      payment: "Unpaid",
      kotRounds: old.kotRounds ?? 0,
      ...voidGuardFilter(parsed.data.expectedVoids),
    };
    const updated = await Order.findOneAndUpdate(
      filter,
      {
        $set: {
          items: resolved.nextItems,
          subtotal: resolved.totals.subtotal,
          discount: resolved.totals.discount,
          gstAmount: resolved.totals.gstAmount,
          total: resolved.totals.total,
        },
        $push: {
          voids: voidTicket === undefined
            ? resolved.entry
            : { ...resolved.entry, kotNumber: voidTicket },
        },
        // A void never changes intent, so the stored kind stays as-is — EXCEPT
        // when the re-derived discount is 0, where it must go (amount gates the
        // kind — shouldStoreDiscountKind's one named exception is "reward",
        // whose derived amount is ALWAYS 0: a void must NOT $unset a reward
        // snapshot just because the amount reads 0, or the stamps-spent
        // provenance on an order that spent them would vanish). The
        // `resolved.totals.discount === 0` term stays exactly as before —
        // only the KIND term widened to route through the shared predicate.
        ...(old.discountKind !== undefined &&
        resolved.totals.discount === 0 &&
        !shouldStoreDiscountKind(resolved.totals.discount, old.discountKind)
          ? { $unset: { discountKind: "" } }
          : {}),
      },
      { new: true, runValidators: true },
    ).lean();
    if (!updated) {
      return failure("Tab changed — reopen it and try again", 409);
    }

    // In-progress KPI value (Σ pending totals) shrank — orders themselves are
    // never cached.
    cache.del(orderSummaryCacheKey());
    return success(updated);
  } catch (error) {
    return serverError("Failed to void item", error);
  }
}
