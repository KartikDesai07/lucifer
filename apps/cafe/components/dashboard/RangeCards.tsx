"use client";

import type { ReactNode } from "react";
import { QrCode, Store } from "lucide-react";
import { cafeHourOf, cn, inr } from "@/lib/utils";
import { CHANNEL_KIND, PAYMENT_KIND, STATUS_CLASSES, type StatusKind } from "@/lib/ui";
import { deltaRatio } from "@/lib/dashboard/fold";
import { plural, sharePercent } from "@/lib/dashboard/format";
import { compareShort, insightPeriod, kpiCompareText, noCompareText } from "@/lib/dashboard/labels";
import { chartSubline, salesChart } from "@/lib/dashboard/hour-bars";
import { dayLabel } from "@/lib/dashboard/range";
import { DashCard, type DashCardStatus } from "@/components/dashboard/DashCard";
import { HourBars, HourBarsLegend } from "@/components/dashboard/HourBars";
import { useNow } from "@/hooks/use-now";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { RankedList, RANKED_ROW_PX, barsOf } from "@/components/dashboard/RankedList";
import { BusyHours } from "@/components/dashboard/BusyHours";
import { DashGlyph } from "@/components/dashboard/DashGlyph";
import { LEAK_ROW_PX, MoneyLeaks, MoneyLeaksTotal, MONEY_LEAK_ROWS } from "@/components/dashboard/MoneyLeaks";
import type { DashboardChannel, DashboardData } from "@/types/dashboard";

// The Dashboard's range-driven cards. Each reads the DashboardData actually on
// screen and says which period it covers; `status` is the query's (loading =
// nothing yet, error = nothing and the fetch failed), `updating` = the old
// range's numbers are showing, dimmed, while the newly picked range loads.

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
const BUSY_HOURS_BODY_PX = 290;
// On a phone the grid turns sideways: one row per trading hour (a cafe open
// ~14 hours ≈ 500px with the readout), so the reservation is taller there.
const BUSY_HOURS_BODY_CLASS = "min-h-[500px] sm:min-h-[290px]";

const statusOf = (p: RangeCardProps, empty: boolean): DashCardStatus => (p.status !== "ready" ? p.status : empty ? "empty" : "ready");

/** One headline figure, as the hero and KpiRow show it. */
export interface KpiFigure {
  label: string;
  value: string;
  delta: number | null;
  compareLabel: string;
  noCompareText: string;
  hint?: string;
  upIsGood: boolean;
}

/**
 * The four headline figures — Net sales, Orders, Average order, Collected —
 * against the comparison period. With no data yet (loading) the labels are
 * still named, so the cards hold their place.
 */
export function kpiFigures(d: DashboardData | undefined): KpiFigure[] {
  const cur = d?.kpis.current;
  const prev = d?.kpis.previous;
  const compare = d ? kpiCompareText(d) : "";
  const none = d ? noCompareText(d) : "";
  const common = { compareLabel: compare, noCompareText: none, upIsGood: true };
  return [
    { label: "Net sales", value: inr(cur?.sales ?? 0), delta: deltaRatio(cur?.sales ?? 0, prev?.sales ?? 0), ...common },
    { label: "Orders", value: String(cur?.orders ?? 0), delta: deltaRatio(cur?.orders ?? 0, prev?.orders ?? 0), ...common },
    {
      label: "Average order",
      value: inr(cur?.averageOrder ?? 0),
      delta: deltaRatio(cur?.averageOrder ?? 0, prev?.averageOrder ?? 0),
      ...common,
    },
    {
      label: "Collected",
      value: inr(cur?.collected ?? 0),
      delta: deltaRatio(cur?.collected ?? 0, prev?.collected ?? 0),
      hint: d && d.duesCollected > 0 ? `+ ${inr(d.duesCollected)} paid against earlier dues` : undefined,
      ...common,
    },
  ];
}

