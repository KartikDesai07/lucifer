"use client";

import { DatePicker } from "@/components/shared/DatePicker";
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
}

export function RangeBar({ value, onChange, isAdmin, maxDays = MAX_DASHBOARD_RANGE_DAYS }: RangeBarProps) {
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
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
      <div
        role="group"
        aria-label="Period"
        // inline-size containment on a phone: the five buttons scroll inside the row
        // instead of setting the page's minimum width.
        className="flex w-full max-w-full overflow-x-auto rounded-lg border border-brand-rule bg-brand-slip p-0.5 [contain:inline-size] sm:w-auto sm:[contain:none]"
      >
        {presets.map((p) => {
          const active = value.preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => pick(p.id)}
              className={cn(
                "h-9 flex-1 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors sm:h-8 sm:flex-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
                active ? "bg-brand-primary text-brand-slip" : "text-brand-muted hover:bg-brand-wash hover:text-brand-ink",
              )}
            >
              {p.label}
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
            className="h-9 border-brand-rule bg-brand-slip text-[13px] text-brand-ink sm:h-8 sm:w-[150px]"
          />
          {isAdmin && (
            <>
              <span className="text-[13px] text-brand-muted">to</span>
              <DatePicker
                value={value.range.to}
                onChange={setTo}
                min={value.range.from}
                max={toMax}
                aria-label="To date"
                className="h-9 border-brand-rule bg-brand-slip text-[13px] text-brand-ink sm:h-8 sm:w-[150px]"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
