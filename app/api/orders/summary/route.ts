import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import cache, { TTL } from "@/lib/cache";
import { success, failure, requireAuth } from "@/lib/api-helpers";
import { dayRange, orderSummaryCacheKey, cafeHourOf } from "@/lib/utils";
import type { HourlyStat } from "@/types";

export const dynamic = "force-dynamic";

const TOP_PRODUCTS_LIMIT = 10;

type DuesAgg = { _id: null; total: number; customers: number };

// GET /api/orders/summary — today's dashboard aggregate (cached 30s).
// Completed-only metrics (sales/orders/payments/top products/collected) describe
// realized activity; in-progress reflects today's still-open (Pending) tabs;
// outstanding dues is the live receivables ledger across ALL customers.
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    const key = orderSummaryCacheKey();
    const cachedSummary = cache.get(key);
    if (cachedSummary) return success(cachedSummary);

    await connectDB();
    const { start, end } = dayRange();

    // All of today's orders (both statuses) + the live dues ledger in parallel.
    const [orders, duesRows] = await Promise.all([
      Order.find({ createdAt: { $gte: start, $lte: end } }).lean(),
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
      // never disagree for the same day. Dues later cleared via the settle endpoint
      // don't touch an order's paidAmount, so settlement cash is not counted here.
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
    };

    cache.set(key, summary, TTL.SUMMARY);
    return success(summary);
  } catch {
    return failure("Failed to build order summary");
  }
}
