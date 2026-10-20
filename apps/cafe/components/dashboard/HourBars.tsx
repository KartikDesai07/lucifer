"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cn, inr } from "@/lib/utils";
import { barGapPx, tipShift, xLabelStep, type BarTone, type ChartModel } from "@/lib/dashboard/hour-bars";

// The owner's HTML bar chart (values 3.5, U0 match Task 7), drawn in CSS: no chart.js on the dashboard. A 210px plot
// with a --border-2 line every 70px, Geist Mono ticks at its left, one column per hour (per day for a span) holding a
// bar of at most 34px, the dashed comparison line over them, the x labels, then the footer. lib/dashboard/hour-bars
// computes every number. A column is a button: hovering it, focusing it or tapping it (the cafe's touch tablets) shows
// its tooltip and dims the other bars, as the HTML's hover does; the screen-reader table carries the whole series.
// Fix round 1: the columns are one tab stop (a roving tabindex: the arrow keys, Home and End move along them), Escape
// hides the tooltip (WCAG 1.4.13), and a tooltip that would leave the card is moved back inside it.

const TONE_CLASS: Record<BarTone, string> = {
  peak: "bg-primary",
  // color-mix(in oklab, var(--accent) 60%, var(--surface)), precomputed (WebView 109)
  bar: "bg-chart-bar",
  future: "bg-surface-3",
};
const VS_CLASS = { up: "text-status-ok-ink", down: "text-status-bad-ink", none: "text-foreground" } as const;
/** The other bars while one is hovered (the HTML's op .4). */
const DIMMED_OPACITY = 0.4;
/** The HTML's x labels: every 2nd hour, every 3rd on a phone (xs = cw < 560). */
const LABEL_STEP_WIDE = 2;
const LABEL_STEP_XS = 3;

/** The head's legend (values 3.5): the period's accent square and the comparison's dashed rule. */
export function HourBarsLegend({ current, compare }: { current: string; compare: string }) {
  return (
    <div data-ui="sales-legend" aria-hidden className="flex items-center gap-3.5 text-[12px] text-muted-foreground">
      <span data-ui="sales-legend-item" className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-primary" />
        <span>{current}</span>
      </span>
      <span data-ui="sales-legend-item" className="flex items-center gap-1.5">
        <span className="w-3.5 border-t-2 border-dashed border-subtle-foreground" />
        <span>{compare}</span>
      </span>
    </div>
  );
}

/** One x label: written at every `wide`-th column from cw 560, at every `xs`-th below it, else an empty cell. */
function xLabel(text: string, wide: boolean, xs: boolean): ReactNode {
  if (wide && xs) return <span>{text}</span>;
  if (wide) return <span className="hidden @min-[560px]:inline">{text}</span>;
  if (xs) return <span className="@min-[560px]:hidden">{text}</span>;
  return null;
}

interface HourBarsProps {
  model: ChartModel;
  /** The chart's one-line summary: the bars' group name and the screen-reader table's caption. */
  ariaLabel: string;
  currentName: string;
  compareName: string;
  /** The period on show ("{from}:{to}"): picking another clears the hovered bar, as the HTML's pick sets dbHov -1. */
  period: string;
}

