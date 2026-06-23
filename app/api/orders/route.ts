import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { Table } from "@/models/Table";
import { nextOrderSequence, bumpOrderSequenceTo } from "@/models/Counter";
import cache from "@/lib/cache";
import {
  success,
  created,
  failure,
  validateBody,
  requireAuth,
  isDuplicateKeyError,
} from "@/lib/api-helpers";
import {
  generateOrderId,
  dayRange,
  orderSummaryCacheKey,
  escapeRegex,
} from "@/lib/utils";
import { getSettings, gstConfigOf } from "@/lib/settings";
import { computeOrderTotals } from "@/lib/receipt";
import { derivePayment, ledgerContribution } from "@/lib/order";
import { createOrderSchema } from "@/schemas";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /api/orders — always fresh (NO cache). Filters: status, tableNo, date, limit
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const sp = new URL(req.url).searchParams;
  const status = sp.get("status");
  const tableNo = sp.get("tableNo");
  const payment = sp.get("payment");
  const customerId = sp.get("customerId");
  const phone = sp.get("phone")?.trim(); // search orders by the customer's mobile
  const date = sp.get("date"); // YYYY-MM-DD
  const limitParam = Number(sp.get("limit"));
  const limit = Math.min(
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  try {
    await connectDB();
    const query: Record<string, unknown> = {};
    if (status) query.status = status;
    if (tableNo) query.tableNo = tableNo;
    if (payment) query.payment = payment;
    if (customerId && mongoose.isValidObjectId(customerId)) {
      query.customerId = customerId;
    }
    // Phone search: orders don't store a phone, so reverse-look-up the matching
    // customers and filter by their ids. An explicit customerId param wins (the
    // UI never sends both). No match → an empty list (not "all orders").
    if (phone && query.customerId === undefined) {
      const matches = await Customer.find({
        mobile: new RegExp(escapeRegex(phone), "i"),
      })
        .select("_id")
        .limit(50)
        .lean();
      if (matches.length === 0) return success([]);
      query.customerId = { $in: matches.map((c) => c._id) };
    }
    if (date) {
      const { start, end } = dayRange(new Date(date));
      query.createdAt = { $gte: start, $lte: end };
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return success(orders);
  } catch {
    return failure("Failed to fetch orders");
  }
}

// POST /api/orders — create order, update customer stats + table status
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, createOrderSchema);
  if ("error" in parsed) return parsed.error;
  const data = parsed.data;

  try {
    await connectDB();

    // Money is server-authoritative — recompute from the items + the cafe's GST
    // config; never persist the client's subtotal/gst/total/paidAmount.
    const settings = await getSettings();
    const gstCfg = gstConfigOf(settings);
    const totals = computeOrderTotals(data.items, data.discount, gstCfg);
    const pay = derivePayment(data.payment, totals.total, data.splitCash, data.splitOnline);
    if ("error" in pay) return failure(pay.error, 400);

    const customerId =
      data.customerId && mongoose.isValidObjectId(data.customerId)
        ? data.customerId
        : undefined;

    const doc = {
      customerName: data.customerName,
      customerId,
      // The opening items are KOT round 1 (sent to the kitchen at creation —
      // whether a held tab or a one-shot paid order). Later rounds bump kotRounds.
      items: data.items.map((it) => ({ ...it, kotRound: 1 })),
      kotRounds: 1,
      subtotal: totals.subtotal,
      discount: totals.discount,
      gstAmount: totals.gstAmount,
      // Snapshot the GST config in effect now, so this order's receipt reflects
      // the tax actually charged even after a later rate/mode change.
      gstRate: gstCfg.gstEnabled ? gstCfg.gstRate : 0,
      gstMode: gstCfg.gstMode,
      total: totals.total,
      paidAmount: pay.paidAmount,
      payment: data.payment,
      splitCash: pay.splitCash,
      splitOnline: pay.splitOnline,
      status: data.status,
      receiver: authed.session.user?.name ?? data.receiver, // trust the session, not the client
      tableNo: data.tableNo,
      notes: data.notes,
    };

    // Order number from an atomic per-day counter (no read-max race). On the
    // rare collision with orders predating the counter, reseed from the day's
    // max once — the unique index on orderId is the safety net.
    const seq = await nextOrderSequence();
    let order;
    try {
      order = await Order.create({ ...doc, orderId: generateOrderId(seq) });
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e;
      const { start, end } = dayRange();
      const last = await Order.findOne({ createdAt: { $gte: start, $lte: end } })
        .sort({ orderId: -1 })
        .select("orderId")
        .lean();
      const lastSeq = last?.orderId
        ? parseInt(last.orderId.split("-").pop() ?? "", 10)
        : 0;
      const seq2 = await bumpOrderSequenceTo(Number.isFinite(lastSeq) ? lastSeq : 0);
      order = await Order.create({ ...doc, orderId: generateOrderId(seq2) });
    }

    // The order row is now the source of truth. The ledger + table updates are
    // best-effort follow-ups: a failure here must NOT fail the request (that
    // would invite a retry → duplicate order). Any drift is repairable via the
    // customer reconcile endpoint.
    if (customerId) {
      // A held "Unpaid" open tab contributes nothing yet (ledgerContribution → 0);
      // its visit/spend/due land at settlement. Every other order contributes now.
      const c = ledgerContribution({
        payment: data.payment,
        total: totals.total,
        paidAmount: pay.paidAmount,
      });
      if (c.visits || c.spend || c.due) {
        try {
          await Customer.findByIdAndUpdate(customerId, {
            $inc: { visits: c.visits, totalSpend: c.spend, totalDue: c.due },
          });
          cache.del("customers");
        } catch {
          /* best-effort — recoverable via reconcile */
        }
      }
    }

    // Occupy the table ONLY if it is currently free, so two staff can't claim
    // the same table and overwrite each other's currentOrderId.
    if (data.tableNo) {
      try {
        await Table.findOneAndUpdate(
          { tableNo: data.tableNo, status: "Available" },
          { status: "Occupied", currentOrderId: order.orderId },
        );
        cache.del("tables");
      } catch {
        /* best-effort */
      }
    }

    cache.del(orderSummaryCacheKey());
    return created(order);
  } catch {
    return failure("Failed to create order");
  }
}
