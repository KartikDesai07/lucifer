"use client";

import { CalendarDays } from "lucide-react";

import { DatePicker } from "@/components/shared/DatePicker";
import { TimePicker } from "@/components/shared/TimePicker";
import { DINNER_SLOTS, LUNCH_SLOTS, dayChips, isSlotTime, moreLabel, slotGuests, slotPassed } from "@/lib/reservation-form";
import { MENU_EDITOR_ERROR_CLASS, MENU_EDITOR_FIELD_CLASS, MENU_EDITOR_LABEL_CLASS } from "@/lib/menu-editor-layout";
import {
  RES_FORM_DAY_CLASS,
  RES_FORM_DAY_NUM_CLASS,
  RES_FORM_DAY_ROW_CLASS,
  RES_FORM_DAY_STRIP_CLASS,
  RES_FORM_DAY_TOP_CLASS,
  RES_FORM_DOTS_CLASS,
  RES_FORM_DOT_CLASS,
  RES_FORM_DOT_EMPTY_CLASS,
  RES_FORM_DOT_EMPTY_ON_CLASS,
  RES_FORM_DOT_LIT_CLASS,
  RES_FORM_HEAD_CLASS,
  RES_FORM_HINT_CLASS,
  RES_FORM_MORE_CLASS,
  RES_FORM_MORE_ON_CLASS,
  RES_FORM_OFF_CLASS,
  RES_FORM_ON_CLASS,
  RES_FORM_OTHER_CLASS,
  RES_FORM_PERIOD_CLASS,
  RES_FORM_SLOTS_CLASS,
  RES_FORM_SLOT_CLASS,
  RES_FORM_SLOT_OFF_CLASS,
} from "@/lib/reservation-form-layout";
import { clockOf } from "@/lib/reservations-view";
import { cn } from "@/lib/utils";
import type { Reservation } from "@/types";

interface ReservationDayTimeFieldsProps {
  date: string;
  time: string;
  onDate: (next: string) => void;
  onTime: (next: string) => void;
  list: readonly Reservation[];
  /** The booking being edited (its own guests are no load); null for a new one. */
  editingId: string | null;
  today: string;
  nowMs: number;
  dateError?: string;
  timeError?: string;
}

/** The slot's tooltip: "Already passed" / "{n} guests booked around this time" / "Quiet". */
function slotTitle(passed: boolean, guests: number): string {
  if (passed) return "Already passed";
  return guests === 0 ? "Quiet" : `${guests} guest${guests === 1 ? "" : "s"} booked around this time`;
}

/** Date (the seven-day strip + More = the calendar) and Time (Lunch and Dinner half hours with the load dots + Other time =
 *  today's time picker) of the form (values 13.2 #2, #3; design 8.1, B4, B20). */
export function ReservationDayTimeFields({ date, time, onDate, onTime, list, editingId, today, nowMs, dateError, timeError }: ReservationDayTimeFieldsProps) {
  const chips = dayChips(today);
  const inStrip = chips.some((c) => c.day === date);
  const otherPicked = time !== "" && !isSlotTime(time);

  const slot = (t: string) => {
    const picked = t === time;
    // B20: a picked slot that has passed (editing today's late booking) wins: it stays picked and Save keeps the time.
    const passed = slotPassed(date, t, today, nowMs) && !picked;
    const guests = slotGuests(list, date, t, editingId);
    const load = guests >= 16 ? 3 : guests >= 8 ? 2 : guests > 0 ? 1 : 0;
    return (
      <button
        key={t}
        type="button"
        data-ui="reservation-form-slot"
        disabled={passed}
        aria-pressed={picked}
        title={slotTitle(passed, guests)}
        className={cn(RES_FORM_SLOT_CLASS, passed ? RES_FORM_SLOT_OFF_CLASS : picked ? RES_FORM_ON_CLASS : RES_FORM_OFF_CLASS)}
        onClick={() => onTime(t)}
      >
        <span>{clockOf(t).hm}</span>
        <span aria-hidden="true" className={RES_FORM_DOTS_CLASS}>
          {[1, 2, 3].map((i) => (
            <span key={i} className={cn(RES_FORM_DOT_CLASS, i <= load ? RES_FORM_DOT_LIT_CLASS : picked ? RES_FORM_DOT_EMPTY_ON_CLASS : RES_FORM_DOT_EMPTY_CLASS)} />
          ))}
        </span>
      </button>
    );
  };

  return (
    <>
      <div data-ui="reservation-form-date" role="group" aria-label="Date" className={MENU_EDITOR_FIELD_CLASS}>
        <span className={MENU_EDITOR_LABEL_CLASS}>Date</span>
        <div className={RES_FORM_DAY_ROW_CLASS}>
          <div data-ui="reservation-form-days" className={RES_FORM_DAY_STRIP_CLASS}>
            {chips.map((c) => (
              <button
                key={c.day}
                type="button"
                data-ui="reservation-form-day"
                aria-pressed={c.day === date}
                className={cn(RES_FORM_DAY_CLASS, c.day === date ? RES_FORM_ON_CLASS : RES_FORM_OFF_CLASS)}
                onClick={() => onDate(c.day)}
              >
                <span className={RES_FORM_DAY_TOP_CLASS}>{c.top}</span>
                <span className={RES_FORM_DAY_NUM_CLASS}>{c.num}</span>
              </button>
            ))}
          </div>
          <DatePicker
            id="res-date"
            aria-label="Pick another date"
            value={date}
            onChange={onDate}
            invalid={!!dateError}
            className={cn(RES_FORM_MORE_CLASS, date !== "" && !inStrip && RES_FORM_MORE_ON_CLASS)}
            label={
              <>
                <CalendarDays className="size-4 flex-none" strokeWidth={1.8} aria-hidden="true" />
                <span>{date !== "" && !inStrip ? moreLabel(date) : "More"}</span>
              </>
            }
          />
        </div>
        {dateError && <span className={MENU_EDITOR_ERROR_CLASS}>{dateError}</span>}
      </div>

      <div data-ui="reservation-form-time" role="group" aria-label="Time" className={MENU_EDITOR_FIELD_CLASS}>
        <div className={RES_FORM_HEAD_CLASS}>
          <span className={MENU_EDITOR_LABEL_CLASS}>Time</span>
          <span className={RES_FORM_HINT_CLASS}>Dots show how busy each slot is</span>
        </div>
        <span className={RES_FORM_PERIOD_CLASS}>Lunch · 12 – 4 pm</span>
        <div className={RES_FORM_SLOTS_CLASS}>{LUNCH_SLOTS.map(slot)}</div>
        <span className={RES_FORM_PERIOD_CLASS}>Dinner · 6 – 11 pm</span>
        <div className={RES_FORM_SLOTS_CLASS}>{DINNER_SLOTS.map(slot)}</div>
        <TimePicker
          id="res-time"
          aria-label="Other time"
          value={time}
          onChange={onTime}
          invalid={!!timeError}
          className={cn(RES_FORM_OTHER_CLASS, otherPicked ? RES_FORM_ON_CLASS : RES_FORM_OFF_CLASS)}
          label={otherPicked ? clockOf(time).full : "Other time"}
        />
        {timeError && <span className={MENU_EDITOR_ERROR_CLASS}>{timeError}</span>}
      </div>
    </>
  );
}
