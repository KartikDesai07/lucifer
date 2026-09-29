"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { inr } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";
import { orderTypesCsvRows } from "@/lib/reports/csv-b3";
import { deltaRatio, CHANNEL_LABELS } from "@/lib/dashboard/fold";
import { plural, sharePercent } from "@/lib/dashboard/format";
import { dayLabel } from "@/lib/dashboard/range";
import { useReportRange } from "@/components/reports/ReportRangeContext";
import { useOrderTypesReport } from "@/hooks/use-reports";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { StatCard } from "@/components/reports/StatCard";
import { DashCard, BrandSkeleton } from "@/components/dashboard/DashCard";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { REPORT_CHART_BODY_PX, type ReportChartBar } from "@/components/reports/chart-size";
import { TallyCard, type TallyLine } from "@/components/reports/TallyCard";
import { OrderTypesTable, HoursTable, FilterChip } from "@/components/reports/OrderTypesTables";
import { HourSheet } from "@/components/reports/HourSheet";
import { BusyHours } from "@/components/dashboard/BusyHours";
import type { DashboardChannel } from "@/types/dashboard";
import type { HourRow } from "@/types/reports-b3";

const ReportChart = dynamic(() => import("@/components/reports/ReportChart").then((m) => m.ReportChart), {
  ssr: false,
  loading: () => (
    <div style={{ height: REPORT_CHART_BODY_PX }}>
      <BrandSkeleton className="h-full w-full" />
    </div>
  ),
});

type ChartMeasure = "orders" | "sales";
const ORDER_TYPES_TALLY_RESERVE_LINES = 5;
// Keeps "9" with its "pm" in the half-width Busiest hour card on a phone
// ("8 pm – / 9 pm", never "8 pm – 9 / pm").
const NO_BREAK_SPACE = "\u00a0";
// Same reservation as RangeCards' BusyHoursCard (components/dashboard/RangeCards.tsx
// BUSY_HOURS_BODY_PX / BUSY_HOURS_BODY_CLASS) — re-declared here rather than
// imported so this page never pulls in the Dashboard's range-card bundle.
const BUSY_HOURS_BODY_PX = 290;
const BUSY_HOURS_BODY_CLASS = "min-h-[500px] sm:min-h-[290px]";

