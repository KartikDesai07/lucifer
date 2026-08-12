import mongoose, { type FilterQuery } from "mongoose";
import { connectDB } from "@/lib/db";
import { Order, type IOrder } from "@/models/Order";
import { Customer } from "@/models/Customer";
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
import { orderSummaryCacheKey } from "@/lib/utils";
import { resolveSettleMoney, reconcileLedger, validCustomer } from "@/lib/order";
import { voidGuardFilter } from "@/lib/order-void";
import { getSettings, gstConfigOf } from "@/lib/settings";
import { settleOrderSchema } from "@/schemas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/orders/[id]/settle — take payment on an open tab and close it.
// Server-authoritative: paidAmount is derived from the order's stored total (or
// a settle-time discount recomputed against it) and the mode/collected-amount —
// see resolveSettleMoney. The customer ledger gets the order's full contribution
// applied now (a held tab contributed nothing at open), and the table is freed.
// Idempotent-safe: the update is conditional on the order still being Pending,
// so a double-fired settle applies the ledger delta exactly once.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Order not found");

  const parsed = await validateBody(req, settleOrderSchema);
  if ("error" in parsed) return parsed.error;
  const data = parsed.data;

  try {
    await connectDB();
    const old = await Order.findById(id).lean();
    if (!old) return notFound("Order not found");
    // The Pending CAS below would 409 anyway, but with a message that sends the
    // operator looking for a phantom concurrent edit.
    if (old.status === "Cancelled") return failure("Order was cancelled", 409);
    if (old.status === "Completed") return failure("Order already settled", 409);

    // No settle-time discount → price against the STORED total, exactly as
    // before. A supplied one recomputes from the tab's own items using the tab's
    // GST SNAPSHOT (same discipline as the items route), so a mid-tab GST change
    // can never retroactively alter an open tab's bill.
    const money = resolveSettleMoney({
      order: old,
      payment: data.payment,
      discount: data.discount,
      paidAmount: data.paidAmount,
      splitCash: data.splitCash,
      splitOnline: data.splitOnline,
      liveGst: gstConfigOf(await getSettings()),
    });
    if ("error" in money) return failure(money.error, 400);

    // A deliberate partial (paidAmount defined) was priced by the OPERATOR
    // against whatever total THEY saw client-side. If the server's freshly
    // recomputed total disagrees, that number means something different than
    // what they intended — reject rather than silently booking the wrong due.
    // The Pending+total CAS below can't catch this: it compares the server's
    // OWN fresh read (old.total) against the DB, not against what the
    // operator was looking at (CR1.2 regression: a stale snapshot on another
    // device let a short paidAmount get priced against a bill that had moved).
    if (
      data.paidAmount !== undefined &&
      data.total !== undefined &&
      data.total !== money.total
    ) {
      return failure("Tab changed — reopen it and try again", 409);
    }

    // The order's own customer is authoritative; the body may only ATTACH a
    // customer to a tab opened without one (never reassign an existing one).
    const attachId = !old.customerId ? validCustomer(data.customerId) : null;
    const isDeferred = data.payment === "Due" || data.payment === "Credit";

    // Resolve the attaching customer's name up front (snapshot server-side, never
    // trust a client-supplied name). attachName stays undefined if it was deleted.
    let attachName: string | undefined;
    if (attachId) {
      const cust = await Customer.findById(attachId).select("name").lean();
      attachName = cust?.name;
    }

    // Any settle that leaves a balance on the books — Due/Credit in full, or a
    // partial Cash/Online payment — parks that balance on a customer, so that
    // customer must EXIST — an ObjectId that's well-formed but deleted would
    // otherwise complete the order with the balance recorded against nobody
    // (money lost). A fully-discounted Rs 0 bill leaves no due at all and must
    // never demand one.
    if (money.leavesDue) {
      const carrierExists = old.customerId
        ? (await Customer.exists({ _id: old.customerId })) != null
        : !!attachName;
      if (!carrierExists) {
        return failure(
          isDeferred
            ? "Select an existing customer for Due or Credit orders"
            : "Select a customer — the unpaid remainder becomes their due",
          400,
        );
      }
    }

    const update: Record<string, unknown> = {
      payment: data.payment,
      paidAmount: money.paidAmount,
      status: "Completed",
    };
    if (money.totals) {
      update.subtotal = money.totals.subtotal;
      update.discount = money.totals.discount;
      update.gstAmount = money.totals.gstAmount;
      update.total = money.totals.total;
    }
    if (data.payment === "Split") {
      update.splitCash = money.splitCash;
      update.splitOnline = money.splitOnline;
    }
    if (attachId && attachName) {
      update.customerId = attachId;
      update.customerName = attachName;
    }

    // Conditional on still-Pending AND the total we priced against being
    // unchanged — that's the total we READ (old.total), not the total we WRITE
    // (which may be lower, since a settle-time discount can reduce it). This
    // makes a double-settle apply the ledger delta exactly once, AND prevents a
    // stale underpayment if a new KOT round raced in between the read and the
    // write (changed total → match fails → the staff reopens the now-larger
    // bill). The loser matches nothing and 409s.
    // The void-trail term covers the case the total term cannot see: on a fully
    // comped tab the total is already 0 and a void leaves it 0, so a void racing
    // this settle would pass the total check while `money` was priced from our
    // stale items — settling a bill that still charges the voided dish (arbiter
    // live-probe, CR1.3 review).
    const filter: FilterQuery<IOrder> = {
      _id: id,
      status: "Pending",
      total: old.total,
      ...voidGuardFilter(old.voids?.length ?? 0),
    };
    const updated = await Order.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!updated) {
      return failure("Tab changed or already settled — reopen it and try again", 409);
    }

    // Apply the full ledger effect now (the open tab contributed nothing at open).
    const touched = await reconcileLedger(old, updated);
    if (touched.size) cache.del("customers");

    // Free the table only if it still points to this order.
    if (updated.tableNo) {
      await Table.findOneAndUpdate(
        { tableNo: updated.tableNo, currentOrderId: updated.orderId },
        { status: "Available", currentOrderId: "" },
      );
      cache.del("tables");
    }

    // Today's KPIs change (tab leaves In-progress; collected/sales/dues move).
    cache.del(orderSummaryCacheKey());
    cache.del(orderSummaryCacheKey(new Date(updated.createdAt)));
    return success(updated);
  } catch (error) {
    return serverError("Failed to settle order", error);
  }
}
