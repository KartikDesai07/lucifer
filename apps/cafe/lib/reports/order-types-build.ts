// buildOrderTypesReport / buildHourDetail — the ONE place the Order types &
// busy hours report's numbers are computed, mirroring
// lib/reports/items-build.ts's own shape (route + the live leg both call these).
import { Order } from "@/models/Order";
import { compareWindow, currentWindow, insightRange } from "@/lib/dashboard/range";
import {
  heatByTypePipeline,
  hourDetailPipeline,
  orderTypesCompareTotals,
  orderTypesFacet,
  type HeatTypeRow,
  type HourDayRow,
  type OrderTypesFacet,
} from "@/lib/reports/order-types-pipelines";
import { foldHourDetail, foldOrderTypesReport } from "@/lib/reports/order-types-fold";
import type { TotalsRow } from "@/lib/dashboard/pipelines";
import type { DashboardChannel, DashboardRange } from "@/types/dashboard";
import type { HourDetail, OrderTypesReport } from "@/types/reports-b3";

export async function buildOrderTypesReport(range: DashboardRange, now: Date = new Date()): Promise<OrderTypesReport> {
  const current = currentWindow(range, now);
  const cmp = compareWindow(range, now);
  const heatRange = insightRange(range);
  const heatWindow = currentWindow(heatRange, now);

  const [facetRows, compareRows, heatRows] = await Promise.all([
    Order.aggregate<OrderTypesFacet>(orderTypesFacet(current)),
    Order.aggregate<TotalsRow>(orderTypesCompareTotals(cmp)),
    Order.aggregate<HeatTypeRow>(heatByTypePipeline(heatWindow)),
  ]);

  const facet = facetRows[0] ?? { totals: [], types: [], hours: [] };

  return foldOrderTypesReport({ range, facet, compareTotals: compareRows, heatRows, heatRange });
}

export async function buildHourDetail(
  range: DashboardRange,
  hour: number,
  type: DashboardChannel | null,
  now: Date = new Date(),
): Promise<HourDetail> {
  const current = currentWindow(range, now);
  const rows = await Order.aggregate<HourDayRow>(hourDetailPipeline(current, hour, type));
  return foldHourDetail({ range, hour, type, rows });
}