export default function OrderTypesReportPage() {
  const { range, restored } = useReportRange();
  const report = useOrderTypesReport(range, restored);
  const r = report.data;
  const loading = !r;
  const updating = report.isPlaceholderData;
  const cardStatus = r ? "ready" : report.isError ? "error" : "loading";
  const retry = () => void report.refetch();

  const [measure, setMeasure] = useState<ChartMeasure>("orders");
  const [typeFilter, setTypeFilter] = useState<DashboardChannel | null>(null);
  const [openHour, setOpenHour] = useState<number | null>(null);
  // A type picked in an earlier period that has no bills in the one shown now
  // is not applied (an empty card would hide its own "Show all" chip).
  const activeType = typeFilter && r?.types.some((t) => t.key === typeFilter) ? typeFilter : null;

  const compareCaption = r ? `compared with the ${r.compare.label.replace(/^vs /, "")}` : "";

  const handleDownload = () => {
    if (!r) return;
    exportToCSV(orderTypesCsvRows(r), `order-types-${r.range.from}-to-${r.range.to}`);
  };

  const chartLabels = useMemo(() => (r ? r.hours.map((h) => h.label) : []), [r]);
  const chartBars = useMemo<ReportChartBar[]>(() => {
    if (!r) return [];
    const values = r.hours.map((h) => (activeType ? h.byType[activeType][measure] : h[measure]));
    return [{ name: measure === "orders" ? "Orders" : "Sales", values, tone: "primary" }];
  }, [r, measure, activeType]);

  const selectedHourIndex = r && openHour !== null ? r.hours.findIndex((h) => h.hour === openHour) : -1;

  const onChartSelect = (index: number) => {
    const hour = r?.hours[index];
    if (hour) setOpenHour(hour.hour);
  };

  const openRow: HourRow | null = r && openHour !== null ? (r.hours.find((h) => h.hour === openHour) ?? null) : null;

  const busiestRow = r && r.busiestHour !== null ? (r.hours.find((h) => h.hour === r.busiestHour) ?? null) : null;

  // The busiest hour of what is actually SHOWN — a filter can move the peak.
  // Same rule as the report's own busiestHour (most orders, then most sales,
  // then the earliest), so the readout and the KPI card never name different
  // hours for the same numbers; null when the shown type has no orders.
  const shownBusiest = useMemo(() => {
    if (!r) return null;
    if (!activeType) return busiestRow;
    let best: HourRow | null = null;
    for (const h of r.hours) {
      const hv = h.byType[activeType];
      const bv = best?.byType[activeType];
      if (hv.orders > 0 && (!bv || hv.orders > bv.orders || (hv.orders === bv.orders && hv.sales > bv.sales))) best = h;
    }
    return best;
  }, [r, activeType, busiestRow]);

  const heat = r ? (activeType ? r.heat.byType[activeType] : r.heat.all) : null;
  const heatIsRangeItself = r && heat ? heat.from === r.range.from && heat.to === r.range.to : false;

  const tallyLines: TallyLine[] = r
    ? [
        ...r.types.map((t, i) => ({ label: t.label, amount: t.sales, sign: i === 0 ? undefined : ("+" as const) })),
        { label: "Net sales", amount: r.kpis.current.sales, tone: "total" as const },
      ]
    : [];

  return (
    <>
      <ReportHeader
        shownRange={r?.range}
        title="Order types & busy hours"
        description="Dine-in, takeaway, QR and counter — and your busiest hours"
        compareCaption={compareCaption}
        onDownload={handleDownload}
        downloadDisabled={!r}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
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
          label="Net sales"
          value={inr(r?.kpis.current.sales ?? 0)}
          delta={deltaRatio(r?.kpis.current.sales ?? 0, r?.kpis.previous.sales ?? 0)}
          compareLabel={r?.compare.label ?? ""}
          noCompareText="No orders in the earlier period"
          loading={loading}
          updating={updating}
        />
        <KpiCard
          label="Average order"
          value={inr(r?.kpis.current.averageOrder ?? 0)}
          delta={deltaRatio(r?.kpis.current.averageOrder ?? 0, r?.kpis.previous.averageOrder ?? 0)}
          compareLabel={r?.compare.label ?? ""}
          noCompareText="No orders in the earlier period"
          loading={loading}
          updating={updating}
        />
        <StatCard
          label="Busiest hour"
          value={busiestRow ? busiestRow.span.replace(/ (am|pm)/g, `${NO_BREAK_SPACE}$1`) : "—"}
          sub={busiestRow ? `${plural(busiestRow.orders, "order")} · ${sharePercent(busiestRow.orders / (r?.kpis.current.orders || 1))} of orders` : undefined}
          loading={loading}
          updating={updating}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DashCard
          className="lg:col-span-2"
          title="Orders by hour"
          period="Tap a bar for that hour's details"
          status={r && r.hours.length === 0 ? "empty" : cardStatus}
          onRetry={retry}
          updating={updating}
          empty={{ title: "No orders in this period", description: "Pick another period to see busy hours." }}
          bodyMinHeight={REPORT_CHART_BODY_PX}
        >
          {r && (
            <div className="flex flex-col gap-3">
              {activeType && <FilterChip label={CHANNEL_LABELS[activeType]} onClear={() => setTypeFilter(null)} />}
              <div className="inline-flex w-fit rounded-md border border-brand-rule p-0.5">
                {(["orders", "sales"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={measure === m}
                    onClick={() => setMeasure(m)}
                    className={`rounded px-3 py-1 text-[12.5px] font-medium transition-colors ${
                      measure === m ? "bg-brand-primary text-brand-slip" : "text-brand-ink hover:bg-brand-wash"
                    }`}
                  >
                    {m === "orders" ? "By orders" : "By sales"}
                  </button>
                ))}
              </div>
              <ReportChart
                labels={chartLabels}
                bars={chartBars}
                selected={selectedHourIndex >= 0 ? selectedHourIndex : null}
                onSelect={onChartSelect}
                format={measure === "sales" ? "money" : "count"}
                ariaLabel={`${measure === "orders" ? "Orders" : "Sales"} by hour${activeType ? `, ${CHANNEL_LABELS[activeType]} only` : ""}`}
              />
              {shownBusiest && (
                <p className="text-[12.5px] text-brand-muted">
                  {shownBusiest.span} is the busiest: {plural(activeType ? shownBusiest.byType[activeType].orders : shownBusiest.orders, "order")} ·{" "}
                  {inr(activeType ? shownBusiest.byType[activeType].sales : shownBusiest.sales)}
                </p>
              )}
            </div>
          )}
        </DashCard>
        <TallyCard
          title="How it adds up"
          period="Net sales matches the Sales summary for the same dates"
          lines={tallyLines}
          check={{
            label: "Order types add up to net sales",
            parts: r ? r.types.map((t) => t.sales) : [],
            total: r?.kpis.current.sales ?? 0,
          }}
          status={cardStatus}
          onRetry={retry}
          updating={updating}
          reserveLines={ORDER_TYPES_TALLY_RESERVE_LINES}
        />
      </div>

      <DashCard
        title="Order types"
        period="Tap a type to see only its hours"
        status={r && r.types.length === 0 ? "empty" : cardStatus}
        onRetry={retry}
        updating={updating}
        empty={{ title: "No order types in this period", description: "Pick another period to see order type sales." }}
        bodyMinHeight={200}
      >
        {r && (
          <OrderTypesTable
            types={r.types}
            loading={false}
            selectedKey={activeType}
            onSelect={(key) => setTypeFilter(key)}
            totalOrders={r.kpis.current.orders}
            totalSales={r.kpis.current.sales}
            totalAverageOrder={r.kpis.current.averageOrder}
          />
        )}
      </DashCard>

      <DashCard
        title="By hour"
        period="Tap an hour for its days"
        status={r && r.hours.filter((h) => (activeType ? h.byType[activeType].orders : h.orders) > 0).length === 0 ? "empty" : cardStatus}
        onRetry={retry}
        updating={updating}
        empty={{ title: "No orders in this period", description: "Pick another period to see busy hours." }}
        bodyMinHeight={240}
      >
        {r && (
          <div className="flex flex-col gap-3">
            {activeType && <FilterChip label={CHANNEL_LABELS[activeType]} onClear={() => setTypeFilter(null)} />}
            <HoursTable
              hours={r.hours.filter((h) => (activeType ? h.byType[activeType].orders : h.orders) > 0)}
              loading={false}
              type={activeType}
              totalLabel={activeType ? `Total · ${CHANNEL_LABELS[activeType]}` : undefined}
              totalOrders={activeType ? (r.types.find((t) => t.key === activeType)?.orders ?? 0) : r.kpis.current.orders}
              totalSales={activeType ? (r.types.find((t) => t.key === activeType)?.sales ?? 0) : r.kpis.current.sales}
              totalAverageOrder={activeType ? (r.types.find((t) => t.key === activeType)?.averageOrder ?? 0) : r.kpis.current.averageOrder}
              onRowClick={(row) => setOpenHour(row.hour)}
            />
          </div>
        )}
      </DashCard>

      <DashCard
        title="Busy hours"
        period={
          r && heat
            ? heatIsRangeItself
              ? "Average orders per hour on each weekday"
              : `Last 4 weeks (${dayLabel(heat.from)} – ${dayLabel(heat.to)}) — busy hours need at least a week of orders`
            : undefined
        }
        status={r && heat && heat.hours.length === 0 ? "empty" : cardStatus}
        onRetry={retry}
        updating={updating}
        empty={{ title: "Not enough orders yet", description: "Busy hours show once a few days of orders are in." }}
        bodyMinHeight={BUSY_HOURS_BODY_PX}
        bodyClassName={BUSY_HOURS_BODY_CLASS}
      >
        {heat && <BusyHours heat={heat} />}
      </DashCard>

      <HourSheet row={openRow} type={activeType} range={r?.range ?? range} onOpenChange={(open) => !open && setOpenHour(null)} />
    </>
  );
}
