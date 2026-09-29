"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartDataset,
  type ChartOptions,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { inr } from "@/lib/utils";
import { inrCompact } from "@/lib/dashboard/format";
import { REPORT_CHART_LABEL_MAX_CHARS, type ReportChartBar, type ReportChartLine } from "@/components/reports/chart-size";

// The Reports screens' own chart (Batch 1 — Sales/Payments day-by-day; Batch 2
// adds a horizontal "Top 10 items" mode + a plain-count format). Same
// Chart.js kit as the Dashboard's SalesChart (only that file and this one may
// import chart.js — lib/dashboard-paths.test.ts's allow-list), loaded through
// next/dynamic(ssr:false) by every page that uses it. Unlike SalesChart this
// one can draw MORE THAN ONE bar series stacked (Payments' cash+online tally)
// and reports a click as a day/category index, so the page can open that
// day's DaySheet or that item's ItemSheet — "a tap anywhere in a bar's row
// selects it" (bars are too thin to hit precisely on a phone), matched with
// { intersect: false }.

ChartJS.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip);

const BAR_MAX_PX = 28;
const BAR_RADIUS_PX = 4;
const LINE_PX = 2;
const TICK_FONT_PX = 11.5;
const Y_TICKS_MAX = 5;
const ANIMATION_MS = 450;
const COUNT_TICK_PRECISION = 0;

/** Truncate by CODE POINTS (never UTF-16 units — breaks emoji/Devanagari mid-glyph). */
function truncateLabel(label: string, max: number): string {
  const chars = Array.from(label);
  return chars.length <= max ? label : `${chars.slice(0, max).join("")}…`;
}

interface Theme {
  primary: string;
  ink: string;
  compare: string;
  primaryHover: string;
  rule: string;
  grid: string;
  muted: string;
  slip: string;
  font: string;
}

function readTheme(el: HTMLElement): Theme {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string) => root.getPropertyValue(name).trim();
  return {
    primary: v("--brand-primary"),
    ink: v("--brand-ink"),
    compare: v("--brand-field"),
    primaryHover: v("--brand-primary-hover"),
    rule: v("--brand-rule"),
    grid: v("--brand-wash"),
    muted: v("--brand-muted"),
    slip: v("--brand-slip"),
    font: getComputedStyle(el).fontFamily,
  };
}

const toneColor = (theme: Theme, tone: "primary" | "ink") => (tone === "primary" ? theme.primary : theme.ink);

export interface ReportChartProps {
  labels: string[];
  bars: ReportChartBar[];
  /** Optional compare line, drawn like the Dashboard's (--brand-field). */
  line?: ReportChartLine;
  /** The index drawn in --brand-primary-hover (only meaningful for a single, unstacked bar series). */
  selected: number | null;
  onSelect: (index: number) => void;
  ariaLabel: string;
  /** Bars run along the category (y) axis — "Top 10 items" (Batch 2). Default false (vertical, day/hour charts). */
  horizontal?: boolean;
  /** Tooltip/ticks/sr-table number style: whole rupees (default) or a plain count. */
  format?: "money" | "count";
}

