import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { success, failure, requireAdmin, validationError } from "@/lib/api-helpers";
import { dayRange } from "@/lib/utils";
import { CAFE_TIMEZONE } from "@/lib/constants";
import { reportRangeSchema } from "@/schemas";

export const dynamic = "force-dynamic";

const DEFAULT_RANGE_DAYS = 30;
const TOP_PRODUCTS_LIMIT = 10;
const DUES_LIMIT = 50;

type Totals = {
  _id: null;
  totalOrders: number;
  totalSales: number;
  totalCollected: number;
};
type PaymentGroup = { _id: string; amount: number; count: number };
type ProductGroup = { _id: string; qty: number; revenue: number };
type DayGroup = { _id: string; sales: number; orders: number };

const fmt = (d: Date) => d.toISOString().slice(0, 10);

// GET /api/reports?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
export async function GET(req: Request) {
  // Reports are admin-only (Phase 6 / CLAUDE.md §8).
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const sp = new URL(req.url).searchParams;
  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setDate(defaultStart.getDate() - DEFAULT_RANGE_DAYS);

  // Defaults are always valid, so omitting the params is fine; a *present* but
  // malformed/reversed/over-wide range is rejected with a 400 (defense-in-depth
  // — the client also guards the Generate button).
  const range = reportRangeSchema.safeParse({
    startDate: sp.get("startDate") ?? fmt(defaultStart),
    endDate: sp.get("endDate") ?? fmt(today),
  });
  if (!range.success) {
    return validationError(range.error.flatten().fieldErrors);
  }
  const { startDate, endDate } = range.data;

  try {
    await connectDB();
    const { start } = dayRange(new Date(startDate));
    const { end } = dayRange(new Date(endDate));
    const match = {
      createdAt: { $gte: start, $lte: end },
      status: "Completed",
    } as const;

    const [totalsRows, salesByPayment, topProducts, dayWise, customerDues] =
      await Promise.all([
        Order.aggregate<Totals>([
          { $match: match },
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              totalSales: { $sum: "$total" },
              totalCollected: { $sum: "$paidAmount" },
            },
          },
        ]),
        Order.aggregate<PaymentGroup>([
          { $match: match },
          {
            $group: {
              _id: "$payment",
              amount: { $sum: "$paidAmount" },
              count: { $sum: 1 },
            },
          },
          { $sort: { amount: -1 } },
        ]),
        Order.aggregate<ProductGroup>([
          { $match: match },
          { $unwind: "$items" },
          {
            $group: {
              _id: "$items.name",
              qty: { $sum: "$items.qty" },
              revenue: {
                $sum: { $multiply: ["$items.price", "$items.qty"] },
              },
            },
          },
          { $sort: { revenue: -1 } },
          { $limit: TOP_PRODUCTS_LIMIT },
        ]),
        Order.aggregate<DayGroup>([
          { $match: match },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$createdAt",
                  timezone: CAFE_TIMEZONE,
                },
              },
              sales: { $sum: "$total" },
              orders: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        Customer.find({ totalDue: { $gt: 0 } })
          .select("name mobile totalDue")
          .sort({ totalDue: -1 })
          .limit(DUES_LIMIT)
          .lean(),
      ]);

    const totals = totalsRows[0];
    const report = {
      range: { startDate, endDate },
      totals: {
        totalOrders: totals?.totalOrders ?? 0,
        totalSales: totals?.totalSales ?? 0,
        totalCollected: totals?.totalCollected ?? 0,
      },
      salesByPayment: salesByPayment.map((p) => ({
        payment: p._id,
        amount: p.amount,
        count: p.count,
      })),
      topProducts: topProducts.map((p) => ({
        name: p._id,
        qty: p.qty,
        revenue: p.revenue,
      })),
      dayWise: dayWise.map((d) => ({
        date: d._id,
        sales: d.sales,
        orders: d.orders,
      })),
      customerDues,
    };

    return success(report);
  } catch {
    return failure("Failed to build report");
  }
}
