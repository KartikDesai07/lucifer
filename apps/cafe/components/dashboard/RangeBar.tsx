"use client";

import { DatePicker } from "@/components/shared/DatePicker";
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { NavBookings } from "@/components/layout/nav-icons";
import { cn, cafeDateString } from "@/lib/utils";
import {
  MAX_DASHBOARD_RANGE_DAYS,
  addDays,
  presetRange,
  type DashboardPreset,
  type FixedDashboardPreset,
} from "@/lib/dashboard/range";
import type { DashboardRange } from "@/types/dashboard";

// The Dashboard's period picker. Admins: Today · Yesterday · 7 days · 30 days
// · Custom (from–to). Staff see one day at a time (a longer range is
// reporting data, admin-only on the server too): Today · Yesterday · Pick a day.

export interface DashboardSelection {
  preset: DashboardPreset;
  range: DashboardRange;
}

const ADMIN_PRESETS: ReadonlyArray<{ id: DashboardPreset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "custom", label: "Custom" },
];
const STAFF_PRESETS: ReadonlyArray<{ id: DashboardPreset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "custom", label: "Pick a day" },
];
/** How far back a custom range may start (the reports screen's own reach). */
const CUSTOM_LOOKBACK_DAYS = 365;

interface RangeBarProps {
  value: DashboardSelection;
  onChange: (next: DashboardSelection) => void;
  isAdmin: boolean;
  /** Widest custom range this screen's server route will accept (default: the Dashboard's own cap). */
  maxDays?: number;
  /** "report" (default): the reports and expenses look. "dashboard": the owner's HTML segmented control. */
  variant?: "report" | "dashboard";
}

interface RangeBarLook {
  wrap: string;
  track: string;
  button: string;
  focus: string;
  on: string;
  off: string;
  date: string;
}

const LOOKS: Record<NonNullable<RangeBarProps["variant"]>, RangeBarLook> = {
  report: {
    wrap: "flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end",
    // inline-size containment on a phone: the five buttons scroll inside the row
    // instead of setting the page's minimum width.
    track: "flex w-full max-w-full gap-0.5 overflow-x-auto rounded-[9px] bg-track p-[3px] [contain:inline-size] sm:w-auto sm:[contain:none]",
    button: "h-[30px] flex-1 whitespace-nowrap rounded-[7px] px-3 text-[13px] transition-colors pointer-coarse:h-11 sm:flex-none",
    focus: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
    on: "bg-card font-semibold text-brand-ink shadow-sm",
    off: "font-medium text-brand-muted hover:text-brand-ink",
    date: "h-9 border-brand-rule bg-brand-slip text-[13px] text-brand-ink pointer-coarse:h-11 sm:w-[150px]",
  },
  // U0 match Task 5 (values 3.2, 1.6): the track surface-3, radius 9, padding 3, gap 2, 36px tall; the buttons stretch
  // to it (30px), radius 7, padding 0 12px, 13px; chosen SEG_ON (seg, seg-sh) in text 600, the rest SEG_OFF in text-2
  // 500, pressing like the HTML's buttons. The same size on touch screens (ruling R1). Our Custom (admin) makes five:
  // under cw 560 it is a calendar glyph in 0 10px (ruling R10), so the track fits a 360px phone (332px of content);
  // should it ever not fit, it scrolls instead of widening the page.
  dashboard: {
    wrap: "flex max-w-full flex-wrap items-center gap-2",
    track: "flex h-9 max-w-full gap-0.5 overflow-x-auto rounded-[9px] bg-surface-3 p-[3px] [scrollbar-width:none]",
    button: "whitespace-nowrap rounded-[7px] px-3 text-[13px] " + HTML_PRESS_CLASS,
    // The HTML's exact shadow (Tailwind's shadow utilities add four empty ring layers), so the focus mark is an outline.
    focus: "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring",
    on: "bg-seg font-semibold text-foreground [box-shadow:var(--seg-sh)]",
    off: "bg-transparent font-medium text-muted-foreground",
    date: "h-9 w-[150px] rounded-[8px] border-border bg-card text-[13px] text-foreground",
  },
};

export function RangeBar({ value, onChange, isAdmin, maxDays = MAX_DASHBOARD_RANGE_DAYS, variant = "report" }: RangeBarProps) {
  const look = LOOKS[variant];
  const dashboard = variant === "dashboard";
  const today = cafeDateString();
  const presets = isAdmin ? ADMIN_PRESETS : STAFF_PRESETS;
  const earliest = addDays(today, -CUSTOM_LOOKBACK_DAYS);

  const pick = (id: DashboardPreset) => {
    if (id === "custom") onChange({ preset: "custom", range: value.range });
    else onChange({ preset: id, range: presetRange(id as FixedDashboardPreset) });
  };

  const setFrom = (from: string) => {
    if (!from) return;
    if (!isAdmin) return onChange({ preset: "custom", range: { from, to: from } });
    // Keep the end inside [from, from + cap − 1] and never after today.
    const capEnd = addDays(from, maxDays - 1);
    const to = value.range.to < from ? from : value.range.to > capEnd ? capEnd : value.range.to;
    onChange({ preset: "custom", range: { from, to: to > today ? today : to } });
  };
  const setTo = (to: string) => {
    if (!to) return;
    onChange({ preset: "custom", range: { from: value.range.from > to ? to : value.range.from, to } });
  };

  const toMax = (() => {
    const capEnd = addDays(value.range.from, maxDays - 1);
    return capEnd < today ? capEnd : today;
  })();

  return (
    <div className={look.wrap}>
      {/* The segmented look (owner's mock-up): a grey track, the chosen segment
          white with a small lift; on the reports, 44 px segments on a touch screen. */}
      <div role="group" aria-label="Period" data-ui={dashboard ? "period-track" : undefined} className={look.track}>
        {presets.map((p) => {
          const active = value.preset === p.id;
          const glyph = dashboard && isAdmin && p.id === "custom";
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              aria-label={glyph ? p.label : undefined}
              onClick={() => pick(p.id)}
              data-ui={dashboard ? "period-button" : undefined}
              className={cn(
                look.button,
                look.focus,
                active ? look.on : look.off,
                glyph && "px-2.5 @min-[560px]:px-3",
              )}
            >
              {glyph ? (
                <>
                  <NavBookings aria-hidden="true" strokeWidth={1.8} className="block size-[15px] @min-[560px]:hidden" />
                  <span className="hidden @min-[560px]:inline">{p.label}</span>
                </>
              ) : (
                p.label
              )}
            </button>
          );
        })}
      </div>
      {value.preset === "custom" && (
        <div className="flex items-center gap-2">
          <DatePicker
            value={value.range.from}
            onChange={setFrom}
            min={earliest}
            max={isAdmin ? value.range.to : today}
            aria-label={isAdmin ? "From date" : "Day"}
            className={look.date}
          />
          {isAdmin && (
            <>
              <span className={dashboard ? "text-[13px] text-muted-foreground" : "text-[13px] text-brand-muted"}>to</span>
              <DatePicker
                value={value.range.to}
                onChange={setTo}
                min={value.range.from}
                max={toMax}
                aria-label="To date"
                className={look.date}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
