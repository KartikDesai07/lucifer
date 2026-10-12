import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { success, failure, requireAuth, serverError } from "@/lib/api-helpers";
import { dayRange, escapeRegex } from "@/lib/utils";
import { parseListCursor, applyCursor } from "@/lib/order-query";

// GET /api/orders, split out of app/api/orders/route.ts (S5a, behaviour-
// preserving move) so the route file stops growing; the route's GET is a
// one-line delegate to listOrders.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /api/orders — always fresh (NO cache). Filters: status, tableNo, date,
// limit, before (cursor pagination: createdAt of the oldest row already seen)
export async function listOrders(req: Request) {
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
