"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { inr } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import { salesCsvRows } from "@/lib/reports/csv";
import { deltaRatio } from "@/lib/dashboard/fold";
import { plural } from "@/lib/dashboard/format";
import { dayLabel, weekdayDayLabel } from "@/lib/dashboard/range";
import { MONEY_BREAKDOWN_LINES, MONEY_NET_LABEL } from "@/lib/money-breakdown";
import { useReportRange } from "@/components/reports/ReportRangeContext";
import { useSalesReport } from "@/hooks/use-reports";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { DashCard, BrandSkeleton } from "@/components/dashboard/DashCard";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { REPORT_CHART_BODY_PX, type ReportChartBar } from "@/components/reports/chart-size";
import { ReportTable, type ReportTableColumn } from "@/components/reports/ReportTable";
import { TallyCard, type TallyLine } from "@/components/reports/TallyCard";
import { DaySheet } from "@/components/reports/DaySheet";
import type { SalesDayRow } from "@/types/reports";

// Chart.js arrives in its own chunk, after the numbers — never in the first bundle.
const ReportChart = dynamic(() => import("@/components/reports/ReportChart").then((m) => m.ReportChart), {
  ssr: false,
  loading: () => (
    <div style={{ height: REPORT_CHART_BODY_PX }}>
      <BrandSkeleton className="h-full w-full" />
    </div>
  ),
});

