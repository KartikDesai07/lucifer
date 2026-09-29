"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { inr } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import { cancelsCsvRows } from "@/lib/reports/csv-b2";
import { deltaRatio } from "@/lib/dashboard/fold";
import { plural } from "@/lib/dashboard/format";
import { useReportRange } from "@/components/reports/ReportRangeContext";
import { useCancelsReport } from "@/hooks/use-reports";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { DashCard, BrandSkeleton } from "@/components/dashboard/DashCard";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { REPORT_CHART_BODY_PX, type ReportChartBar } from "@/components/reports/chart-size";
import { ReportTable, type ReportTableColumn } from "@/components/reports/ReportTable";
import { TallyCard } from "@/components/reports/TallyCard";
import { CancelDaySheet } from "@/components/reports/CancelDaySheet";
import { StaffLeakTable, CancelledBillsTable, RemovedItemsTable, DiscountsTable } from "@/components/reports/CancelsTables";
import type { ReasonRow } from "@/types/reports";

const ReportChart = dynamic(() => import("@/components/reports/ReportChart").then((m) => m.ReportChart), {
  ssr: false,
  loading: () => (
    <div style={{ height: REPORT_CHART_BODY_PX }}>
      <BrandSkeleton className="h-full w-full" />
    </div>
  ),
});

const CANCELS_TALLY_RESERVE_LINES = 5;
const REASON_KIND_LABEL: Record<ReasonRow["kind"], string> = { cancel: "Cancel", remove: "Removed" };

