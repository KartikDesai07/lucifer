// Sales facet rows -> SalesReport — pure (no DB), so every report number is
// unit-testable; lib/reports/sales-build.ts only fetches and hands rows here.
// Mirrors lib/dashboard/fold.ts's own split between pipeline-adjacent rows
// and the pure fold that turns them into the DTO.
import { pickMoneyBreakdown } from "@/lib/money-breakdown";
import { addDays, compareLabel, compareRange, seriesMode } from "@/lib/dashboard/range";
import { buildSeries, foldKpis } from "@/lib/dashboard/fold";
import type { CompareFacet, TotalsRow } from "@/lib/dashboard/pipelines";
import type { SalesDayGroupRow, SalesFacet, DuesByDayRow } from "@/lib/reports/sales-pipelines";
import type { DashboardRange } from "@/types/dashboard";
import type { DuesReceived, PaymentModeRow, ReceivedSplit, SalesDayRow, SalesReport } from "@/types/reports";

const CASH_MODE = "Cash";
const ONLINE_MODE = "Online";

const EMPTY_RECEIVED: ReceivedSplit = { cash: 0, online: 0, other: 0, credit: 0 };
const EMPTY_DUES: DuesReceived = { cash: 0, online: 0, other: 0 };

/** One day's dues buckets, folded from every (day, mode) row that matches it. */
function duesForDay(rows: readonly DuesByDayRow[], day: string): DuesReceived {
  const out: DuesReceived = { ...EMPTY_DUES };
  for (const row of rows) {
    if (row._id.day !== day) continue;
    if (row._id.mode === CASH_MODE) out.cash += row.amount;
    else if (row._id.mode === ONLINE_MODE) out.online += row.amount;
    else out.other += row.amount;
  }
  return out;
}

function sumReceived(days: readonly SalesDayRow[]): ReceivedSplit {
  return days.reduce<ReceivedSplit>(
    (acc, d) => ({
      cash: acc.cash + d.cash,
      online: acc.online + d.online,
      other: acc.other + d.other,
      credit: acc.credit + d.credit,
    }),
    { ...EMPTY_RECEIVED },
  );
}

function sumDues(days: readonly SalesDayRow[]): DuesReceived {
  return days.reduce<DuesReceived>(
    (acc, d) => ({ cash: acc.cash + d.dues.cash, online: acc.online + d.dues.online, other: acc.other + d.dues.other }),
    { ...EMPTY_DUES },
  );
}

function foldPaymentModes(rows: SalesFacet["modes"]): PaymentModeRow[] {
  return rows
    .filter((r) => r.orders > 0)
    .map((r) => ({ mode: r._id, orders: r.orders, billed: r.billed, received: r.received }))
    .sort((a, b) => b.billed - a.billed || b.orders - a.orders);
}

function foldSplit(rows: SalesFacet["modes"]): SalesReport["split"] {
  const split = rows.find((r) => r._id === "Split");
  return { orders: split?.orders ?? 0, cash: split?.splitCash ?? 0, online: split?.splitOnline ?? 0 };
}

export interface FoldSalesReportInput {
  range: DashboardRange;
  // Accepted for signature parity with buildSalesReport/buildDashboard (the
  // caller's "as of when" clock) — unused here because every helper this
  // fold calls (compareRange/compareLabel/buildSeries) already takes the
  // range, never the clock, to decide its own output.
  now?: Date;
  facet: SalesFacet;
  compare: CompareFacet;
  duesRows: DuesByDayRow[];
}

export function foldSalesReport({ range, facet, compare, duesRows }: FoldSalesReportInput): SalesReport {
  const mode = seriesMode(range);
  const byDay = new Map<string, SalesDayGroupRow>(facet.days.map((d) => [d._id, d]));

  // Every IST day of the range, oldest first, zero rows included (a gap in
  // the daily table is still a day the cafe was open with nothing sold).
  const days: SalesDayRow[] = [];
  for (let key = range.from; key <= range.to; key = addDays(key, 1)) {
    const row = byDay.get(key);
    days.push({
      date: key,
      orders: row?.orders ?? 0,
      net: row?.net ?? 0,
      money: pickMoneyBreakdown(row),
      cash: row?.cash ?? 0,
      online: row?.online ?? 0,
      other: row?.other ?? 0,
      credit: row?.credit ?? 0,
      dues: duesForDay(duesRows, key),
    });
  }

  const totals = facet.totals[0];
  const cmpTotals = compare.totals[0];

  return {
    range,
    compare: { ...compareRange(range), label: compareLabel(range) },
    kpis: { current: foldKpis(totals as TotalsRow | undefined), previous: foldKpis(cmpTotals) },
    mode,
    series: buildSeries(mode, range, facet.series, compare.series),
    money: pickMoneyBreakdown(sumGross(facet.days)),
    received: sumReceived(days),
    dues: sumDues(days),
    payments: foldPaymentModes(facet.modes),
    split: foldSplit(facet.modes),
    days,
  };
}

// The totals facet ($group _id: null over SALES_TOTALS) does not carry the
// money-breakdown keys — the range's money is instead the Σ of the day rows,
// so the report's headline money and its own day table can never disagree
// (the same "totals = Σ of days" discipline PaymentModeRow/received/dues
// follow). gross/discount/reward/gst/charges are summed here explicitly.
function sumGross(dayRows: readonly SalesDayGroupRow[]) {
  return dayRows.reduce(
    (acc, d) => ({
      gross: acc.gross + d.gross,
      discount: acc.discount + d.discount,
      reward: acc.reward + d.reward,
      gst: acc.gst + d.gst,
      charges: acc.charges + d.charges,
    }),
    { gross: 0, discount: 0, reward: 0, gst: 0, charges: 0 },
  );
}
