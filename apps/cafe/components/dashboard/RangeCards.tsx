"use client";

import dynamic from "next/dynamic";
import { inr } from "@/lib/utils";
import { deltaRatio } from "@/lib/dashboard/fold";
import { plural, sharePercent } from "@/lib/dashboard/format";
import { chartNames, insightPeriod, kpiCompareText, noCompareText } from "@/lib/dashboard/labels";
import { dayLabel } from "@/lib/dashboard/range";
import { BrandSkeleton, DashCard, type DashCardStatus } from "@/components/dashboard/DashCard";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { RankedList, RANKED_ROW_PX, barsOf } from "@/components/dashboard/RankedList";
import { BusyHours } from "@/components/dashboard/BusyHours";
import { MoneyLeaks, MONEY_LEAK_ROWS } from "@/components/dashboard/MoneyLeaks";
import { SALES_CHART_BODY_PX } from "@/components/dashboard/chart-size";
import type { DashboardData } from "@/types/dashboard";

// The Dashboard's range-driven cards. Each reads the DashboardData actually on
// screen and says which period it covers; `status` is the query's (loading =
// nothing yet, error = nothing and the fetch failed), `updating` = the old
// range's numbers are showing, dimmed, while the newly picked range loads.

// Chart.js arrives in its own chunk, after the numbers — never in the first bundle.
const SalesChart = dynamic(() => import("@/components/dashboard/SalesChart").then((m) => m.SalesChart), {
  ssr: false,
  loading: () => (
    <div style={{ height: SALES_CHART_BODY_PX }}>
      <BrandSkeleton className="h-full w-full" />
    </div>
  ),
});

export interface RangeCardProps {
  data?: DashboardData;
  status: Exclude<DashCardStatus, "empty">;
  updating: boolean;
  onRetry: () => void;
  period: string;
  today: string;
}

// Reserved rows = the usual count (a cafe uses 2-4 payment modes, 2-3 channels);
// more rows simply grow the card, fewer never leave a tall blank block.
const PAYMENT_ROWS = 3;
const ITEM_ROWS = 5;
const CHANNEL_ROWS = 3;
const CATEGORY_ROWS = 6;
const LEAK_ROW_PX = 52;
const BUSY_HOURS_BODY_PX = 290;
// On a phone the grid turns sideways: one row per trading hour (a cafe open
// ~14 hours ≈ 500px with the readout), so the reservation is taller there.
const BUSY_HOURS_BODY_CLASS = "min-h-[500px] sm:min-h-[290px]";

const statusOf = (p: RangeCardProps, empty: boolean): DashCardStatus => (p.status !== "ready" ? p.status : empty ? "empty" : "ready");

export function KpiRow(p: RangeCardProps) {
  const d = p.data;
  const loading = p.status !== "ready" || !d;
  const cur = d?.kpis.current;
  const prev = d?.kpis.previous;
  const compare = d ? kpiCompareText(d) : "";
  const none = d ? noCompareText(d) : "";
  const common = { compareLabel: compare, noCompareText: none, loading, updating: p.updating };
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <KpiCard label="Net sales" value={inr(cur?.sales ?? 0)} delta={deltaRatio(cur?.sales ?? 0, prev?.sales ?? 0)} {...common} />
      <KpiCard label="Orders" value={String(cur?.orders ?? 0)} delta={deltaRatio(cur?.orders ?? 0, prev?.orders ?? 0)} {...common} />
      <KpiCard
        label="Average order"
        value={inr(cur?.averageOrder ?? 0)}
        delta={deltaRatio(cur?.averageOrder ?? 0, prev?.averageOrder ?? 0)}
        {...common}
      />
      <KpiCard
        label="Collected"
        value={inr(cur?.collected ?? 0)}
        delta={deltaRatio(cur?.collected ?? 0, prev?.collected ?? 0)}
        hint={d && d.duesCollected > 0 ? `+ ${inr(d.duesCollected)} paid against earlier dues` : undefined}
        {...common}
      />
    </div>
  );
}

export function SalesCard(p: RangeCardProps & { className?: string }) {
  const d = p.data;
  const hasSales = !!d && d.series.some((s) => s.sales > 0 || s.compareSales > 0);
  const names = d ? chartNames(d, p.today) : { current: "", compare: "" };
  const total = d?.kpis.current.sales ?? 0;
  const peak = d?.series.reduce((best, s) => (s.sales > best.sales ? s : best), d.series[0]);
  const aria = d
    ? `Sales ${d.mode === "hour" ? "by hour" : "by day"}, ${p.period}: ${inr(total)} in total${peak && peak.sales > 0 ? `, highest ${peak.label} with ${inr(peak.sales)}` : ""}.`
    : "";
  return (
    <DashCard
      className={p.className}
      title={d?.mode === "day" ? "Sales by day" : "Sales by hour"}
      period={d ? `${p.period} · ${d.compare.label}` : p.period}
      status={statusOf(p, !hasSales)}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={
        d?.range.to === p.today
          ? { title: "No sales yet", description: "Completed orders appear here as the day goes on." }
          : { title: "No sales in this period", description: "Pick another period, or check the Orders screen." }
      }
      bodyMinHeight={SALES_CHART_BODY_PX}
    >
      {d && <SalesChart series={d.series} currentName={names.current} compareName={names.compare} ariaLabel={aria} />}
    </DashCard>
  );
}

