// buildDashboard — the ONE place the dashboard's numbers are computed. The
// route (app/api/dashboard/route.ts) and the live leg
// (scripts/verify-dashboard-live.ts) both call it, so what the leg proves on a
// real mongod is exactly what the owner sees. Five parallel reads: the range
// (one $facet scan), the comparison period (one), the insight window's busy
// hours + units per product, the dues payments, and the menu (small, CORE).
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import { Category } from "@/models/Category";
import { DuePayment } from "@/models/DuePayment";
import { ACTIVE_DUE_PAYMENT } from "@/lib/due-payment";
import { pickMoneyBreakdown } from "@/lib/money-breakdown";
import { cafeDateString } from "@/lib/utils";
import {
  compareLabel,
  compareRange,
  compareWindow,
  currentWindow,
  INSIGHT_MIN_DAYS,
  insightRange,
  seriesMode,
  spanWindow,
} from "@/lib/dashboard/range";
import {
  compareFacet,
  heatPipeline,
  performanceFacet,
  productQtyPipeline,
  type CompareFacet,
  type HeatRow,
  type PerformanceFacet,
  type ProductQtyRow,
} from "@/lib/dashboard/pipelines";
import {
  buildSeries,
  foldCategories,
  foldChannels,
  foldHeat,
  foldKpis,
  foldPayments,
  foldSlowItems,
  foldTopItems,
  type ProductRef,
} from "@/lib/dashboard/fold";
import type { DashboardData, DashboardRange } from "@/types/dashboard";

interface ProductLean {
  _id: unknown;
  name: string;
  categoryId: unknown;
  available?: boolean;
  isActive?: boolean;
  createdAt?: Date;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function buildDashboard(range: DashboardRange, now: Date = new Date()): Promise<DashboardData> {
  const mode = seriesMode(range);
  const current = currentWindow(range, now);
  const cmpRange = compareRange(range);
  const insight = insightRange(range);
  const insightWindow = currentWindow(insight, now);

  const [perfRows, cmpRows, heatRows, qtyRows, duesRows, products, categories] = await Promise.all([
    Order.aggregate<PerformanceFacet>(performanceFacet(current, mode)),
    Order.aggregate<CompareFacet>(compareFacet(spanWindow(cmpRange), compareWindow(range, now).end, mode)),
    Order.aggregate<HeatRow>(heatPipeline(insightWindow)),
    Order.aggregate<ProductQtyRow>(productQtyPipeline(insightWindow)),
    // Money taken against PRE-EXISTING dues in the range (never folded into
    // collected); ACTIVE_DUE_PAYMENT drops soft-deleted receipts.
    DuePayment.aggregate<{ total: number }>([
      { $match: { createdAt: { $gte: current.start, $lte: current.end }, ...ACTIVE_DUE_PAYMENT } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Product.find({}).select("name categoryId available isActive createdAt").lean<ProductLean[]>(),
    Category.find({}).select("name").lean<Array<{ _id: unknown; name: string }>>(),
  ]);

  const perf = perfRows[0];
  const cmp = cmpRows[0];
  const totals = perf?.totals[0];

  const productCategory = new Map(products.map((p) => [String(p._id), String(p.categoryId)]));
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));

  // On sale: active and not marked unavailable, and on the menu for at least
  // a week of the window (a dish added yesterday has not had a fair chance);
  // a newer dish is ranked on its own days (foldSlowItems' per-day rate).
  const insightStart = insightWindow.start.getTime();
  const insightEnd = insightWindow.end.getTime();
  const slowCandidates: ProductRef[] = products
    .filter((p) => p.isActive !== false && p.available !== false)
    .flatMap((p) => {
      const created = p.createdAt ? new Date(p.createdAt).getTime() : insightStart;
      const onMenuFrom = Math.max(created, insightStart);
      const days = (insightEnd - onMenuFrom) / ONE_DAY_MS;
      if (days < INSIGHT_MIN_DAYS) return [];
      const since = created > insightStart ? cafeDateString(new Date(created)) : undefined;
      return [{ id: String(p._id), name: p.name, categoryId: String(p.categoryId), days, since }];
    });
  const qtyByProduct = new Map(qtyRows.map((r) => [String(r._id), r.qty]));

  return {
    range,
    mode,
    compare: { ...cmpRange, label: compareLabel(range) },
    kpis: { current: foldKpis(totals), previous: foldKpis(cmp?.totals[0]) },
    series: buildSeries(mode, range, perf?.series ?? [], cmp?.series ?? []),
    payments: foldPayments(perf?.payments ?? []),
    topItems: foldTopItems(perf?.items ?? []),
    slowItems: foldSlowItems(slowCandidates, qtyByProduct),
    categories: foldCategories(perf?.items ?? [], productCategory, categoryName),
    channels: foldChannels(perf?.channels ?? []),
    heat: foldHeat(heatRows, insight),
    leaks: {
      cancelled: { count: perf?.cancelled[0]?.count ?? 0, value: perf?.cancelled[0]?.value ?? 0 },
      voids: {
        lines: perf?.voids[0]?.lines ?? 0,
        qty: perf?.voids[0]?.qty ?? 0,
        value: perf?.voids[0]?.value ?? 0,
      },
      discounts: { orders: totals?.discountedOrders ?? 0, amount: totals?.discount ?? 0 },
      rewards: { orders: totals?.rewardedOrders ?? 0, amount: totals?.reward ?? 0 },
    },
    money: pickMoneyBreakdown(totals),
    duesCollected: duesRows[0]?.total ?? 0,
  };
}
