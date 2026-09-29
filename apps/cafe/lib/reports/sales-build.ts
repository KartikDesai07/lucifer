// buildSalesReport — the ONE place the Sales summary report's numbers are
// computed. The route (app/api/reports/sales/route.ts) and the live leg
// (scripts/verify-reports-live.ts) both call it, mirroring
// lib/dashboard/build.ts's own shape so Reports and the Dashboard agree on
// the same range's numbers.
import { Order } from "@/models/Order";
import { DuePayment } from "@/models/DuePayment";
import { compareFacet, type CompareFacet } from "@/lib/dashboard/pipelines";
import { compareRange, compareWindow, currentWindow, seriesMode, spanWindow } from "@/lib/dashboard/range";
import { salesFacet, duesByDayPipeline, type SalesFacet, type DuesByDayRow } from "@/lib/reports/sales-pipelines";
import { foldSalesReport } from "@/lib/reports/sales-fold";
import type { DashboardRange } from "@/types/dashboard";
import type { SalesReport } from "@/types/reports";

export async function buildSalesReport(range: DashboardRange, now: Date = new Date()): Promise<SalesReport> {
  const mode = seriesMode(range);
  const current = currentWindow(range, now);
  const cmpRange = compareRange(range);

  const [facetRows, compareRows, duesRows] = await Promise.all([
    Order.aggregate<SalesFacet>(salesFacet(current, mode)),
    Order.aggregate<CompareFacet>(compareFacet(spanWindow(cmpRange), compareWindow(range, now).end, mode)),
    DuePayment.aggregate<DuesByDayRow>(duesByDayPipeline(current)),
  ]);

  const facet = facetRows[0] ?? { days: [], series: [], totals: [], modes: [] };
  const compare = compareRows[0] ?? { totals: [], series: [] };

  return foldSalesReport({ range, now, facet, compare, duesRows });
}
