// buildCancelsReport — the ONE place the Cancel & discounts report's numbers
// are computed, mirroring lib/reports/sales-build.ts's own shape (route + the
// live leg both call it).
import { Order } from "@/models/Order";
import { compareWindow, currentWindow, seriesMode } from "@/lib/dashboard/range";
import { LEAK_ROWS_LIMIT, foldCancelsReport } from "@/lib/reports/cancels-fold";
import { leakCompareTotals, leakFacet, type LeakCompareFacet, type LeakFacet } from "@/lib/reports/cancels-pipelines";
import type { DashboardRange } from "@/types/dashboard";
import type { CancelsReport } from "@/types/reports-b2";

export async function buildCancelsReport(range: DashboardRange, now: Date = new Date()): Promise<CancelsReport> {
  const mode = seriesMode(range);
  const current = currentWindow(range, now);

  const [facetRows, compareRows] = await Promise.all([
    Order.aggregate<LeakFacet>(leakFacet(current, mode, LEAK_ROWS_LIMIT)),
    Order.aggregate<LeakCompareFacet>(leakCompareTotals(compareWindow(range, now))),
  ]);

  const facet = facetRows[0] ?? {
    totals: [],
    cancelled: [],
    voids: [],
    givenSeries: [],
    cancelledSeries: [],
    voidSeries: [],
    cancelledRows: [],
    removedRows: [],
    discountRows: [],
    rewardRows: [],
    staffCancelled: [],
    staffRemoved: [],
    staffDiscounts: [],
    cancelReasons: [],
    removeReasons: [],
  };
  const compare = compareRows[0] ?? { totals: [], cancelled: [], voids: [] };

  return foldCancelsReport({ range, mode, facet, compare });
}
