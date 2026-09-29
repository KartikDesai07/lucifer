// Order types & busy hours facet rows -> OrderTypesReport / HourDetail — pure
// (no DB). Reuses the Dashboard's own rules (foldKpis, foldChannels, foldHeat,
// CHANNELS) so this report and the Dashboard can never disagree for the same
// range, mirroring lib/reports/items-fold.ts's own split between
// pipeline-adjacent rows and the pure fold that turns them into the DTO.
import { CHANNELS, foldChannels, foldHeat, foldKpis } from "@/lib/dashboard/fold";
import type { HeatRow, TotalsRow } from "@/lib/dashboard/pipelines";
import { compareLabel, compareRange, hourLabel, weekdayDayLabel } from "@/lib/dashboard/range";
import type { HeatTypeRow, HourDayRow, HourTypeRow, OrderTypesFacet } from "@/lib/reports/order-types-pipelines";
import type { DashboardChannel, DashboardHeat, DashboardRange } from "@/types/dashboard";
import type { HourDetail, HourRow, OrderTypesReport } from "@/types/reports-b3";

const HOURS_PER_DAY = 24;
const EN_DASH = "–";

/** "11 pm – 12 am" — the same en dash as components/reports/DaySheet.tsx's own busiest-hour row. */
export function hourSpanLabel(hour: number): string {
  return `${hourLabel(hour)} ${EN_DASH} ${hourLabel((hour + 1) % HOURS_PER_DAY)}`;
}

function busiestHour(hours: HourRow[]): number | null {
  if (hours.length === 0) return null;
  let best = hours[0];
  for (const row of hours.slice(1)) {
    if (row.orders > best.orders || (row.orders === best.orders && row.sales > best.sales)) best = row;
  }
  return best.hour;
}

export interface FoldOrderTypesReportInput {
  range: DashboardRange;
  facet: OrderTypesFacet;
  compareTotals: TotalsRow[];
  heatRows: HeatTypeRow[];
  heatRange: DashboardRange;
}

export function foldOrderTypesReport({ range, facet, compareTotals, heatRows, heatRange }: FoldOrderTypesReportInput): OrderTypesReport {
  const compare = { ...compareRange(range), label: compareLabel(range) };
  const kpis = { current: foldKpis(facet.totals[0]), previous: foldKpis(compareTotals[0]) };

  const types = foldChannels(facet.types).map((r) => ({
    key: r.key,
    label: r.label,
    orders: r.count,
    sales: r.amount,
    averageOrder: r.count > 0 ? r.amount / r.count : 0,
    share: r.share,
  }));

  const hoursSeen = facet.hours.map((r) => r._id.hour);
  const hours: HourRow[] = [];
  if (hoursSeen.length > 0) {
    const byHourType = new Map<string, HourTypeRow>(facet.hours.map((r) => [`${r._id.hour}|${r._id.type}`, r]));
    for (let h = Math.min(...hoursSeen); h <= Math.max(...hoursSeen); h++) {
      const byType = {} as Record<DashboardChannel, { orders: number; sales: number }>;
      let orders = 0;
      let sales = 0;
      for (const c of CHANNELS) {
        const row = byHourType.get(`${h}|${c}`);
        const cell = { orders: row?.orders ?? 0, sales: row?.sales ?? 0 };
        byType[c] = cell;
        orders += cell.orders;
        sales += cell.sales;
      }
      hours.push({ hour: h, label: hourLabel(h), span: hourSpanLabel(h), orders, sales, byType });
    }
  }

  const heatAllRows: HeatRow[] = (() => {
    const byDowHour = new Map<string, { _id: { dow: number; hour: number }; orders: number }>();
    for (const r of heatRows) {
      const key = `${r._id.dow}|${r._id.hour}`;
      const acc = byDowHour.get(key) ?? { _id: { dow: r._id.dow, hour: r._id.hour }, orders: 0 };
      acc.orders += r.orders;
      byDowHour.set(key, acc);
    }
    return [...byDowHour.values()];
  })();

  const heatByType = {} as Record<DashboardChannel, DashboardHeat>;
  for (const c of CHANNELS) {
    const rows: HeatRow[] = heatRows.filter((r) => r._id.type === c).map((r) => ({ _id: { dow: r._id.dow, hour: r._id.hour }, orders: r.orders }));
    heatByType[c] = foldHeat(rows, heatRange);
  }

  return {
    range,
    compare,
    kpis,
    types,
    hours,
    busiestHour: busiestHour(hours),
    heat: { all: foldHeat(heatAllRows, heatRange), byType: heatByType },
  };
}

export interface FoldHourDetailInput {
  range: DashboardRange;
  hour: number;
  type: DashboardChannel | null;
  rows: HourDayRow[];
}

export function foldHourDetail({ range, hour, type, rows }: FoldHourDetailInput): HourDetail {
  const days = rows
    .filter((r) => r.orders > 0)
    .map((r) => ({ date: String(r._id), label: weekdayDayLabel(String(r._id)), orders: r.orders, sales: r.sales }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { range, hour, type, days };
}