export function KpiRow(p: RangeCardProps) {
  const loading = p.status !== "ready" || !p.data;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {kpiFigures(p.data).map((f) => (
        <KpiCard key={f.label} {...f} loading={loading} updating={p.updating} />
      ))}
    </div>
  );
}

/** The loaded chart's body (values 3.5): the 210px plot, 8px, the 14px x labels, then the footer's 14px + 12px over
 *  its 1px rule and one 17px line = 276px; on a phone (cw < 560) the footer takes two lines (+ 8px gap + 17px) = 301px.
 *  The skeleton and the empty state hold it, so the card never jumps. */
const SALES_BODY_PX = 210 + 8 + 14 + 14 + 12 + 1 + 17;
const SALES_BODY_CLASS = "min-h-[301px] @min-[560px]:min-h-[276px]";
/** The future hours of today follow the cafe clock; a minute is plenty for an hour boundary. */
const SALES_CLOCK_MS = 30_000;

/**
 * Sales by hour (one day) or by day (a span, ruling R15) as the owner's HTML bar chart (values 3.5): one bar per hour
 * from the first to the last hour with sales in either series (at least eight), today's later hours "not yet", the
 * peak in the accent, the comparison as a dashed line, Peak / Quietest / the comparison in the footer.
 */
export function SalesCard(p: RangeCardProps & { className?: string }) {
  const d = p.data;
  const now = useNow(SALES_CLOCK_MS);
  const hasSales = !!d && d.series.some((s) => s.sales > 0 || s.compareSales > 0);
  const isToday = !!d && d.range.from === p.today && d.range.to === p.today;
  const short = d ? compareShort(d.range, p.today) : "";
  const chart =
    d && hasSales
      ? salesChart({ points: d.series, mode: d.mode, isToday, currentHour: now ? cafeHourOf(now) : null, compareShort: short })
      : null;
  const total = d?.kpis.current.sales ?? 0;
  const peak = d?.series.reduce((best, s) => (s.sales > best.sales ? s : best), d.series[0]);
  const aria = d
    ? `Sales ${d.mode === "hour" ? "by hour" : "by day"}, ${p.period}: ${inr(total)} in total${peak && peak.sales > 0 ? `, highest ${peak.label} with ${inr(peak.sales)}` : ""}.`
    : "";
  return (
    <DashCard
      variant="dashboard"
      className={p.className}
      ui="sales-card"
      title={d?.mode === "day" ? "Sales by day" : "Sales by hour"}
      period={chart && d ? chartSubline(p.period, chart.bars, d.mode) : p.period}
      aside={chart ? <HourBarsLegend current={p.period} compare={short} /> : undefined}
      headWrap
      bodyGap={18}
      status={statusOf(p, !hasSales)}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={
        d?.range.to === p.today
          ? { title: "No sales yet", description: "Completed orders appear here as the day goes on." }
          : { title: "No sales in this period", description: "Pick another period, or check the Orders screen." }
      }
      bodyMinHeight={SALES_BODY_PX}
      bodyClassName={SALES_BODY_CLASS}
    >
      {chart && d && (
        <HourBars model={chart} ariaLabel={aria} currentName={p.period} compareName={short} period={`${d.range.from}:${d.range.to}`} />
      )}
    </DashCard>
  );
}

const kindOf = <K extends string>(map: Record<K, StatusKind>, key: string): StatusKind => map[key as K] ?? "neutral";

/** A source tile's icon (values 3.10, 5): the HTML's own glyphs for Dine-in (a table) and Takeaway (a bag); our QR and
 *  counter channels, which the HTML has not, keep lucide's QrCode and Store at the same 16px and 1.8 stroke. */
const CHANNEL_ICONS: Record<DashboardChannel, ReactNode> = {
  "dine-in": <DashGlyph d="M3 11h18M12 11v9M7 20h10M6 11V5M18 11V5" />,
  takeaway: <DashGlyph d="M6 7h12l-1 13H7zM9 7a3 3 0 0 1 6 0" />,
  qr: <QrCode className="size-4" strokeWidth={1.8} />,
  counter: <Store className="size-4" strokeWidth={1.8} />,
};

