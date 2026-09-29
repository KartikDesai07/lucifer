"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { WEEKDAYS_MONDAY_FIRST, hourLabel } from "@/lib/dashboard/range";
import type { DashboardHeat } from "@/types/dashboard";

// Busy hours — orders per hour on an average day of each weekday, as a grid
// (a table of numbers, so a plain CSS grid, not a chart library). One hue,
// light → dark (sequential), with a legend; tapping or hovering a cell reads
// it out in words on a fixed line below, so a phone needs no tooltip. On a
// phone the grid turns sideways (hours down, weekdays across) so every cell
// stays a thumb-sized target instead of 16px slivers.

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
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

function stepOf(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(STEPS.length - 1, Math.ceil((value / max) * (STEPS.length - 1)));
}

const fmtOrders = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)} ${v === 1 ? "order" : "orders"}`;

interface Cell {
  weekday: number;
  hourIndex: number;
}

export function BusyHours({ heat }: { heat: DashboardHeat }) {
  const busiest = (() => {
    let best: Cell | null = null;
    heat.avg.forEach((row, weekday) =>
      row.forEach((v, hourIndex) => {
        if (!best || v > heat.avg[best.weekday][best.hourIndex]) best = { weekday, hourIndex };
      }),
    );
    return best as Cell | null;
  })();
  const [picked, setPicked] = useState<Cell | null>(null);
  const shown = picked ?? busiest;

  const cellLabel = (c: Cell) =>
    `${WEEKDAY_NAMES[c.weekday]}, ${hourLabel(heat.hours[c.hourIndex])} to ${hourLabel((heat.hours[c.hourIndex] + 1) % 24)}: ${fmtOrders(heat.avg[c.weekday][c.hourIndex])} on average`;

  const cell = (weekday: number, hourIndex: number, className: string) => {
    const v = heat.avg[weekday][hourIndex];
    const active = shown?.weekday === weekday && shown.hourIndex === hourIndex && picked !== null;
    return (
      <button
        key={`${weekday}-${hourIndex}`}
        type="button"
        aria-label={cellLabel({ weekday, hourIndex })}
        onClick={() => setPicked({ weekday, hourIndex })}
        onMouseEnter={() => setPicked({ weekday, hourIndex })}
        onFocus={() => setPicked({ weekday, hourIndex })}
        className={cn(
          "rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
          STEPS[stepOf(v, heat.max)],
          active && "ring-2 ring-brand-ink",
          className,
        )}
      />
    );
  };

  const cols = heat.hours.length;
  return (
    <div onMouseLeave={() => setPicked(null)}>
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
              {picked ? "" : <span className="text-brand-muted">Busiest: </span>}
              {cellLabel(shown).replace(": ", " · ")}
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
