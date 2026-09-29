"use client";

import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { formatDateInput, parseDateInput } from "@/lib/date-input";

// Touch-friendly cell size: 7 columns of 2.5rem (40px) + the Calendar's own
// p-3 (24px) = 304px, inside a 360px phone's 328px (16px gutter each side).
const CALENDAR_CELL_SIZE_CLASS = "[--cell-size:2.5rem]";
const DISPLAY_FORMAT = "d MMM yyyy";
// Keep the calendar off the screen edge on a phone (measured flush at 360px).
const POPOVER_EDGE_GAP_PX = 12;

interface DatePickerProps {
  value: string; // "YYYY-MM-DD" or "" = no date
  onChange: (next: string) => void;
  min?: string; // "YYYY-MM-DD", inclusive
  max?: string; // "YYYY-MM-DD", inclusive
  disabled?: boolean;
  clearable?: boolean;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  /** The field failed validation: a red edge (the message is the form's own). */
  invalid?: boolean;
  className?: string;
}

export const DatePicker = React.forwardRef<HTMLButtonElement, DatePickerProps>(
  function DatePicker(
    {
      value,
      onChange,
      min,
      max,
      disabled,
      clearable,
      placeholder = "Pick a date",
      id,
      "aria-label": ariaLabel,
      invalid,
      className,
    },
    ref,
  ) {
    const [open, setOpen] = React.useState(false);
    const selected = parseDateInput(value);
    const minDate = min ? parseDateInput(min) : undefined;
    const maxDate = max ? parseDateInput(max) : undefined;

    // react-day-picker hands back undefined when the SELECTED day is tapped
    // again (useSingle without `required`). Only a clearable picker may go
    // blank that way; every other one keeps its date (End of day, the report
    // range and the two form dates must never silently empty).
    const handleSelect = (day: Date | undefined) => {
      if (day) onChange(formatDateInput(day));
      else if (clearable) onChange("");
      setOpen(false);
    };

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={ref}
            id={id}
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "w-full justify-start text-left font-normal",
              !selected && "text-muted-foreground",
              invalid && "border-destructive",
              className,
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            {selected ? format(selected, DISPLAY_FORMAT) : placeholder}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" collisionPadding={POPOVER_EDGE_GAP_PX}>
          <Calendar
            mode="single"
            selected={selected}
            // Open on the chosen date's month, not today's (the library's
            // default ignores `selected`); clamped to min/max by the library.
            defaultMonth={selected}
            onSelect={handleSelect}
            disabled={(day) => !!(minDate && day < minDate) || !!(maxDate && day > maxDate)}
            startMonth={minDate}
            endMonth={maxDate}
            className={CALENDAR_CELL_SIZE_CLASS}
            autoFocus
          />
          {clearable && selected && (
            <div className="border-t p-2">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full")}
              >
                Clear
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    );
  },
);