export default function CancelsReportPage() {
  const { range, restored } = useReportRange();
  const report = useCancelsReport(range, restored);
  const r = report.data;
  const loading = !r;
  const updating = report.isPlaceholderData;
  const cardStatus = r ? "ready" : report.isError ? "error" : "loading";
  const retry = () => void report.refetch();

  const [openDay, setOpenDay] = useState<string | null>(null);

  const compareCaption = r ? `compared with the ${r.compare.label.replace(/^vs /, "")}` : "";

  const handleDownload = () => {
    if (!r) return;
    exportToCSV(cancelsCsvRows(r), `cancels-${r.range.from}-to-${r.range.to}`);
  };

  const moneyNotCollected = r
    ? r.kpis.current.discounts.amount + r.kpis.current.rewards.amount + r.kpis.current.cancelled.value + r.kpis.current.voids.value
    : 0;

  const chartBars: ReportChartBar[] = [
    { name: "Discounts & rewards", values: r?.series.map((s) => s.given) ?? [], tone: "primary" },
    { name: "Cancelled & removed", values: r?.series.map((s) => s.lost) ?? [], tone: "ink" },
  ];

  const onChartSelect = (index: number) => {
    if (!r) return;
    const point = r.series[index];
    if (!point) return;
    setOpenDay(r.mode === "hour" ? r.range.from : point.key);
  };

  const staffTotal = r ? r.byStaff.reduce((s, row) => s + row.cancelled.value + row.removed.value + row.discounts.amount, 0) : 0;

  const reasonColumns: ReportTableColumn<ReasonRow>[] = [
    { key: "kind", label: "Kind", cell: (row) => REASON_KIND_LABEL[row.kind], total: "Total" },
    { key: "reason", label: "Reason", cell: (row) => row.reason },
    { key: "count", label: "Count", align: "right", cell: (row) => row.count, total: r?.reasons.reduce((s, x) => s + x.count, 0) ?? 0 },
    { key: "value", label: "Amount", align: "right", strong: true, cell: (row) => inr(row.value), total: inr(r?.reasons.reduce((s, x) => s + x.value, 0) ?? 0) },
  ];

  return (
    <>
      <ReportHeader
        shownRange={r?.range}
        title="Cancel & discounts"
        description="Every cancel, removed item and discount — who and why"
        compareCaption={compareCaption}
        onDownload={handleDownload}
        downloadDisabled={!r}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard
          label="Discounts"
          value={inr(r?.kpis.current.discounts.amount ?? 0)}
          delta={deltaRatio(r?.kpis.current.discounts.amount ?? 0, r?.kpis.previous.discounts.amount ?? 0)}
          compareLabel={r?.compare.label ?? ""}
          noCompareText="No discounts in the earlier period"
          hint={r ? plural(r.kpis.current.discounts.orders, "bill") : undefined}
          upIsGood={false}
          loading={loading}
          updating={updating}
        />
        <KpiCard
          label="Rewards given"
          value={inr(r?.kpis.current.rewards.amount ?? 0)}
          delta={deltaRatio(r?.kpis.current.rewards.amount ?? 0, r?.kpis.previous.rewards.amount ?? 0)}
          compareLabel={r?.compare.label ?? ""}
          noCompareText="No rewards in the earlier period"
          hint={r ? plural(r.kpis.current.rewards.orders, "bill") : undefined}
          upIsGood={false}
          loading={loading}
          updating={updating}
        />
        <KpiCard
          label="Cancelled bills"
          value={inr(r?.kpis.current.cancelled.value ?? 0)}
          delta={deltaRatio(r?.kpis.current.cancelled.value ?? 0, r?.kpis.previous.cancelled.value ?? 0)}
          compareLabel={r?.compare.label ?? ""}
          noCompareText="No cancelled bills in the earlier period"
          hint={r ? plural(r.kpis.current.cancelled.count, "bill") : undefined}
          upIsGood={false}
          loading={loading}
          updating={updating}
        />
        <KpiCard
          label="Items removed"
          value={inr(r?.kpis.current.voids.value ?? 0)}
          delta={deltaRatio(r?.kpis.current.voids.value ?? 0, r?.kpis.previous.voids.value ?? 0)}
          compareLabel={r?.compare.label ?? ""}
          noCompareText="No items removed in the earlier period"
          hint={r ? plural(r.kpis.current.voids.qty, "item") : undefined}
          upIsGood={false}
          loading={loading}
          updating={updating}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DashCard
          className="lg:col-span-2"
          title={r?.mode === "hour" ? "Given away and lost, by hour" : "Given away and lost, by day"}
          period={r ? "Tap a bar for that day's details" : undefined}
          status={cardStatus}
          onRetry={retry}
          updating={updating}
          bodyMinHeight={REPORT_CHART_BODY_PX}
        >
          {r && (
            <div className="flex flex-col gap-2">
              <ReportChart
                labels={r.series.map((s) => s.label)}
                bars={chartBars}
                selected={null}
                onSelect={onChartSelect}
                ariaLabel={`Money given away and lost, ${inr(moneyNotCollected)} in total`}
              />
              <p className="text-[12.5px] text-brand-muted">
                {inr(r.kpis.current.discounts.amount + r.kpis.current.rewards.amount)} given away ·{" "}
                {inr(r.kpis.current.cancelled.value + r.kpis.current.voids.value)} lost to cancels & removals
              </p>
            </div>
          )}
        </DashCard>
        <TallyCard
          title="How it adds up"
          period="Every number here matches the table and the CSV"
          lines={
            r
              ? [
                  { label: "Discounts", amount: r.kpis.current.discounts.amount },
                  { label: "Rewards given", amount: r.kpis.current.rewards.amount },
                  { label: "Cancelled bills", amount: r.kpis.current.cancelled.value },
                  { label: "Items removed", amount: r.kpis.current.voids.value },
                  { label: "Money not collected", amount: moneyNotCollected, tone: "total" as const },
                ]
              : []
          }
          check={{
            label: "Staff table + rewards = the same total",
            parts: r ? [staffTotal, r.kpis.current.rewards.amount] : [],
            total: moneyNotCollected,
          }}
          status={cardStatus}
          onRetry={retry}
          updating={updating}
          reserveLines={CANCELS_TALLY_RESERVE_LINES}
        />
      </div>

      <DashCard title="By staff" status={r && r.byStaff.length === 0 ? "empty" : cardStatus} onRetry={retry} updating={updating} empty={{ title: "No staff activity in this period", description: "Cancels, removals and discounts by staff show here." }} bodyMinHeight={200}>
        {r && <StaffLeakTable rows={r.byStaff} loading={false} />}
      </DashCard>

      <DashCard title="Reasons" status={r && r.reasons.length === 0 ? "empty" : cardStatus} onRetry={retry} updating={updating} empty={{ title: "No reasons recorded", description: "Cancel and removal reasons show here." }} bodyMinHeight={160}>
        {r && (
          <ReportTable<ReasonRow>
            columns={reasonColumns}
            rows={r.reasons}
            rowKey={(row) => `${row.kind}-${row.reason}`}
            loading={false}
            phoneCard={{
              title: (row) => row.reason,
              value: (row) => inr(row.value),
              lines: (row) => [<span key="k">{REASON_KIND_LABEL[row.kind]}</span>, <span key="c">· {plural(row.count, "time")}</span>],
            }}
            emptyTitle="No reasons recorded"
            emptyDescription="Cancel and removal reasons show here."
          />
        )}
      </DashCard>

      <DashCard title="Cancelled bills" status={r && r.cancelled.rows.length === 0 ? "empty" : cardStatus} onRetry={retry} updating={updating} empty={{ title: "No cancelled bills in this period", description: "Cancelled bills show here." }} bodyMinHeight={200}>
        {r && (
          <div className="flex flex-col gap-2">
            <CancelledBillsTable rows={r.cancelled.rows} loading={false} onRowClick={(row) => setOpenDay(row.day)} total={r.kpis.current.cancelled} />
            {r.cancelled.truncated && <p className="text-[12px] text-brand-muted">Showing the latest {r.cancelled.rows.length} — pick a shorter period to see every one.</p>}
          </div>
        )}
      </DashCard>

      <DashCard title="Items removed" status={r && r.removed.rows.length === 0 ? "empty" : cardStatus} onRetry={retry} updating={updating} empty={{ title: "No items removed in this period", description: "Voided items show here." }} bodyMinHeight={200}>
        {r && (
          <div className="flex flex-col gap-2">
            <RemovedItemsTable rows={r.removed.rows} loading={false} onRowClick={(row) => setOpenDay(row.day)} total={r.kpis.current.voids} />
            {r.removed.truncated && <p className="text-[12px] text-brand-muted">Showing the latest {r.removed.rows.length} — pick a shorter period to see every one.</p>}
          </div>
        )}
      </DashCard>

      <DashCard title="Discounts & rewards" status={r && r.discounts.rows.length === 0 ? "empty" : cardStatus} onRetry={retry} updating={updating} empty={{ title: "No discounts or rewards in this period", description: "Manual discounts, GST discounts and rewards show here." }} bodyMinHeight={200}>
        {r && (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-brand-muted">Who took the order is shown — the bill does not record who gave the discount.</p>
            <DiscountsTable
              rows={r.discounts.rows}
              loading={false}
              onRowClick={(row) => setOpenDay(row.day)}
              total={{
                rows: r.kpis.current.discounts.orders + r.kpis.current.rewards.orders,
                amount: r.kpis.current.discounts.amount + r.kpis.current.rewards.amount,
              }}
            />
            {r.discounts.truncated && <p className="text-[12px] text-brand-muted">Showing the latest {r.discounts.rows.length} — pick a shorter period to see every one.</p>}
          </div>
        )}
      </DashCard>

      <CancelDaySheet day={openDay} report={r} onOpenChange={(open) => !open && setOpenDay(null)} />
    </>
  );
}
