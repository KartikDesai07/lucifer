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
  type ChartOptions,
  type TooltipModel,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { inr } from "@/lib/utils";
import { inrCompact } from "@/lib/dashboard/format";
import { SALES_CHART_HEIGHT_PX } from "@/components/dashboard/chart-size";
import type { DashboardSeriesPoint } from "@/types/dashboard";

// The Dashboard's main chart (Chart.js — owner's pick 2026-09-29): the chosen
// period as blue bars, the comparison period as a grey line, one y-axis.
// Loaded through next/dynamic (ssr:false) so Chart.js stays out of the first
// bundle. Colours and the font are READ from the brand tokens at mount, never
// copied into code. The tooltip is our own HTML (sentence-case, ₹ grouping) and
// is anchored so it can never leave the card; a tap on a phone opens it and it
// stays (Chart.js listens to touchstart/touchmove by default).

ChartJS.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
);

const BAR_MAX_PX = 24;
const BAR_RADIUS_PX = 4;
const LINE_PX = 2;
const TICK_FONT_PX = 11.5;
const Y_TICKS_MAX = 5;
const ANIMATION_MS = 450;
const TIP_GAP_PX = 12;
const TIP_FLIP_BELOW_PX = 72; // a caret this close to the top opens the tooltip below it

interface Theme {
  accent: string;
  accentHover: string;
  compare: string;
  rule: string;
  grid: string;
  muted: string;
  font: string;
}

/** `a` moved `t` of the way toward `b` (#rrggbb) — the hovered bar is the accent a step toward ink. */
function mixHex(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a;
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
const HOVER_TOWARD_INK = 0.2;

function readTheme(el: HTMLElement): Theme {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string) => root.getPropertyValue(name).trim();
  return {
    accent: v("--brand-accent"),
    accentHover: mixHex(v("--brand-accent"), v("--brand-ink"), HOVER_TOWARD_INK),
    compare: v("--brand-field"),
    rule: v("--brand-rule"),
    grid: v("--brand-wash"),
    muted: v("--brand-muted"),
    font: getComputedStyle(el).fontFamily,
  };
}

interface TipState {
  index: number;
  x: number;
  y: number;
  width: number;
}

interface SalesChartProps {
  series: DashboardSeriesPoint[];
  currentName: string; // "Today" · "Selected days"
  compareName: string; // "Tue, 22 Sep" · "Previous 7 days"
  ariaLabel: string;
}

export function SalesChart({ series, currentName, compareName, ariaLabel }: SalesChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartJS<"bar" | "line"> | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);

  useLayoutEffect(() => {
    if (wrapRef.current) setTheme(readTheme(wrapRef.current));
  }, []);

  // Canvas text is drawn once: redraw when the brand font finishes loading.
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) chartRef.current?.update("none");
    });
    return () => {
      alive = false;
    };
  }, [theme]);

  // A new period is a new chart — never leave the old tooltip floating.
  useEffect(() => setTip(null), [series]);

  const data = useMemo<ChartData<"bar" | "line">>(
    () => ({
      labels: series.map((p) => p.label),
      datasets: [
        {
          type: "line" as const,
          label: compareName,
          data: series.map((p) => p.compareSales),
          borderColor: theme?.compare,
          backgroundColor: theme?.compare,
          borderWidth: LINE_PX,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0,
          order: 0,
        },
        {
          type: "bar" as const,
          label: currentName,
          data: series.map((p) => p.sales),
          backgroundColor: theme?.accent,
          hoverBackgroundColor: theme?.accentHover,
          borderRadius: { topLeft: BAR_RADIUS_PX, topRight: BAR_RADIUS_PX },
          borderSkipped: "bottom",
          maxBarThickness: BAR_MAX_PX,
          order: 1,
        },
      ],
    }),
    [series, currentName, compareName, theme],
  );

  const options = useMemo<ChartOptions<"bar" | "line">>(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tickFont = { family: theme?.font, size: TICK_FONT_PX };
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduced ? false : { duration: ANIMATION_MS },
      // Grow bars (and the line) upward only — Chart.js otherwise also animates the
      // line's points in from the left edge, a sweep that reads as a glitch.
      animations: { x: { duration: 0 } },
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: ({ chart, tooltip }: { chart: ChartJS; tooltip: TooltipModel<"bar" | "line"> }) => {
            if (tooltip.opacity === 0 || !tooltip.dataPoints?.length) return setTip(null);
            setTip({
              index: tooltip.dataPoints[0].dataIndex,
              x: tooltip.caretX,
              y: tooltip.caretY,
              width: chart.width,
            });
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: theme?.rule },
          ticks: {
            color: theme?.muted,
            font: tickFont,
            maxRotation: 0,
            autoSkip: true,
            autoSkipPadding: 10,
          },
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: theme?.grid },
          ticks: {
            color: theme?.muted,
            font: tickFont,
            maxTicksLimit: Y_TICKS_MAX,
            callback: (v) => inrCompact(Number(v)),
          },
        },
      },
    };
  }, [theme]);

  const point = tip ? series[tip.index] : undefined;
  const frac = tip && tip.width > 0 ? Math.min(1, Math.max(0, tip.x / tip.width)) : 0;
  const below = tip ? tip.y < TIP_FLIP_BELOW_PX : false;
  const change = point && point.compareSales > 0 ? (point.sales - point.compareSales) / point.compareSales : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-brand-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-brand-accent" />
          {currentName}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 rounded-full bg-brand-field" />
          {compareName}
        </span>
      </div>
      <div ref={wrapRef} className="relative" style={{ height: SALES_CHART_HEIGHT_PX }}>
        {theme && <Chart ref={chartRef} type="bar" data={data} options={options} role="img" aria-label={ariaLabel} />}
        {point && tip && (
          <div
            className="pointer-events-none absolute z-10 min-w-[168px] rounded-lg border border-brand-rule bg-brand-slip px-3 py-2 text-[12.5px] leading-5 text-brand-ink shadow-[0_4px_16px_rgba(29,27,24,0.08)]"
            style={{
              left: tip.x,
              top: tip.y,
              transform: `translate(${-frac * 100}%, ${below ? `${TIP_GAP_PX}px` : `calc(-100% - ${TIP_GAP_PX}px)`})`,
            }}
          >
            <p className="mb-0.5 font-semibold">{point.label}</p>
            <p className="flex justify-between gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-[2px] bg-brand-accent" />
                {currentName}
              </span>
              <span className="font-semibold">{inr(point.sales)}</span>
            </p>
            <p className="flex justify-between gap-4 text-brand-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-2.5 rounded-full bg-brand-field" />
                {point.compareLabel === point.label ? compareName : point.compareLabel}
              </span>
              <span>{inr(point.compareSales)}</span>
            </p>
            {change !== null && (
              <p className={change >= 0 ? "text-brand-up" : "text-brand-danger"}>
                {change >= 0 ? "▲" : "▼"} {Math.abs(Math.round(change * 100))}%
              </p>
            )}
          </div>
        )}
      </div>
      {/* The screen-reader copy of the chart. A <table> cannot be narrower than its
          cells, so sr-only on the table itself would still widen the page (measured:
          390 px phone → 489 px); the clipping div around it holds it to 1 px. */}
      <div className="sr-only">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">{currentName}</th>
              <th scope="col">{compareName}</th>
            </tr>
          </thead>
          <tbody>
            {series.map((p) => (
              <tr key={p.key}>
                <th scope="row">{p.label}</th>
                <td>{inr(p.sales)}</td>
                <td>{inr(p.compareSales)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
