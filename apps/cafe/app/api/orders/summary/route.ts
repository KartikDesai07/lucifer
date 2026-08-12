import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { DuePayment } from "@/models/DuePayment";
import cache, { TTL } from "@/lib/cache";
import { success, failure, requireAuth, serverError } from "@/lib/api-helpers";
import { cafeDateString, dayRange, orderSummaryCacheKey, cafeHourOf } from "@/lib/utils";
import { foldDuesCollected, type DuesCollectedRow } from "@/lib/due-payment";
import { parseSummaryDateParam } from "@/lib/summary-date";
import type { HourlyStat } from "@/types";

export const dynamic = "force-dynamic";

const TOP_PRODUCTS_LIMIT = 10;

type DuesAgg = { _id: null; total: number; customers: number };

// GET /api/orders/summary — one cafe-local day's dashboard aggregate (cached
// 30s per day), defaulting to today; `?date=YYYY-MM-DD` reviews a past day
// (CR1.5 Slice 5 — EOD for staff). Staff-accessible (requireAuth, not
// requireAdmin) is the point of that slice.
// Completed-only metrics (sales/orders/payments/top products/collected) describe
// realized activity; in-progress reflects that day's still-open (Pending) tabs;
// outstanding dues is the live receivables ledger across ALL customers (not
// day-scoped — it's a point-in-time balance, so a past date reports it as of NOW).
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsedDate = parseSummaryDateParam(new URL(req.url).searchParams.get("date"));
  if ("error" in parsedDate) return failure(parsedDate.error, 400);
  const { day } = parsedDate;

  // Only today's aggregation is worth caching — it's the one day still being
  // polled live. A user-chosen past/future ?date is requested once per print
  // and never again, so caching it would mint an unbounded set of lazy-expiry
  // keys in the shared cache Map (entries only expire on a same-key re-read).
  const isToday = cafeDateString(day) === cafeDateString();

  try {
    const key = orderSummaryCacheKey(day);
    const cachedSummary = cache.get(key);
    if (cachedSummary) return success(cachedSummary);

    await connectDB();
    const { start, end } = dayRange(day);

    // All of today's orders (both statuses) + the live dues ledger + today's
    // dues PAYMENTS (a separate line, CR1.4 — see the `duesCollected` comment
    // below) in parallel. Projection (F2.10 audit): the aggregate below
    // touches ONLY these paths — notes/modifiers/receiver/customerName etc.
    // never leave the DB.
    const [orders, duesRows, duesPaymentRows] = await Promise.all([
      Order.find({ createdAt: { $gte: start, $lte: end } })
        .select("status payment total paidAmount createdAt items.name items.qty items.price")
        .lean(),
      Customer.aggregate<DuesAgg>([
        { $match: { totalDue: { $gt: 0 } } },
        {
          $group: {
            _id: null,
            total: { $sum: "$totalDue" },
            customers: { $sum: 1 },
          },
        },
      ]),
      // One row per payment, NOT grouped by mode: foldDuesCollected's `count`
      // is `rows.length`, so pre-summing per mode here would undercount it
      // (one row per distinct mode used, instead of per payment taken).
      DuePayment.aggregate<DuesCollectedRow>([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        { $project: { _id: 0, mode: 1, amount: 1 } },
      ]),
    ]);

    const completed = orders.filter((o) => o.status === "Completed");

    // Uniform { amount, count } per payment mode (amount = collected paidAmount),
    // matching the /api/reports salesByPayment definition. Completed orders only.
    const byMode = (mode: string) => {
      const rows = completed.filter((o) => o.payment === mode);
      return {
        amount: rows.reduce((s, o) => s + o.paidAmount, 0),
        count: rows.length,
      };
    };

    // Top products today by revenue — aggregated in-memory from completed orders
    // (no extra DB round-trip), matching /api/reports.topProducts.
    const productTotals = new Map<string, { qty: number; revenue: number }>();
    for (const order of completed) {
      for (const item of order.items) {
        const row = productTotals.get(item.name) ?? { qty: 0, revenue: 0 };
        row.qty += item.qty;
        row.revenue += item.price * item.qty;
        productTotals.set(item.name, row);
      }
    }
    const topProducts = Array.from(productTotals, ([name, row]) => ({
      name,
      qty: row.qty,
      revenue: row.revenue,
    }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, TOP_PRODUCTS_LIMIT);

    // Hourly sales (completed) bucketed by cafe-local hour, returned as a
    // contiguous earliest→latest range so the chart shows a continuous curve
    // without a row of empty leading/trailing hours.
    const hourBuckets = new Map<number, { sales: number; orders: number }>();
    for (const order of completed) {
      const h = cafeHourOf(new Date(order.createdAt));
      const b = hourBuckets.get(h) ?? { sales: 0, orders: 0 };
      b.sales += order.total;
      b.orders += 1;
      hourBuckets.set(h, b);
    }
    const hourly: HourlyStat[] = [];
    if (hourBuckets.size > 0) {
      const hours = [...hourBuckets.keys()];
      const min = Math.min(...hours);
      const max = Math.max(...hours);
      for (let h = min; h <= max; h++) {
        const b = hourBuckets.get(h) ?? { sales: 0, orders: 0 };
        hourly.push({ hour: h, sales: b.sales, orders: b.orders });
      }
    }

    // Open (Pending) tabs today — count + total value still riding on the floor.
    const pending = orders.filter((o) => o.status === "Pending");
    const dues = duesRows[0];

    const summary = {
      totalOrders: completed.length,
      totalSales: completed.reduce((s, o) => s + o.total, 0),
      // Payments captured on today's COMPLETED orders (sum of paidAmount) — the
      // same definition as the reports endpoint's "Collected", so the two screens
      // never disagree for the same day. This stays order-paidAmount-only by
      // design (P7 pins the definition): money taken today against a
      // customer's PRE-EXISTING due is a separate line, `duesCollected` below
      // — merging the two would double-count on a day an order is both
      // settled and its due paid (CR1.4).
      collected: completed.reduce((s, o) => s + o.paidAmount, 0),
      inProgress: {
        count: pending.length,
        value: pending.reduce((s, o) => s + o.total, 0),
      },
      outstandingDues: {
        total: dues?.total ?? 0,
        customers: dues?.customers ?? 0,
      },
      paymentBreakdown: {
        Cash: byMode("Cash"),
        Online: byMode("Online"),
        Split: byMode("Split"),
        Due: byMode("Due"),
        Credit: byMode("Credit"),
      },
      topProducts,
      hourly,
      // Money taken today against a customer's PRE-EXISTING due (CR1.4) — see
      // the `collected` comment above for why this never folds into it.
      duesCollected: foldDuesCollected(duesPaymentRows),
    };

    if (isToday) {
      cache.set(key, summary, TTL.SUMMARY);
    }
    return success(summary);
  } catch (error) {
    return serverError("Failed to build order summary", error);
  }
}