export function PaymentMixCard(p: RangeCardProps) {
  const rows = p.data?.payments ?? [];
  const bars = barsOf(rows, (r) => r.amount);
  return (
    <DashCard
      title="Payment mix"
      period={`${p.period} · money collected`}
      status={statusOf(p, rows.length === 0)}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={{ title: "No payments yet", description: "Money taken on completed orders shows here by payment mode." }}
      bodyMinHeight={PAYMENT_ROWS * RANKED_ROW_PX}
    >
      <RankedList
        rows={rows.map((r, i) => ({ key: r.key, label: `${r.label} · ${plural(r.count, "order")}`, value: inr(r.amount), detail: sharePercent(r.share), bar: bars[i] }))}
      />
      {rows.some((r) => (r.key === "Due" || r.key === "Credit") && r.count > 0) && (
        <p className="mt-2 text-[12px] leading-4 text-brand-muted">
          Due and credit bills show only what was paid so far — the rest is in customer dues.
        </p>
      )}
    </DashCard>
  );
}

export function TopItemsCard(p: RangeCardProps) {
  const rows = p.data?.topItems ?? [];
  const bars = barsOf(rows, (r) => r.revenue);
  return (
    <DashCard
      title="Top items"
      period={`${p.period} · by sales`}
      status={statusOf(p, rows.length === 0)}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={{ title: "Nothing sold yet", description: "Your best sellers show here once orders are completed." }}
      bodyMinHeight={ITEM_ROWS * RANKED_ROW_PX}
    >
      <RankedList rows={rows.map((r, i) => ({ key: r.label, label: r.label, value: inr(r.revenue), detail: `${r.qty} sold`, bar: bars[i] }))} />
    </DashCard>
  );
}

export function ChannelsCard(p: RangeCardProps) {
  const rows = p.data?.channels ?? [];
  const bars = barsOf(rows, (r) => r.amount);
  return (
    <DashCard
      title="Where orders come from"
      period={`${p.period} · completed orders`}
      status={statusOf(p, rows.length === 0)}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={{ title: "No orders yet", description: "Dine-in, takeaway, QR and counter orders are split out here." }}
      bodyMinHeight={CHANNEL_ROWS * RANKED_ROW_PX}
    >
      <RankedList
        rows={rows.map((r, i) => ({ key: r.key, label: `${r.label} · ${plural(r.count, "order")}`, value: inr(r.amount), detail: sharePercent(r.share), bar: bars[i] }))}
      />
    </DashCard>
  );
}

export function BusyHoursCard(p: RangeCardProps & { className?: string }) {
  const d = p.data;
  return (
    <DashCard
      className={p.className}
      title="Busy hours"
      period={d ? `Orders per hour on an average day · ${insightPeriod(d, p.today)}` : p.period}
      status={statusOf(p, !d || d.heat.hours.length === 0)}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={{ title: "Not enough orders yet", description: "Busy hours show once a few days of orders are in." }}
      bodyMinHeight={BUSY_HOURS_BODY_PX}
      bodyClassName={BUSY_HOURS_BODY_CLASS}
    >
      {d && <BusyHours heat={d.heat} />}
    </DashCard>
  );
}

export function SlowItemsCard(p: RangeCardProps) {
  const d = p.data;
  const rows = d?.slowItems ?? [];
  return (
    <DashCard
      title="Slow movers"
      period={d ? `Fewest sold · ${insightPeriod(d, p.today)}` : p.period}
      link={{ href: "/products", label: "Menu" }}
      status={statusOf(p, rows.length === 0)}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={{ title: "Nothing to flag", description: "Items that sell least over the period show here." }}
      bodyMinHeight={ITEM_ROWS * RANKED_ROW_PX}
    >
      <RankedList
        rows={rows.map((r) => ({
          key: r.productId,
          label: r.name,
          value: r.qty === 0 ? "Not sold" : `${r.qty} sold`,
          detail: r.since ? `since ${dayLabel(r.since)}` : undefined,
        }))}
      />
    </DashCard>
  );
}

export function CategoriesCard(p: RangeCardProps) {
  const rows = p.data?.categories ?? [];
  const bars = barsOf(rows, (r) => r.amount);
  return (
    <DashCard
      title="Sales by category"
      period={`${p.period} · share of item sales`}
      status={statusOf(p, rows.length === 0)}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={{ title: "No item sales yet", description: "Each menu category's share of sales shows here." }}
      bodyMinHeight={CATEGORY_ROWS * RANKED_ROW_PX}
    >
      <RankedList rows={rows.map((r, i) => ({ key: r.key, label: r.label, value: inr(r.amount), detail: sharePercent(r.share), bar: bars[i] }))} />
    </DashCard>
  );
}

export function LeaksCard(p: RangeCardProps & { className?: string }) {
  return (
    <DashCard
      className={p.className}
      title="Money leaks"
      period={`${p.period} · cancelled, voided and given away`}
      status={statusOf(p, false)}
      updating={p.updating}
      onRetry={p.onRetry}
      bodyMinHeight={MONEY_LEAK_ROWS * LEAK_ROW_PX}
    >
      {p.data && <MoneyLeaks leaks={p.data.leaks} />}
    </DashCard>
  );
}
