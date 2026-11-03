"use client";

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";

import { formatDateInput, parseDateInput } from "@/lib/date-input";
import {
  RES_CALENDAR_CELL_CLASS,
  RES_DAY_BOX_CLASS,
  RES_DAY_GROUP_CLASS,
  RES_DAY_LABEL_CLASS,
  RES_DAY_ROW_CLASS,
  RES_DAY_STEP_CLASS,
  RES_POPOVER_EDGE_GAP_PX,
  RES_TODAY_CLASS,
} from "@/lib/reservations-layout";
import { dayLabel, resolveDay, shiftDay, type ResDayChoice } from "@/lib/reservations-view";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function Glyph({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

interface ReservationsDayBoxProps {
  day: ResDayChoice;
  today: string;
  /** Any change of day: a ‹ › step, "All dates", a calendar pick, Today (null). The page holds today as null. */
  onDay: (day: ResDayChoice) => void;
}

/**
 * The toolbar's day group (values 3; design 6.2; owner Q7): the 38px box — ‹ (Previous day), the day's words (the HTML's:
 * "Today · Tue, 3 Nov", a phone "Today"), › (Next day) — and, on another day, "Today". The words open our kit Popover (never
 * the HTML's native date input, P20): an "All dates" row (the Orders date box's row look) above the kit Calendar (that
 * box's 40px cells), so any day is one pick away and every date is one tap. On All dates ‹ › step from today: yesterday /
 * tomorrow. No limit either way (past days are reachable, as today's filter).
 */
export function ReservationsDayBox({ day, today, onDay }: ReservationsDayBoxProps) {
  const [open, setOpen] = useState(false);
  const all = day === "all";
  const shown = all ? today : resolveDay(day, today);
  const chosen = parseDateInput(shown);
  const label = (phone: boolean): string => dayLabel(all ? "all" : shown, today, phone);
  const choose = (next: ResDayChoice) => {
    onDay(next);
    setOpen(false);
  };

  return (
    <div data-ui="reservations-day-group" className={RES_DAY_GROUP_CLASS}>
      <div data-ui="reservations-day-box" className={RES_DAY_BOX_CLASS}>
        <button type="button" data-ui="reservations-day-prev" title="Previous day" aria-label="Previous day" onClick={() => onDay(shiftDay(shown, -1))} className={RES_DAY_STEP_CLASS}>
          <Glyph size={16}>
            <path d="M15 6l-6 6 6 6" />
          </Glyph>
        </button>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" data-ui="reservations-day-label" aria-label={`Day: ${label(false)}`} className={RES_DAY_LABEL_CLASS}>
              <Glyph size={15}>
                <path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" />
              </Glyph>
              <span className="max-tab:hidden">{label(false)}</span>
              <span className="tab:hidden">{label(true)}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent aria-label="Pick a day" align="start" collisionPadding={RES_POPOVER_EDGE_GAP_PX} className="w-auto p-1">
            <button type="button" data-ui="reservations-day-all" aria-current={all ? "true" : undefined} onClick={() => choose("all")} className={RES_DAY_ROW_CLASS}>
              All dates
              {all && <Check aria-hidden="true" className="size-3.5 flex-none" />}
            </button>
            <Calendar
              mode="single"
              required
              selected={all ? undefined : chosen}
              defaultMonth={chosen}
              onSelect={(picked) => choose(formatDateInput(picked))}
              className={RES_CALENDAR_CELL_CLASS}
              autoFocus
            />
          </PopoverContent>
        </Popover>
        <button type="button" data-ui="reservations-day-next" title="Next day" aria-label="Next day" onClick={() => onDay(shiftDay(shown, 1))} className={RES_DAY_STEP_CLASS}>
          <Glyph size={16}>
            <path d="M9 6l6 6-6 6" />
          </Glyph>
        </button>
      </div>
      {day !== null && day !== today && (
        <button type="button" data-ui="reservations-today" onClick={() => choose(null)} className={RES_TODAY_CLASS}>
          Today
        </button>
      )}
    </div>
  );
}