export function HourBars({ model, ariaLabel, currentName, compareName, period }: HourBarsProps) {
  // Which column is hovered, focused or tapped (-1 = none), for the period it was set on. The columns are kept across
  // a new period of the same kind (bars then move to their new heights, the HTML's height transition).
  const [hovered, setHovered] = useState({ period, at: -1 });
  const hover = hovered.period === period ? hovered.at : -1;
  const setHover = (at: number) => setHovered({ period, at });
  // The one column in the tab order: the last one focused (the first to begin with).
  const [roving, setRoving] = useState(0);
  const colRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tipRef = useRef<HTMLSpanElement>(null);

  // Escape hides the tooltip, whether the pointer or the focus opened it.
  useEffect(() => {
    if (hover < 0) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setHovered({ period, at: -1 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hover, period]);

  // The tooltip is laid out centred on its column (the HTML's), then moved back inside the card if it overflows it (the
  // last column on a phone), so the page never grows wider than the screen.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const card = tip?.closest("section");
    if (!tip || !card) return;
    tip.style.setProperty("--tip-dx", "0px");
    const t = tip.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    tip.style.setProperty("--tip-dx", `${tipShift(t.left, t.right, c.left, c.right)}px`);
  }, [hover, period]);
  // The label row's width, so a month of days writes only as many dates as fit (hours always fit the HTML's rule).
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowPx, setRowPx] = useState(0);
  useEffect(() => {
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setRowPx(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = model.bars.length;
  const gapXs = barGapPx(n, true);
  const gapWide = barGapPx(n, false);
  // db.L.barGap on the dashboard's container width: the xs gap below cw 560, the wide one from it.
  const gaps = { "--bar-gap-xs": `${gapXs}px`, "--bar-gap": `${gapWide}px` } as CSSProperties;
  const chars = Math.max(0, ...model.bars.map((b) => b.tick.length));
  const stepWide = xLabelStep(n, rowPx, gapWide, chars, LABEL_STEP_WIDE);
  const stepXs = xLabelStep(n, rowPx, gapXs, chars, LABEL_STEP_XS);
  const tabAt = Math.min(roving, n - 1);
  const onColumnKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to = e.key === "ArrowRight" ? Math.min(n - 1, i + 1) : e.key === "ArrowLeft" ? Math.max(0, i - 1) : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to === null) return;
    e.preventDefault();
    colRefs.current[to]?.focus();
  };

  return (
    <div data-ui="sales-chart">
      <div data-ui="sales-plot-row" className="flex gap-2.5">
        <div
          data-ui="sales-ticks"
          aria-hidden
          className="-mt-1.5 flex h-[210px] flex-col justify-between text-right font-mono text-[11px] text-subtle-foreground"
        >
          {model.ticks.map((t, i) => (
            <span key={i} data-ui="sales-tick">
              {t}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div
            data-ui="sales-plot"
            className="relative h-[210px] border-b border-border bg-[repeating-linear-gradient(180deg,var(--border-2)_0_1px,transparent_1px_70px)]"
          >
            <div
              data-ui="sales-bars"
              role="group"
              aria-label={ariaLabel}
              className="absolute inset-0 flex items-end gap-(--bar-gap-xs) @min-[560px]:gap-(--bar-gap)"
              style={gaps}
              onMouseLeave={() => setHover(-1)}
            >
              {model.bars.map((b, i) => (
                <button
                  key={b.key}
                  type="button"
                  ref={(el) => {
                    colRefs.current[i] = el;
                  }}
                  data-ui="sales-col"
                  aria-label={b.aria}
                  tabIndex={i === tabAt ? 0 : -1}
                  className="relative flex h-full flex-1 items-end justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => {
                    setHover(i);
                    setRoving(i);
                  }}
                  onKeyDown={(e) => onColumnKey(e, i)}
                  onClick={() => setHover(i)}
                  onBlur={() => setHovered((h) => (h.period === period && h.at === i ? { period, at: -1 } : h))}
                >
                  <span
                    data-ui="sales-bar"
                    aria-hidden
                    className={cn(
                      "w-full max-w-[34px] min-h-[2px] rounded-[5px_5px_2px_2px] origin-bottom motion-safe:animate-grow-y [transition:height_0.5s_cubic-bezier(0.2,0.8,0.2,1),opacity_0.15s] motion-reduce:transition-none",
                      TONE_CLASS[b.tone],
                    )}
                    style={{ height: `${b.height}%`, opacity: hover === -1 || hover === i ? 1 : DIMMED_OPACITY }}
                  />
                  {hover === i && (
                    <span
                      ref={tipRef}
                      data-ui="sales-tip"
                      aria-hidden
                      className="pointer-events-none absolute left-1/2 z-[2] whitespace-nowrap rounded-[8px] bg-ink px-2.5 py-[7px] text-start text-[12px] leading-[1.45] text-on-ink"
                      style={{ bottom: `calc(${b.height}% + 8px)`, transform: "translateX(calc(-50% + var(--tip-dx, 0px)))" }}
                    >
                      <span data-ui="sales-tip-head" className="block font-semibold">
                        {b.tip[0]}
                      </span>
                      <span data-ui="sales-tip-cmp" className="block opacity-70">
                        {b.tip[1]}
                      </span>
                    </span>
                  )}
                </button>
              ))}
            </div>
            <svg
              data-ui="sales-line"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            >
              <polyline
                points={model.line}
                fill="none"
                stroke="var(--subtle-foreground)"
                strokeWidth={1.6}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div
            ref={rowRef}
            data-ui="sales-xlabels"
            aria-hidden
            className="mt-2 flex gap-(--bar-gap-xs) @min-[560px]:gap-(--bar-gap)"
            style={gaps}
          >
            {model.bars.map((b, i) => (
              <span key={b.key} data-ui="sales-xlabel" className="flex-1 text-center text-[11px] text-subtle-foreground whitespace-nowrap">
                {xLabel(b.tick, i % stepWide === 0, i % stepXs === 0)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div
        data-ui="sales-footer"
        className="mt-3.5 flex flex-wrap gap-x-6 gap-y-2 border-t border-border-2 pt-3 text-[12.5px] text-muted-foreground"
      >
        <span>
          Peak <b className="font-semibold text-foreground">{model.peak}</b>
        </span>
        <span>
          Quietest <b className="font-semibold text-foreground">{model.low}</b>
        </span>
        <span>
          {model.vsLabel} <b className={cn("font-semibold", VS_CLASS[model.vsTone])}>{model.vs}</b>
        </span>
      </div>
      {/* The screen-reader copy of the chart. A <table> cannot be narrower than its cells, so sr-only on the table
          itself would still widen the page on a phone; the clipping div around it holds it to 1 px. */}
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
            {model.bars.map((b) => (
              <tr key={b.key}>
                <th scope="row">{b.label}</th>
                <td>{b.future ? "not yet" : inr(b.value)}</td>
                <td>{inr(b.compare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
