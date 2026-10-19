"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { WEEKDAYS_MONDAY_FIRST, hourLabel, mondayIndex } from "@/lib/dashboard/range";
import {
  busiestCell,
  busiestWords,
  heatCap,
  heatCellLabel,
  heatHourTick,
  heatLevel,
  type HeatCell,
} from "@/lib/dashboard/busy-hours";
import type { DashboardHeat } from "@/types/dashboard";

// Busy hours — orders per hour on an average day of each weekday, as a grid
// (a table of numbers, so a plain CSS grid, not a chart library). One hue,
// light → dark (sequential), with a legend; tapping, hovering or focusing a
// cell reads it out in words, so a phone needs no tooltip.
//
// Two looks share the pick: the Dashboard's is the owner's HTML (values 3.15, U0 match Task 9, ruling R19: weekdays
// down and hours across at every width, a 560px minimum that scrolls sideways inside the card, the read-out in the
// head's cap box); the reports' BusyHours keeps its own look (a transposed grid on a phone) until its own session.

/**
 * The picked cell, kept by its HOUR, not its column: it survives a heat change (Reports' type filter, a range switch)
 * and each heat has its own span of hours, so a column index would read past a shorter grid or silently re-point at
 * another hour. The same weekday + hour stays picked, or the pick drops when that hour is gone.
 */
export function useHeatPick(heat: DashboardHeat | undefined): {
  cell: HeatCell | null;
  pick: (weekday: number, hourIndex: number) => void;
  clear: () => void;
} {
  const [picked, setPicked] = useState<{ weekday: number; hour: number } | null>(null);
  const index = picked && heat ? heat.hours.indexOf(picked.hour) : -1;
  return {
    cell: picked && index >= 0 ? { weekday: picked.weekday, hourIndex: index } : null,
    pick: (weekday, hourIndex) => {
      if (heat) setPicked({ weekday, hour: heat.hours[hourIndex] });
    },
    clear: () => setPicked(null),
  };
}

// ── the Dashboard's (values 3.15) ───────────────────────────────────────────────────────────────────────────────────

