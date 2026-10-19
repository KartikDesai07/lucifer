"use client";

import type { ReactNode } from "react";
import { QrCode, Store } from "lucide-react";
import { cafeHourOf, cn, inr } from "@/lib/utils";
import { CHANNEL_KIND, PAYMENT_KIND, STATUS_CLASSES, categoryHue, type StatusKind } from "@/lib/ui";
import { deltaRatio } from "@/lib/dashboard/fold";
import { plural, sharePercent } from "@/lib/dashboard/format";
import { compareShort, insightWords, kpiCompareText, noCompareText, slowItemLine } from "@/lib/dashboard/labels";
import { chartSubline, salesChart } from "@/lib/dashboard/hour-bars";
import { DASH_PILL_CLASS, DashCard, type DashCardStatus } from "@/components/dashboard/DashCard";
import { HourBars, HourBarsLegend } from "@/components/dashboard/HourBars";
import { useNow } from "@/hooks/use-now";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { BusyHoursCap, BusyHoursGrid, useHeatPick } from "@/components/dashboard/BusyHours";
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
/** Busy hours' body (values 3.15): the 14px hour labels, 4px, seven 30px rows 4px apart, 14px, the 17px footer = 283px;
 *  on a phone (cw < 560) the footer wraps the legend under the busiest line (+ 10px + 17px) = 310px. */
const BUSY_HOURS_BODY_PX = 14 + 4 + 7 * 30 + 6 * 4 + 14 + 17;
const BUSY_HOURS_BODY_CLASS = "min-h-[310px] @min-[560px]:min-h-[283px]";

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

/** A Top items row (values 3.12): 8px + the 18px amount and the 15px "n sold" + 8px. */
const TOP_ROW_PX = 49;
/** A category row (values 3.13): 8px + the 18px line + 8px over its 1px rule; above the rows, the 26px bar and 10px. */
const CATEGORY_ROW_PX = 35;
const CATEGORY_BAR_PX = 26 + 10;
/** A slow mover (values 3.14): 9px + the 18px name, 2px and the 16px line + 9px over its 1px rule. */
const SLOW_ROW_PX = 55;

/** The HTML sets font-variant-numeric: tabular-nums on its whole page (values 1.4): these cards' digits in Geist ("2
 *  sold", "48%", "11am", "Sat, 8 pm") take the same widths. */
const HTML_NUMERALS = "tabular-nums";

/** Our top items and slow movers carry no category, so their dot takes the HTML's own fallback hue, text-3. */
const ITEM_DOT_CLASS = "size-[7px] flex-none rounded-[50%] bg-subtle-foreground";
/** The name line Top items and Slow movers share (values 3.12, 3.14): the dot, 7px, the name ellipsised, 13.5/500. */
const ITEM_NAME_CLASS = "flex items-center gap-[7px] overflow-hidden whitespace-nowrap text-[13.5px] font-medium";

/** Bars relative to the longest row, in whole percent (the HTML's round(a / top * 100)). */
const barPercents = <T,>(rows: T[], amount: (row: T) => number): number[] => {
  const max = Math.max(0, ...rows.map(amount));
  return rows.map((r) => (max > 0 ? Math.round((amount(r) / max) * 100) : 0));
};

/**
 * Top items (values 3.12): a ranked row per item of ours (the best five by sales): the two-digit rank in Geist Mono
 * (01 in the brand red), a 7px dot and the name over a 4px accent bar as long as its sales against the first, the
 * amount and "{qty} sold".
 */