/** The head of How guests paid (values 3.9): the 31px mono total, 12px, the 10px bar, 10px to the rows. The loaded
 *  layout and the reserved body height both use these, so the card never jumps when data arrives. */
const MIX_TOTAL_PX = 31;
const MIX_TOTAL_GAP_PX = 12;
const MIX_BAR_PX = 10;
const MIX_BAR_GAP_PX = 10;
export const MIX_HEADER_PX = MIX_TOTAL_PX + MIX_TOTAL_GAP_PX + MIX_BAR_PX + MIX_BAR_GAP_PX;
/** A payment row: 8px + the 18px line + 8px, over its 1px rule. */
export const PAY_ROW_PX = 35;
export const PAYMENT_BODY_MIN_PX = PAYMENT_ROWS * PAY_ROW_PX + MIX_HEADER_PX;
/** A source row: 10px + the 34px tile + 10px inside its 1px box; the rows 8px apart. */
const SOURCE_ROW_PX = 56;
const SOURCE_ROW_GAP_PX = 8;
export const CHANNEL_BODY_PX = CHANNEL_ROWS * SOURCE_ROW_PX + (CHANNEL_ROWS - 1) * SOURCE_ROW_GAP_PX;

/** The stacked bar's segments: one per row with a share, width in percent to one decimal; none when nothing was collected. */
export function mixSegments<R extends { key: string; share: number }>(rows: R[]): Array<{ key: string; pct: number }> {
  return rows.filter((r) => r.share > 0).map((r) => ({ key: r.key, pct: Math.round(r.share * 1000) / 10 }));
}

/** The HTML's growX (values 3.9, 3.10): a fill grows in from its left edge (still with reduced motion). */
const GROW_X_CLASS = "origin-left motion-safe:animate-grow-x";

/**
 * How guests paid (values 3.9, ruling R17): the money collected in Geist Mono, a 10px bar of one segment per payment
 * mode on surface-3, then a row per mode (its swatch, "{mode} · {n} orders", the amount, the share) and, when a Due or
 * Credit bill is among them, the HTML's note that those count only what was paid so far.
 */
