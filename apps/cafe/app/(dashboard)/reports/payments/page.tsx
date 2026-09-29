"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { inr } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import { paymentsCsvRows } from "@/lib/reports/csv";
import { dayLabel, weekdayDayLabel } from "@/lib/dashboard/range";
import { plural } from "@/lib/dashboard/format";
import { useReportRange } from "@/components/reports/ReportRangeContext";
import { useSalesReport } from "@/hooks/use-reports";
import { DashCard, BrandSkeleton } from "@/components/dashboard/DashCard";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { StatCard } from "@/components/reports/StatCard";
import { REPORT_CHART_BODY_PX, type ReportChartBar } from "@/components/reports/chart-size";
import { ReportTable, type ReportTableColumn } from "@/components/reports/ReportTable";
import { TallyCard } from "@/components/reports/TallyCard";
import { DaySheet } from "@/components/reports/DaySheet";
import type { SalesDayRow } from "@/types/reports";

const ReportChart = dynamic(() => import("@/components/reports/ReportChart").then((m) => m.ReportChart), {
  ssr: false,
  loading: () => (
    <div style={{ height: REPORT_CHART_BODY_PX }}>
      <BrandSkeleton className="h-full w-full" />
    </div>
  ),
});

// Payments & cash tally (R4) — the SAME useSalesReport query as the Sales
// page (shared cache: switching between the two never re-fetches). Cash and
// online split into "from bills" vs "dues received", so the drawer count and
// the bank statement can each be matched against exactly the money in them.
export default function PaymentsReportPage() {
  const { range, restored } = useReportRange();
  const report = useSalesReport(range, restored);
  const r = report.data;
  const loading = !r;
  // keepPreviousData: while a newly picked period loads, the previous numbers
  // stay up — dimmed, and labelled with THEIR period (never a blank flash).
  const updating = report.isPlaceholderData;
  const cardStatus = r ? "ready" : report.isError ? "error" : "loading";
  const retry = () => void report.refetch();

  const [openDay, setOpenDay] = useState<string | null>(null);

  // Nothing on this page is compared with an earlier period — the caption says what the money is.
  const caption = r ? "money in, from bills and from earlier dues" : "";
  const cashTotal = r ? r.received.cash + r.dues.cash : 0;
  const onlineTotal = r ? r.received.online + r.dues.online : 0;

  const handleDownload = () => {
    if (!r) return;
    exportToCSV(paymentsCsvRows(r), `payments-${r.range.from}-to-${r.range.to}`);
  };

  const chartBars: ReportChartBar[] = [
    { name: "Cash", values: r?.days.map((d) => d.cash + d.dues.cash) ?? [], tone: "primary" },
    { name: "Online", values: r?.days.map((d) => d.online + d.dues.online) ?? [], tone: "ink" },
  ];

  const onChartSelect = (index: number) => {
    const day = r?.days[index];
    if (day) setOpenDay(day.date);
  };

  const otherNonZero = r ? r.days.some((d) => d.other !== 0) : false;

  const columns: ReportTableColumn<SalesDayRow>[] = r
    ? [
        { key: "day", label: "Day", cell: (row) => dayLabel(row.date), total: "Total" },
        { key: "cashBills", label: "Cash from bills", align: "right", cell: (row) => inr(row.cash), total: inr(r.received.cash) },
        { key: "cashDues", label: "Cash dues", align: "right", cell: (row) => inr(row.dues.cash), total: inr(r.dues.cash) },
        {
          key: "cashTotal",
          label: "Cash total",
          align: "right",
          strong: true,
          cell: (row) => inr(row.cash + row.dues.cash),
          total: inr(cashTotal),
        },
        { key: "onlineBills", label: "Online from bills", align: "right", cell: (row) => inr(row.online), total: inr(r.received.online) },
        { key: "onlineDues", label: "Online dues", align: "right", cell: (row) => inr(row.dues.online), total: inr(r.dues.online) },
        {
          key: "onlineTotal",
          label: "Online total",
          align: "right",
          strong: true,
          cell: (row) => inr(row.online + row.dues.online),
          total: inr(onlineTotal),
        },
        ...(otherNonZero
          ? [{ key: "other", label: "Other paid", align: "right" as const, cell: (row: SalesDayRow) => inr(row.other), total: inr(r.received.other) }]
          : []),
        { key: "credit", label: "Credit given", align: "right", cell: (row) => inr(row.credit), total: inr(r.received.credit) },
      ]
    : [];

  return (
    <>
      <ReportHeader
        shownRange={r?.range}
        title="Payments & cash tally"
        description="Match the cash drawer and the bank, day by day"
        compareCaption={caption}
        onDownload={handleDownload}
        downloadDisabled={!r}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Cash received"
          value={inr(cashTotal)}
          sub={r ? `${inr(r.received.cash)} from bills + ${inr(r.dues.cash)} dues` : undefined}
          loading={loading}
          updating={updating}
        />
        <StatCard
          label="Online received"
          value={inr(onlineTotal)}
          sub={r ? `${inr(r.received.online)} from bills + ${inr(r.dues.online)} dues · match with your bank` : undefined}
          loading={loading}
          updating={updating}
        />
        <StatCard
          label="Given on credit"
          value={inr(r?.received.credit ?? 0)}
          sub="Still to be paid"
          loading={loading}
          updating={updating}
        />
        <StatCard
          label="Split bills"
          value={String(r?.split.orders ?? 0)}
          sub={r ? `${inr(r.split.cash)} cash + ${inr(r.split.online)} online · already counted above` : undefined}
          loading={loading}
          updating={updating}
        />
      </div>

      <DashCard
        title="Cash and online by day"
        period="Tap a day for its full details"
        status={r && r.days.length === 0 ? "empty" : cardStatus}
        onRetry={retry}
        updating={updating}
        empty={{ title: "No payments in this period", description: "Pick another period to see the daily tally." }}
        bodyMinHeight={REPORT_CHART_BODY_PX}
      >
        {r && (
          <ReportChart
            labels={r.days.map((d) => dayLabel(d.date))}
            bars={chartBars}
            selected={null}
            onSelect={onChartSelect}
            ariaLabel={`Cash and online by day, ${inr(cashTotal)} cash and ${inr(onlineTotal)} online in total`}
          />
        )}
      </DashCard>

      {/* Full width: the tally has up to nine money columns, and a two-thirds card
          hid "Credit given" behind a sideways scroll at 1366px. */}
      <div className="flex flex-col gap-4">
        <DashCard
          title="Daily tally"
          period="Tap a day for its full details"
          status={r && r.days.length === 0 ? "empty" : cardStatus}
        onRetry={retry}
        updating={updating}
          empty={{ title: "No payments in this period", description: "Pick another period to see the daily tally." }}
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
                title: "Total",
                value: inr(cashTotal + onlineTotal),
                lines: [
                  <span key="c">Cash {inr(cashTotal)}</span>,
                  <span key="o">· Online {inr(onlineTotal)}</span>,
                  ...(r.received.credit !== 0 ? [<span key="cr">· Credit {inr(r.received.credit)}</span>] : []),
                ],
              }}
              phoneCard={{
                title: (row) => dayLabel(row.date),
                value: (row) => inr(row.cash + row.dues.cash + row.online + row.dues.online),
                lines: (row) => [
                  <span key="c">Cash {inr(row.cash + row.dues.cash)}</span>,
                  <span key="o">· Online {inr(row.online + row.dues.online)}</span>,
                  ...(row.credit !== 0 ? [<span key="cr">· Credit {inr(row.credit)}</span>] : []),
                ],
              }}
              emptyTitle="No payments in this period"
              emptyDescription="Pick another period to see the daily tally."
            />
          )}
        </DashCard>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
          <TallyCard
            title="Does it tally"
            lines={[]}
            check={{
              label: `Cash + online (+ other) from bills + credit given = net sales ${inr(r?.kpis.current.sales ?? 0)}`,
              // Bills only (dues receipts are money for OLD bills, never part
              // of this identity) — the same Σparts === net-sales check as the
              // Sales summary page's own TallyCard, read from the same report.
              parts: r ? [r.received.cash, r.received.online, r.received.other, r.received.credit] : [],
              total: r?.kpis.current.sales ?? 0,
            }}
            status={cardStatus}
          onRetry={retry}
          updating={updating}
          />
          <DashCard title="By payment mode" period="Bills settled in this period · received of billed" status={cardStatus}
          onRetry={retry}
          updating={updating} bodyMinHeight={160}>
            {r && (
              <ul className="flex flex-col divide-y divide-brand-rule/70">
                {r.payments.map((p) => (
                  <li key={p.mode} className="flex items-center justify-between gap-3 py-1.5 text-[13.5px]">
                    <span className="min-w-0 truncate text-brand-ink">
                      {p.mode} · {plural(p.orders, "bill")}
                    </span>
                    <span className="shrink-0 tabular-nums text-brand-ink">
                      {inr(p.received)} <span className="text-brand-muted">of {inr(p.billed)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DashCard>
        </div>
      </div>

      <DaySheet day={openDay} onOpenChange={(open) => !open && setOpenDay(null)} />
    </>
  );
}