/** The HTML's six steps (LV): surface-2, the accent at 16 / 30 / 48 / 70 % over the card (precomputed), the accent. */
const LEVEL_CLASS = ["bg-surface-2", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-primary"] as const;
/** The hovered cell's ring (values 3.15): 0 0 0 2px var(--text), as a plain box-shadow. */
const RING_CLASS = "[box-shadow:0_0_0_2px_var(--foreground)]";
/** A keyboard-focused cell keeps the same ring even after the pointer leaves the grid (which clears the pick). */
const FOCUS_RING_CLASS = "focus-visible:outline-none focus-visible:[box-shadow:0_0_0_2px_var(--foreground)]";

/** The head's cap box (values 3.15): the read-out of the picked cell, the HTML's hint until one is. */
export function BusyHoursCap({ heat, cell, updating }: { heat?: DashboardHeat; cell: HeatCell | null; updating?: boolean }) {
  const cap = heatCap(heat, cell);
  return (
    <div
      data-ui="heat-cap"
      aria-live="polite"
      className={cn(
        "flex h-[34px] items-center gap-2 whitespace-nowrap rounded-[9px] border border-border-2 bg-surface-2 px-3 text-[13px] transition-opacity duration-200",
        updating && "opacity-55",
      )}
    >
      <span className="text-subtle-foreground">{cap.label}</span>
      <b className="font-semibold">{cap.value}</b>
    </div>
  );
}

/** The grid (weekdays down, our hours across) and its footer: the busiest hour and the Fewer … More legend. */
export function BusyHoursGrid({
  heat,
  today,
  cell,
  onPick,
  onClear,
}: {
  heat: DashboardHeat;
  /** The cafe's today, whose weekday's label is bold. */
  today: string;
  cell: HeatCell | null;
  onPick: (weekday: number, hourIndex: number) => void;
  onClear: () => void;
}) {
  const todayIndex = mondayIndex(today);
  const busiest = busiestWords(heat);
  return (
    <>
      <div data-ui="heat-scroll" className="overflow-x-auto [&::-webkit-scrollbar]:h-0">
        <div
          data-ui="heat-grid"
          onMouseLeave={onClear}
          className="grid min-w-[560px] gap-1"
          style={{ gridTemplateColumns: `40px repeat(${heat.hours.length}, minmax(0, 1fr))` }}
        >
          <span />
          {heat.hours.map((h, i) => (
            <span key={h} data-ui="heat-hour" className="whitespace-nowrap text-center text-[11px] text-subtle-foreground">
              {heatHourTick(h, i)}
            </span>
          ))}
          {WEEKDAYS_MONDAY_FIRST.map((day, weekday) => (
            <div key={day} className="contents">
              <span
                data-ui="heat-day"
                className={cn("flex items-center text-[12px]", weekday === todayIndex ? "font-semibold text-foreground" : "text-muted-foreground")}
              >
                {day}
              </span>
              {heat.hours.map((_, hourIndex) => {
                const picked = cell?.weekday === weekday && cell.hourIndex === hourIndex;
                return (
                  <button
                    key={`${weekday}-${hourIndex}`}
                    type="button"
                    data-ui="heat-cell"
                    aria-label={heatCellLabel(heat, { weekday, hourIndex })}
                    onClick={() => onPick(weekday, hourIndex)}
                    onMouseEnter={() => onPick(weekday, hourIndex)}
                    onFocus={() => onPick(weekday, hourIndex)}
                    className={cn(
                      "h-[30px] rounded-[6px] transition-[box-shadow] duration-[120ms] ease-[ease]",
                      FOCUS_RING_CLASS,
                      LEVEL_CLASS[heatLevel(heat.avg[weekday]?.[hourIndex] ?? 0, heat.max)],
                      picked && RING_CLASS,
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div data-ui="heat-foot" className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5 text-[12.5px] text-muted-foreground">
        {busiest ? (
          <span data-ui="heat-busiest">
            Busiest: <b className="font-semibold text-foreground">{busiest.when}</b> · {busiest.orders} on average
          </span>
        ) : (
          <span />
        )}
        <span data-ui="heat-legend" aria-hidden className="flex items-center gap-1">
          Fewer
          {LEVEL_CLASS.map((c) => (
            <span key={c} data-ui="heat-swatch" className={cn("size-3.5 rounded-[3px]", c)} />
          ))}
          More
        </span>
      </div>
    </>
  );
}

// ── the reports' (their own look until their session) ───────────────────────────────────────────────────────────────

// Sequential steps of the accent over the card (Tailwind opacity = color-mix).
const STEPS = [
  "bg-brand-paper",
  "bg-brand-accent/15",
  "bg-brand-accent/30",
  "bg-brand-accent/50",
  "bg-brand-accent/75",
  "bg-brand-accent",
] as const;
const HOUR_LABEL_EVERY = 3;

export function BusyHours({ heat }: { heat: DashboardHeat }) {
  const busiest = busiestCell(heat);
  const { cell: pickedCell, pick, clear } = useHeatPick(heat);
  const shown = pickedCell ?? busiest;

  const cell = (weekday: number, hourIndex: number, className: string) => {
    const v = heat.avg[weekday][hourIndex];
    const active = shown?.weekday === weekday && shown.hourIndex === hourIndex && pickedCell !== null;
    return (
      <button
        key={`${weekday}-${hourIndex}`}
        type="button"
        aria-label={heatCellLabel(heat, { weekday, hourIndex })}
        onClick={() => pick(weekday, hourIndex)}
        onMouseEnter={() => pick(weekday, hourIndex)}
        onFocus={() => pick(weekday, hourIndex)}
        className={cn(
          "rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
          STEPS[heatLevel(v, heat.max)],
          active && "ring-2 ring-brand-ink",
          className,
        )}
      />
    );
  };

  const cols = heat.hours.length;
  return (
    <div onMouseLeave={clear}>
      {/* Tablet and up: weekdays down, hours across. */}
      <div
        className="hidden gap-[3px] sm:grid"
        style={{ gridTemplateColumns: `2.25rem repeat(${cols}, minmax(0, 1fr))` }}
      >
        <span />
        {heat.hours.map((h, i) => (
          <span key={h} className="truncate text-[11px] leading-4 text-brand-muted">
            {i % HOUR_LABEL_EVERY === 0 ? hourLabel(h).replace(" ", "") : ""}
          </span>
        ))}
        {WEEKDAYS_MONDAY_FIRST.map((day, weekday) => (
          <div key={day} className="contents">
            <span className="self-center text-[11.5px] text-brand-muted">{day}</span>
            {heat.hours.map((_, hourIndex) => cell(weekday, hourIndex, "h-7"))}
          </div>
        ))}
      </div>
      {/* Phone: hours down, weekdays across. */}
      <div className="grid gap-[3px] sm:hidden" style={{ gridTemplateColumns: "3rem repeat(7, minmax(0, 1fr))" }}>
        <span />
        {WEEKDAYS_MONDAY_FIRST.map((day) => (
          <span key={day} className="text-center text-[11px] leading-4 text-brand-muted">
            {day}
          </span>
        ))}
        {heat.hours.map((h, hourIndex) => (
          <div key={h} className="contents">
            <span className="self-center text-[11px] text-brand-muted">{hourLabel(h)}</span>
            {WEEKDAYS_MONDAY_FIRST.map((_, weekday) => cell(weekday, hourIndex, "h-6"))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-h-5 text-[13px] leading-5 text-brand-ink" aria-live="polite">
          {shown ? (
            <>
              {pickedCell ? "" : <span className="text-brand-muted">Busiest: </span>}
              {heatCellLabel(heat, shown).replace(": ", " · ")}
            </>
          ) : null}
        </p>
        <div className="flex items-center gap-1.5 text-[11.5px] text-brand-muted" aria-hidden>
          Fewer
          {STEPS.map((s) => (
            <span key={s} className={cn("h-3 w-3 rounded-[3px] border border-brand-rule/60", s)} />
          ))}
          More
        </div>
      </div>
    </div>
  );
}