export function PaymentMixCard(p: RangeCardProps) {
  const rows = p.data?.payments ?? [];
  return (
    <DashCard
      variant="dashboard"
      ui="pay-card"
      title="How guests paid"
      period={`${p.period} · money collected`}
      status={statusOf(p, rows.length === 0)}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={{ title: "No payments yet", description: "Money taken on completed orders shows here by payment mode." }}
      bodyMinHeight={PAYMENT_BODY_MIN_PX}
    >
      <p data-ui="pay-total" className="font-mono text-[24px] font-medium tracking-[-0.03em]">
        {inr(rows.reduce((sum, r) => sum + r.amount, 0))}
      </p>
      <div data-ui="pay-bar" aria-hidden className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-[5px] bg-surface-3">
        {mixSegments(rows).map((s) => (
          <span key={s.key} data-ui="pay-seg" className={cn(STATUS_CLASSES[kindOf(PAYMENT_KIND, s.key)].dot, GROW_X_CLASS)} style={{ width: `${s.pct}%` }} />
        ))}
      </div>
      <ul data-ui="pay-list" className="mt-2.5 flex flex-col">
        {rows.map((r) => (
          <li key={r.key} data-ui="pay-row" className="flex items-center gap-2.5 border-t border-border-2 py-2 text-[13.5px]">
            <span data-ui="pay-swatch" aria-hidden className={cn("size-[9px] shrink-0 rounded-[3px]", STATUS_CLASSES[kindOf(PAYMENT_KIND, r.key)].dot)} />
            <span className="flex-1">
              {`${r.label} `}
              <span className="text-subtle-foreground">{`· ${plural(r.count, "order")}`}</span>
            </span>
            <span data-ui="pay-amount" className="font-mono font-semibold">
              {inr(r.amount)}
            </span>
            <span data-ui="pay-pct" className="w-9 text-right text-[12px] text-subtle-foreground">
              {sharePercent(r.share)}
            </span>
          </li>
        ))}
      </ul>
      {rows.some((r) => (r.key === "Due" || r.key === "Credit") && r.count > 0) && (
        <p data-ui="pay-note" className="mt-1.5 text-[12px] text-subtle-foreground text-pretty">
          Due bills count only what was paid so far — the rest sits in customer dues.
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
      variant="dashboard"
      title="Top items"
      bodyGap={8}
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

/**
 * Where orders came from (values 3.10, ruling R17): one bordered row per channel of ours (dine-in, takeaway, QR, counter)
 * with a 34px tile of our icon in the channel's status colours, "{channel} · {n} orders" over a 4px bar as long as its
 * share of the sales, the amount and the share.
 */
export function ChannelsCard(p: RangeCardProps) {
  const rows = p.data?.channels ?? [];
  return (
    <DashCard
      variant="dashboard"
      ui="src-card"
      title="Where orders came from"
      period={`${p.period} · completed orders`}
      status={statusOf(p, rows.length === 0)}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={{ title: "No orders yet", description: "Dine-in, takeaway, QR and counter orders are split out here." }}
      bodyMinHeight={CHANNEL_BODY_PX}
    >
      <ul data-ui="src-list" className="flex flex-col gap-2">
        {rows.map((r) => {
          const look = STATUS_CLASSES[kindOf(CHANNEL_KIND, r.key)];
          return (
            <li
              key={r.key}
              data-ui="src-row"
              data-channel={r.key}
              className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] border border-border-2 px-3 py-2.5"
            >
              <span data-ui="src-tile" aria-hidden className={cn("flex size-[34px] items-center justify-center rounded-[9px]", look.pill)}>
                {CHANNEL_ICONS[r.key as DashboardChannel] ?? CHANNEL_ICONS.counter}
              </span>
              <span className="min-w-0">
                <span data-ui="src-label" className="block text-[13.5px] font-medium">
                  {`${r.label} `}
                  <span className="font-normal text-subtle-foreground">{`· ${plural(r.count, "order")}`}</span>
                </span>
                <span data-ui="src-track" aria-hidden className="mt-[7px] block h-1 overflow-hidden rounded-[2px] bg-surface-3">
                  <span
                    data-ui="src-fill"
                    className={cn("block h-full rounded-[2px]", look.dot, GROW_X_CLASS)}
                    style={{ width: `${Math.round(r.share * 100)}%` }}
                  />
                </span>
              </span>
              <span className="text-right">
                <span data-ui="src-amount" className="block font-mono text-[13.5px] font-semibold">
                  {inr(r.amount)}
                </span>
                <span data-ui="src-pct" className="block text-[11.5px] text-subtle-foreground">
                  {sharePercent(r.share)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </DashCard>
  );
}

export function BusyHoursCard(p: RangeCardProps & { className?: string }) {
  const d = p.data;
  return (
    <DashCard
      variant="dashboard"
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

export function SlowItemsCard(p: RangeCardProps & { className?: string }) {
  const d = p.data;
  const rows = d?.slowItems ?? [];
  return (
    <DashCard
      variant="dashboard"
      className={p.className}
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
      variant="dashboard"
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

/** Money leaks (values 3.11, ruling R17): the HTML's head with the lost-total pill, then our four rows. */
export function LeaksCard(p: RangeCardProps & { className?: string }) {
  return (
    <DashCard
      variant="dashboard"
      ui="leak-card"
      className={p.className}
      title="Money leaks"
      period="Cancelled, voided and given away"
      aside={p.data ? <MoneyLeaksTotal leaks={p.data.leaks} updating={p.updating} /> : undefined}
      headGap={10}
      bodyGap={10}
      status={statusOf(p, false)}
      updating={p.updating}
      onRetry={p.onRetry}
      bodyMinHeight={MONEY_LEAK_ROWS * LEAK_ROW_PX}
    >
      {p.data && <MoneyLeaks leaks={p.data.leaks} />}
    </DashCard>
  );
}
