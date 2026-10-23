"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { formatDateInput, parseDateInput } from "@/lib/date-input";
import { ORDERS_DATE_CHOICES, PICK_A_DAY, dateFilterOf, dateLabel, type OrdersDate } from "@/lib/orders-lanes";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// values 4.1: the HTML's date select (flex 0 1 160px, min 130px, hidden on the phone where the Filters panel's Date group
// takes over): 40px, 0 32px 0 12px, 1px --border, radius 9, on --surface, 13.5px 500; the 14px --text-2 chevron at
// right 11 / top 13. The HTML's open list is the browser's own (not measured): ours is the kit Popover (no native
// select, pin P13), each row 36px, the chosen one ticked.
const WRAP_CLASS = "relative flex min-w-[130px] flex-[0_1_160px] max-tab:hidden";
const BOX_CLASS =
  "flex h-10 w-full min-w-0 cursor-pointer items-center rounded-[9px] border border-border bg-card pl-3 pr-8 text-left text-[13.5px] font-medium text-foreground outline-none";
const CHEVRON_CLASS = "pointer-events-none absolute top-[13px] right-[11px] text-muted-foreground";
const ROW_CLASS =
  "flex h-9 w-full cursor-pointer items-center justify-between gap-3 rounded-[8px] border-0 bg-transparent px-2.5 text-left text-[13.5px] font-medium whitespace-nowrap text-foreground hover:bg-hover";
// Touch-friendly calendar cells (DatePicker's): 7 columns of 40px + the Calendar's own 12px padding = 304px.
const CALENDAR_CELL_CLASS = "[--cell-size:2.5rem]";
/** Keeps a popover off the screen's edge on a phone (DatePicker's gap). */
export const ORDERS_POPOVER_EDGE_GAP_PX = 12;

/** Our calendar for "Pick a day…" (owner Q5): one day, opening on the chosen day's month (Today and Yesterday are days
 *  too; All dates opens on this month); a tap picks that day, the chosen one again included. */
export function OrdersDayCalendar({ date, onPick }: { date: OrdersDate; onPick: (day: string) => void }) {
  const chosen = parseDateInput(dateFilterOf(date, new Date()) ?? "");
  return (
    <Calendar
      mode="single"
      required
      selected={chosen}
      defaultMonth={chosen}
      onSelect={(day) => onPick(formatDateInput(day))}
      className={CALENDAR_CELL_CLASS}
      autoFocus
    />
  );
}

function DateRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" data-ui="orders-date-row" aria-pressed={on} onClick={onClick} className={ROW_CLASS}>
      {label}
      {on && <Check aria-hidden="true" className="size-3.5 flex-none" />}
    </button>
  );
}

interface OrdersDateBoxProps {
  date: OrdersDate;
  onDate: (date: OrdersDate) => void;
}

/**
 * The toolbar's date box (owner Q5; design 6.3): the chosen date's words ("Today" first), and in its popover Today /
 * Yesterday / All dates / Pick a day…; "Pick a day…" turns the same popover into our calendar and a picked day closes it.
 * The Open lane ignores the date (ordersQuery).
 */
export function OrdersDateBox({ date, onDate }: OrdersDateBoxProps) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next) setPicking(false);
  };
  const choose = (next: OrdersDate) => {
    onDate(next);
    openChange(false);
  };
  const label = dateLabel(date);

  return (
    <div data-ui="orders-date" className={WRAP_CLASS}>
      <Popover open={open} onOpenChange={openChange}>
        <PopoverTrigger asChild>
          <button type="button" data-ui="orders-date-box" aria-label={`Date: ${label}`} className={BOX_CLASS}>
            <span className="min-w-0 truncate">{label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={ORDERS_POPOVER_EDGE_GAP_PX}
          className={cn("w-auto", picking ? "p-0" : "min-w-(--radix-popover-trigger-width) p-1")}
        >
          {picking ? (
            <OrdersDayCalendar date={date} onPick={(day) => choose({ kind: "day", date: day })} />
          ) : (
            <div data-ui="orders-date-list" className="flex flex-col">
              {ORDERS_DATE_CHOICES.map((choice) => (
                <DateRow key={choice.kind} label={dateLabel(choice)} on={date.kind === choice.kind} onClick={() => choose(choice)} />
              ))}
              <DateRow label={PICK_A_DAY} on={date.kind === "day"} onClick={() => setPicking(true)} />
            </div>
          )}
        </PopoverContent>
      </Popover>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        data-ui="orders-date-chevron"
        className={CHEVRON_CLASS}
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
