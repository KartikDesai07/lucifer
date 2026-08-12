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
  serverError,
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
import { parseListCursor, applyCursor } from "@/lib/order-query";
import { createOrderSchema } from "@/schemas";
import { checkTableExists } from "@/lib/table-admin";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /api/orders — always fresh (NO cache). Filters: status, tableNo, date,
// limit, before (cursor pagination: createdAt of the oldest row already seen)
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
  const beforeParam = sp.get("before"); // cursor: createdAt of the last row already seen
  const limitParam = Number(sp.get("limit"));
  const limit = Math.min(
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  let cursor: Date | null = null;
  if (beforeParam) {
    cursor = parseListCursor(beforeParam);
    if (!cursor) return failure("Invalid `before` cursor", 400);
  }

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
    if (cursor) applyCursor(query, cursor);

    // Near-full projection is DELIBERATE (F2.10 audit): the detail sheet,
    // settle modal, and both receipts render from these list rows without a
    // per-order refetch, so every field except `updatedAt` is consumed
    // client-side. Only the one truly-unused field is excluded.
    const orders = await Order.find(query)
      .select("-updatedAt")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return success(orders);
  } catch (error) {
    return serverError("Failed to fetch orders", error);
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

    const unknownTable = await checkTableExists(data.tableNo);
    if (unknownTable) return failure(unknownTable, 400);

    // Money is server-authoritative — recompute from the items + the cafe's GST
    // config; never persist the client's subtotal/gst/total verbatim. paidAmount
    // may assert what was actually COLLECTED (derivePayment clamps it to the total).
    const settings = await getSettings();
    const gstCfg = gstConfigOf(settings);
    const totals = computeOrderTotals(data.items, data.discount, gstCfg);
    const pay = derivePayment(
      data.payment,
      totals.total,
      data.splitCash,
      data.splitOnline,
      data.paidAmount,
    );
    if ("error" in pay) return failure(pay.error, 400);

    const customerId =
      data.customerId && mongoose.isValidObjectId(data.customerId)
        ? data.customerId
        : undefined;

    // A held "Unpaid" open tab is unpaid by definition and must NEVER require a
    // customer — the exclusion below is essential, don't "simplify" it away.
    // Every other mode that leaves a remainder uncollected parks that remainder
    // on a customer's due, so the carrier must EXIST (not merely be present) —
    // an ObjectId that's well-formed but deleted would otherwise complete the
    // sale with the due recorded against nobody, invisible to the dues KPI.
    // Existence costs a query only on a sale that actually leaves a due.
    if (data.payment !== "Unpaid" && pay.paidAmount < totals.total) {
      const carrierExists = customerId
        ? (await Customer.exists({ _id: customerId })) != null
        : false;
      if (!carrierExists) {
        return failure("Select a customer — the unpaid remainder becomes their due", 400);
      }
    }

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
        status: data.status,
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
  } catch (error) {
    return serverError("Failed to create order", error);
  }
}