export default function SalesReportPage() {
  const { range, restored } = useReportRange();
  const report = useSalesReport(range, restored);
  const r = report.data;
  const loading = !r;
  // keepPreviousData: while a newly picked period loads, the previous numbers
  // stay up — dimmed, and labelled with THEIR period (never a blank flash).
  const updating = report.isPlaceholderData;
  const cardStatus = r ? "ready" : report.isError ? "error" : "loading";
  const retry = () => void report.refetch();

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const duesTotal = r ? r.dues.cash + r.dues.online + r.dues.other : 0;
  const compareCaption = r ? `compared with the ${r.compare.label.replace(/^vs /, "")}` : "";

  const handleDownload = () => {
    if (!r) return;
    exportToCSV(salesCsvRows(r), `sales-${r.range.from}-to-${r.range.to}`);
  };

  const chartLabels = r?.series.map((s) => s.label) ?? [];
  const chartBars: ReportChartBar[] = [{ name: "This period", values: r?.series.map((s) => s.sales) ?? [], tone: "primary" }];
  const compareName = r ? r.compare.label.replace(/^vs /, "") : "";
  const chartLine = r
    ? { name: compareName.charAt(0).toUpperCase() + compareName.slice(1), values: r.series.map((s) => s.compareSales) }
    : undefined;

  const readoutIndex = (() => {
    if (!r || r.series.length === 0) return null;
    if (selectedDay !== null) {
      const i = r.series.findIndex((s) => s.key === selectedDay);
      if (i >= 0) return i;
    }
    for (let i = r.series.length - 1; i >= 0; i--) if (r.series[i].sales > 0) return i;
    return r.series.length - 1;
  })();
  const readoutPoint = r && readoutIndex !== null ? r.series[readoutIndex] : null;

  const onChartSelect = (index: number) => {
    if (!r) return;
    const point = r.series[index];
    if (!point) return;
    if (r.mode === "day") {
      setSelectedDay(point.key);
      setOpenDay(point.key);
    } else {
      // Hour mode: the report covers a single day — open that day.
      setOpenDay(r.range.from);
    }
  };

  const tallyLines: TallyLine[] = r
    ? [
        ...MONEY_BREAKDOWN_LINES.map((line): TallyLine => ({ label: line.label, amount: r.money[line.key], sign: line.sign })),
        { label: MONEY_NET_LABEL, amount: r.kpis.current.sales, tone: "total" },
        { label: "Received in cash", amount: r.received.cash },
        { label: "Received online", amount: r.received.online },
        ...(r.received.other !== 0 ? [{ label: "Paid, mode not recorded", amount: r.received.other }] : []),
        { label: "Given on credit (due)", amount: r.received.credit },
      ]
    : [];

  const gstChargesNonZero = r ? r.days.some((d) => d.money.gst !== 0 || d.money.charges !== 0) : false;
  const otherNonZero = r ? r.days.some((d) => d.other !== 0) : false;

  const columns: ReportTableColumn<SalesDayRow>[] = r
    ? [
        { key: "day", label: "Day", cell: (row) => dayLabel(row.date), total: "Total" },
        { key: "orders", label: "Orders", align: "right", cell: (row) => row.orders, total: r.days.reduce((s, d) => s + d.orders, 0) },
        { key: "gross", label: "Gross", align: "right", cell: (row) => inr(row.money.gross), total: inr(r.money.gross) },
        {
          key: "discounts",
          label: "Discounts & rewards",
          align: "right",
          cell: (row) => inr(row.money.discount + row.money.reward),
          total: inr(r.money.discount + r.money.reward),
        },
        ...(gstChargesNonZero
          ? [
              {
                key: "gst",
                label: "GST & charges",
                align: "right" as const,
                cell: (row: SalesDayRow) => inr(row.money.gst + row.money.charges),
                total: inr(r.money.gst + r.money.charges),
              },
            ]
          : []),
        { key: "net", label: "Net sales", align: "right", strong: true, cell: (row) => inr(row.net), total: inr(r.kpis.current.sales) },
        { key: "cash", label: "Cash", align: "right", cell: (row) => inr(row.cash), total: inr(r.received.cash) },
        { key: "online", label: "Online", align: "right", cell: (row) => inr(row.online), total: inr(r.received.online) },
        ...(otherNonZero
          ? [{ key: "other", label: "Other paid", align: "right" as const, cell: (row: SalesDayRow) => inr(row.other), total: inr(r.received.other) }]
          : []),
        { key: "credit", label: "Credit", align: "right", cell: (row) => inr(row.credit), total: inr(r.received.credit) },
      ]
    : [];

  return (
    <>
      <ReportHeader
        shownRange={r?.range}
        title="Sales summary"
        description="What you sold, what came in, and how it adds up"
        compareCaption={compareCaption}
        onDownload={handleDownload}
        downloadDisabled={!r}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard
          label="Net sales"
          value={inr(r?.kpis.current.sales ?? 0)}
          delta={deltaRatio(r?.kpis.current.sales ?? 0, r?.kpis.previous.sales ?? 0)}
          compareLabel={r?.compare.label ?? ""}
          noCompareText="No orders in the earlier period"
          loading={loading}
          updating={updating}
        />
        <KpiCard
          label="Orders"
          value={String(r?.kpis.current.orders ?? 0)}
          delta={deltaRatio(r?.kpis.current.orders ?? 0, r?.kpis.previous.orders ?? 0)}
          compareLabel={r?.compare.label ?? ""}
          noCompareText="No orders in the earlier period"
          loading={loading}
          updating={updating}
        />
        <KpiCard
          label="Average bill"
          value={inr(r?.kpis.current.averageOrder ?? 0)}
          delta={deltaRatio(r?.kpis.current.averageOrder ?? 0, r?.kpis.previous.averageOrder ?? 0)}
          compareLabel={r?.compare.label ?? ""}
          noCompareText="No orders in the earlier period"
          loading={loading}
          updating={updating}
        />
        <KpiCard
          label="Money received"
          value={inr(r?.kpis.current.collected ?? 0)}
          delta={deltaRatio(r?.kpis.current.collected ?? 0, r?.kpis.previous.collected ?? 0)}
          compareLabel={r?.compare.label ?? ""}
          noCompareText="No orders in the earlier period"
          hint={duesTotal > 0 ? `+ ${inr(duesTotal)} from earlier dues` : undefined}
          loading={loading}
          updating={updating}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DashCard
          className="lg:col-span-2"
          title={r?.mode === "hour" ? "Net sales by hour" : "Net sales by day"}
          period={r ? `Tap a bar or a row below for that day's details` : undefined}
          status={cardStatus}
          onRetry={retry}
          updating={updating}
          bodyMinHeight={REPORT_CHART_BODY_PX}
        >
          {r && (
            <div className="flex flex-col gap-2">
              <ReportChart
                labels={chartLabels}
                bars={chartBars}
                line={chartLine}
                selected={readoutIndex}
                onSelect={onChartSelect}
                ariaLabel={`Net sales ${r.mode === "hour" ? "by hour" : "by day"}, ${inr(r.kpis.current.sales)} in total`}
              />
              {readoutPoint && readoutIndex !== null && (
                <button
                  type="button"
                  onClick={() => onChartSelect(readoutIndex)}
                  className="flex items-center justify-between gap-2 rounded-md bg-brand-primary-soft px-3 py-2 text-left text-[13px] text-brand-ink hover:bg-brand-wash"
                >
                  <span>
                    {r.mode === "hour" ? `${weekdayDayLabel(r.range.from)}, ${readoutPoint.label}` : weekdayDayLabel(readoutPoint.key)} ·{" "}
                    {inr(readoutPoint.sales)} · {plural(readoutPoint.orders, "order")}
                  </span>
                  <span className="shrink-0 font-medium">See details ›</span>
                </button>
              )}
            </div>
          )}
        </DashCard>
        <TallyCard
          title="How it adds up"
          period="Every number here matches the table and the CSV"
          lines={tallyLines}
          check={{
            label: r && r.received.other !== 0 ? "Cash + online + other + credit = net sales" : "Cash + online + credit = net sales",
            parts: r ? [r.received.cash, r.received.online, r.received.other, r.received.credit] : [],
            total: r?.kpis.current.sales ?? 0,
          }}
          status={cardStatus}
          onRetry={retry}
          updating={updating}
        />
      </div>

      <DashCard
        title="Day by day"
        period="Tap a day for its full details"
        status={r && r.days.length === 0 ? "empty" : cardStatus}
        onRetry={retry}
        updating={updating}
        empty={{ title: "No sales in this period", description: "Pick another period to see day-by-day sales." }}
        bodyMinHeight={240}
      >
        {r && (
          <ReportTable<SalesDayRow>
            columns={columns}
            rows={r.days}
            rowKey={(row) => row.date}
            onRowClick={(row) => setOpenDay(row.date)}
            actionLabel={(row) => `Details for ${weekdayDayLabel(row.date)}`}
            selectedKey={openDay}
            totalCard={{
              title: `Total · ${plural(r.days.length, "day")}`,
              value: inr(r.kpis.current.sales),
              lines: [<span key="o">{plural(r.kpis.current.orders, "order")}</span>],
            }}
            phoneCard={{
              title: (row) => dayLabel(row.date),
              value: (row) => inr(row.net),
              lines: (row) => [
                <span key="o">{plural(row.orders, "order")}</span>,
                <span key="d">· discounts & rewards {inr(row.money.discount + row.money.reward)}</span>,
                <span key="c">· Cash {inr(row.cash)}</span>,
                <span key="on">· Online {inr(row.online)}</span>,
                ...(row.credit !== 0 ? [<span key="cr">· Credit {inr(row.credit)}</span>] : []),
              ],
            }}
            emptyTitle="No sales in this period"
            emptyDescription="Pick another period to see day-by-day sales."
          />
        )}
      </DashCard>

      <DaySheet day={openDay} onOpenChange={(open) => !open && setOpenDay(null)} />
    </>
  );
}