export function TopItemsCard(p: RangeCardProps) {
  const rows = p.data?.topItems ?? [];
  const bars = barPercents(rows, (r) => r.revenue);
  return (
    <DashCard
      variant="dashboard"
      ui="top-card"
      title="Top items"
      bodyGap={8}
      className={HTML_NUMERALS}
      period={`${p.period} · by sales`}
      status={statusOf(p, rows.length === 0)}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={{ title: "Nothing sold yet", description: "Your best sellers show here once orders are completed." }}
      bodyMinHeight={ITEM_ROWS * TOP_ROW_PX}
    >
      <ol data-ui="top-list" className="flex flex-col">
        {rows.map((r, i) => (
          <li key={r.label} data-ui="top-row" className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 py-2">
            <span data-ui="top-rank" className={cn("font-mono text-[13px] font-semibold", i === 0 ? "text-brand-red" : "text-subtle-foreground")}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <span data-ui="top-name" className={ITEM_NAME_CLASS} title={r.label}>
                <span data-ui="top-dot" aria-hidden className={ITEM_DOT_CLASS} />
                <span className="truncate">{r.label}</span>
              </span>
              <span data-ui="top-bar" aria-hidden className="mt-[7px] block h-1 overflow-hidden rounded-[2px] bg-surface-3">
                <span
                  data-ui="top-fill"
                  className="block h-full rounded-[2px] bg-primary origin-left motion-safe:animate-grow-x-slow"
                  style={{ width: `${bars[i]}%` }}
                />
              </span>
            </span>
            <span data-ui="top-right" className="text-right">
              <span data-ui="top-amount" className="block font-mono text-[13.5px] font-semibold">
                {inr(r.revenue)}
              </span>
              <span data-ui="top-sold" className="block text-[11.5px] text-subtle-foreground">
                {`${r.qty} sold`}
              </span>
            </span>
          </li>
        ))}
      </ol>
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

/**
 * Busy hours (values 3.15, ruling R19): orders per hour on an average day of each weekday over our insight window, the
 * HTML's grid at every width (a phone scrolls it sideways), the head's cap box reading out the hovered, tapped or
 * focused hour, the busiest hour and the legend below.
 */
export function BusyHoursCard(p: RangeCardProps & { className?: string }) {
  const d = p.data;
  const status = statusOf(p, !d || d.heat.hours.length === 0);
  const pick = useHeatPick(d?.heat);
  return (
    <DashCard
      variant="dashboard"
      ui="busy-card"
      className={cn(p.className, HTML_NUMERALS)}
      title="Busy hours"
      period={d ? `Orders per hour on an average day · ${insightWords(d, p.today)}` : p.period}
      aside={status === "loading" || status === "ready" ? <BusyHoursCap heat={d?.heat} cell={pick.cell} updating={p.updating} /> : undefined}
      headWrap
      status={status}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={{ title: "Not enough orders yet", description: "Busy hours show once a few days of orders are in." }}
      bodyMinHeight={BUSY_HOURS_BODY_PX}
      bodyClassName={BUSY_HOURS_BODY_CLASS}
    >
      {d && <BusyHoursGrid heat={d.heat} today={p.today} cell={pick.cell} onPick={pick.pick} onClear={pick.clear} />}
    </DashCard>
  );
}

/**
 * Slow movers (values 3.14, ruling R21): our five slowest dishes on sale, each with a 7px dot, the name and the HTML's
 * line under it from our data, and the tag pill ("Not sold" in warn, "{qty} sold" in surface-3); "Menu →" to our menu.
 */
export function SlowItemsCard(p: RangeCardProps & { className?: string }) {
  const d = p.data;
  const rows = d?.slowItems ?? [];
  return (
    <DashCard
      variant="dashboard"
      ui="slow-card"
      className={cn(p.className, HTML_NUMERALS)}
      title="Slow movers"
      period={d ? `Fewest sold · ${insightWords(d, p.today)}` : p.period}
      link={{ href: "/products", label: "Menu" }}
      headGap={10}
      bodyGap={10}
      status={statusOf(p, rows.length === 0)}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={{ title: "Nothing to flag", description: "Items that sell least over the period show here." }}
      bodyMinHeight={ITEM_ROWS * SLOW_ROW_PX}
    >
      {d && (
        <ul data-ui="slow-list" className="flex flex-col">
          {rows.map((r) => (
            <li key={r.productId} data-ui="slow-row" className="flex items-center gap-2.5 border-t border-border-2 py-[9px]">
              <span className="min-w-0 flex-1">
                <span data-ui="slow-name" className={ITEM_NAME_CLASS} title={r.name}>
                  <span data-ui="slow-dot" aria-hidden className={ITEM_DOT_CLASS} />
                  <span className="truncate">{r.name}</span>
                </span>
                <span data-ui="slow-since" className="mt-0.5 block pl-3.5 text-[12px] text-subtle-foreground">
                  {slowItemLine(r, d, p.today)}
                </span>
              </span>
              <span
                data-ui="slow-tag"
                className={cn(DASH_PILL_CLASS, "whitespace-nowrap", r.qty === 0 ? STATUS_CLASSES.warn.pill : "bg-surface-3 text-muted-foreground")}
              >
                {r.qty === 0 ? "Not sold" : `${r.qty} sold`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DashCard>
  );
}

/**
 * Sales by category (values 3.13, ruling R20): a 26px bar of one segment per category in the HTML's section hues by
 * rank (our sixth row, "Other categories", in text-3), then a row per category: its dot, the name, the amount, the share.
 */
export function CategoriesCard(p: RangeCardProps) {
  const rows = p.data?.categories ?? [];
  const hueOf = new Map(rows.map((r, i) => [r.key, categoryHue(i)]));
  return (
    <DashCard
      variant="dashboard"
      ui="cat-card"
      className={HTML_NUMERALS}
      title="Sales by category"
      period={`${p.period} · share of item sales`}
      status={statusOf(p, rows.length === 0)}
      updating={p.updating}
      onRetry={p.onRetry}
      empty={{ title: "No item sales yet", description: "Each menu category's share of sales shows here." }}
      bodyMinHeight={CATEGORY_BAR_PX + CATEGORY_ROWS * CATEGORY_ROW_PX}
    >
      <div data-ui="cat-bar" aria-hidden className="flex h-[26px] gap-0.5 overflow-hidden rounded-[7px]">
        {mixSegments(rows).map((s) => (
          <span key={s.key} data-ui="cat-seg" title={rows.find((r) => r.key === s.key)?.label} style={{ width: `${s.pct}%`, background: hueOf.get(s.key) }} />
        ))}
      </div>
      <ul data-ui="cat-list" className="mt-2.5 flex flex-col">
        {rows.map((r) => (
          <li key={r.key} data-ui="cat-row" className="flex items-center gap-2.5 border-t border-border-2 py-2 text-[13.5px]">
            <span data-ui="cat-dot" aria-hidden className="size-[9px] shrink-0 rounded-[50%]" style={{ background: hueOf.get(r.key) }} />
            <span className="flex-1">{r.label}</span>
            <span data-ui="cat-amount" className="font-mono font-semibold">
              {inr(r.amount)}
            </span>
            <span data-ui="cat-pct" className="w-9 text-right text-[12px] text-subtle-foreground">
              {sharePercent(r.share)}
            </span>
          </li>
        ))}
      </ul>
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