export function ReportChart({ labels, bars, line, selected, onSelect, ariaLabel, horizontal = false, format = "money" }: ReportChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartJS<"bar" | "line"> | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const stacked = bars.length > 1;
  const fmt = (n: number) => (format === "count" ? String(Math.round(n)) : inr(n));

  useLayoutEffect(() => {
    if (wrapRef.current) setTheme(readTheme(wrapRef.current));
  }, []);

  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) chartRef.current?.update("none");
    });
    return () => {
      alive = false;
    };
  }, [theme]);

  const data = useMemo<ChartData<"bar" | "line">>(() => {
    const barDatasets: ChartDataset<"bar" | "line">[] = bars.map((b, i) => {
      const color = theme ? toneColor(theme, b.tone) : undefined;
      return {
        type: "bar" as const,
        label: b.name,
        data: b.values,
        backgroundColor: !stacked && theme
          ? b.values.map((_, idx) => (idx === selected ? theme.primaryHover : color))
          : color,
        hoverBackgroundColor: theme?.primaryHover,
        // Rounded on the VALUE end: the top for a vertical bar, the right end
        // (Chart.js "end") for a horizontal one — "start" is skipped either way.
        borderRadius: horizontal
          ? { topRight: BAR_RADIUS_PX, bottomRight: BAR_RADIUS_PX }
          : { topLeft: BAR_RADIUS_PX, topRight: BAR_RADIUS_PX },
        borderSkipped: horizontal ? "start" : "bottom",
        maxBarThickness: BAR_MAX_PX,
        stack: stacked ? "report" : undefined,
        // A 1px slip-coloured separator between stacked segments — every bar
        // but the bottom-most one gets a slip border on the shared edge.
        borderColor: stacked && i > 0 ? theme?.slip : undefined,
        borderWidth: stacked && i > 0 ? { top: 1 } : undefined,
        order: 1,
      };
    });
    const lineDataset: ChartDataset<"bar" | "line">[] = line
      ? [
          {
            type: "line" as const,
            label: line.name,
            data: line.values,
            borderColor: theme?.compare,
            backgroundColor: theme?.compare,
            borderWidth: LINE_PX,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0,
            order: 0,
          },
        ]
      : [];
    return { labels, datasets: [...lineDataset, ...barDatasets] };
  }, [labels, bars, line, selected, stacked, theme, horizontal]);

  const options = useMemo<ChartOptions<"bar" | "line">>(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tickFont = { family: theme?.font, size: TICK_FONT_PX };
    // The category axis is x normally, y when horizontal — interaction/onClick
    // must probe along THAT axis, or a click on a thin bar misses every point.
    const categoryAxis = horizontal ? "y" : "x";
    const valueTickCallback = (v: number | string) =>
      format === "count" ? String(Math.round(Number(v))) : inrCompact(Number(v));
    // The scale's own label for the tick (never a closure over `labels`, which
    // would rebuild the options — and restart every animation — on each render).
    const categoryTickCallback = function (this: { getLabelForValue: (v: number) => string }, value: number | string) {
      return truncateLabel(this.getLabelForValue(Number(value)), REPORT_CHART_LABEL_MAX_CHARS);
    };
    return {
      indexAxis: horizontal ? "y" : "x",
      responsive: true,
      maintainAspectRatio: false,
      animation: reduced ? false : { duration: ANIMATION_MS },
      // Bars snap along the CATEGORY axis (x, or y when horizontal) so a resize or
      // data update never leaves a bar drifting away from its own label.
      animations: { [categoryAxis]: { duration: 0 } },
      interaction: { mode: "index", intersect: false, axis: categoryAxis },
      layout: { padding: { top: 4 } },
      onHover: (evt, elements) => {
        const target = evt.native?.target;
        if (target instanceof HTMLElement) target.style.cursor = elements.length > 0 ? "pointer" : "default";
      },
      onClick: (evt, _elements, chart) => {
        if (!evt.native) return;
        const points = chart.getElementsAtEventForMode(evt.native, "index", { intersect: false, axis: categoryAxis }, false);
        const index = points[0]?.index;
        if (index !== undefined) onSelect(index);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: theme?.slip,
          titleColor: theme?.ink,
          bodyColor: theme?.ink,
          borderColor: theme?.rule,
          borderWidth: 1,
          padding: 10,
          titleFont: tickFont,
          bodyFont: tickFont,
          // Full, untruncated label as the tooltip title — the axis tick is the
          // one that gets shortened, never the tooltip's own identification.
          callbacks: {
            title: (items) => items[0]?.label ?? "",
            label: (ctx) =>
              format === "count" ? `${ctx.dataset.label}: ${Math.round(Number(ctx.raw))}` : `${ctx.dataset.label}: ${inr(Number(ctx.raw))}`,
          },
        },
      },
      scales: horizontal
        ? {
            x: {
              stacked,
              beginAtZero: true,
              border: { display: false },
              grid: { color: theme?.grid },
              ticks: { color: theme?.muted, font: tickFont, maxTicksLimit: Y_TICKS_MAX, precision: format === "count" ? COUNT_TICK_PRECISION : undefined, callback: valueTickCallback },
            },
            y: {
              stacked,
              grid: { display: false },
              border: { color: theme?.rule },
              ticks: { color: theme?.muted, font: tickFont, autoSkip: false, callback: categoryTickCallback },
            },
          }
        : {
            x: {
              stacked,
              grid: { display: false },
              border: { color: theme?.rule },
              ticks: { color: theme?.muted, font: tickFont, maxRotation: 0, autoSkip: true, autoSkipPadding: 10 },
            },
            y: {
              stacked,
              beginAtZero: true,
              border: { display: false },
              grid: { color: theme?.grid },
              ticks: { color: theme?.muted, font: tickFont, maxTicksLimit: Y_TICKS_MAX, precision: format === "count" ? COUNT_TICK_PRECISION : undefined, callback: valueTickCallback },
            },
          },
    };
  }, [theme, stacked, onSelect, horizontal, format]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-brand-muted" aria-hidden>
        {bars.map((b) => (
          <span key={b.name} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-[3px] ${b.tone === "primary" ? "bg-brand-primary" : "bg-brand-ink"}`} />
            {b.name}
          </span>
        ))}
        {line && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 rounded-full bg-brand-field" />
            {line.name}
          </span>
        )}
      </div>
      {/* 200px on a phone, 240px on md+ — matches REPORT_CHART_HEIGHT_PX / chart-size.ts,
          which a page reserves for its skeleton without statically importing this file. */}
      <div ref={wrapRef} className="relative h-[200px] sm:h-[240px]">
        {theme && <Chart ref={chartRef} type="bar" data={data} options={options} role="img" aria-label={ariaLabel} />}
      </div>
      {/* The screen-reader copy of the chart, clipped to 1px (a <table> cannot
          be narrower than its cells, so sr-only on the table alone would still
          widen the page — same fix as SalesChart's). */}
      <div className="sr-only">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              {bars.map((b) => (
                <th key={b.name} scope="col">
                  {b.name}
                </th>
              ))}
              {line && <th scope="col">{line.name}</th>}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, i) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {bars.map((b) => (
                  <td key={b.name}>{fmt(b.values[i] ?? 0)}</td>
                ))}
                {line && <td>{fmt(line.values[i] ?? 0)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
