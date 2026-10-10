"use client";

import * as React from "react";
import { ClockIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  HOUR_OPTIONS,
  PERIOD_OPTIONS,
  minuteOptions,
  parseTimeInput,
  timeLabel,
  withTimePart,
  type TimeParts,
} from "@/lib/time-input";

// Keep the panel off the screen edge on a phone (the DatePicker's measured gap).
const POPOVER_EDGE_GAP_PX = 12;
// Five 44px touch rows (220px) + the list's own p-1: a 360x640 phone shows the
// header, the lists and "Done" together with room to spare. Fixed rem, never
// dvh (the staff tablets' browser lacks it).
const LIST_MAX_HEIGHT_CLASS = "max-h-60";
// Never taller than the room Radix measured beside the trigger (a 360x640 phone with the field low on the sheet
// clipped "Done" by 6 px — s89g smoke): the lists shrink and scroll, "Done" always stays whole.
const PANEL_FIT_CLASS = "flex max-h-[var(--radix-popover-content-available-height)] w-auto flex-col overflow-hidden p-0";
// Soft-blue active look (the nav's): fill + ink + semibold, never dots or pills.
const OPTION_ACTIVE_CLASS = "bg-brand-primary-soft font-semibold text-brand-ink";
const OPTION_IDLE_CLASS = "text-brand-ink/80 hover:bg-brand-wash hover:text-brand-ink";
const OPTION_CLASS =
  "flex h-9 w-full items-center justify-center rounded-md px-3 text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent pointer-coarse:h-11";

interface TimePickerProps {
  value: string; // "HH:mm" (24 h) or "" = no time
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  /** The field failed validation: a red edge (the message is the form's own). */
  invalid?: boolean;
  className?: string;
}

interface ColumnProps {
  label: string;
  children: React.ReactNode;
}

function Column({ label, children }: ColumnProps) {
  return (
    <div role="group" aria-label={label} className="flex min-h-0 min-w-16 flex-col">
      <div className="px-3 pb-1 pt-2 text-center text-xs font-medium text-brand-muted">{label}</div>
      <div data-time-list className={cn("relative min-h-0 space-y-0.5 overflow-y-auto overscroll-contain p-1", LIST_MAX_HEIGHT_CLASS)}>
        {children}
      </div>
    </div>
  );
}

interface OptionProps {
  selected: boolean;
  onPick: () => void;
  children: React.ReactNode;
}

function Option({ selected, onPick, children }: OptionProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className={cn(OPTION_CLASS, selected ? OPTION_ACTIVE_CLASS : OPTION_IDLE_CLASS)}
    >
      {children}
    </button>
  );
}

interface PanelProps {
  value: string;
  onChange: (next: string) => void;
  onDone: () => void;
}

// Mounts only while the popover is open, so the layout effect = "on open":
// each list scrolls its selected row to the middle (scrollTop on the list
// itself — scrollIntoView could also scroll the page behind the popover).
function Panel({ value, onChange, onDone }: PanelProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const parts: TimeParts | null = parseTimeInput(value);

  React.useLayoutEffect(() => {
    rootRef.current?.querySelectorAll<HTMLElement>("[data-time-list]").forEach((list) => {
      const row = list.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (row) list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
    });
  }, []);

  // `now` is read at the tap, so a first tap on an empty value fills the
  // other parts from the moment of the tap.
  const pick = (change: Partial<TimeParts>) => onChange(withTimePart(value, change, new Date()));

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 justify-center divide-x divide-brand-rule">
        <Column label="Hour">
          {HOUR_OPTIONS.map((h) => (
            <Option key={h} selected={parts?.hour12 === h} onPick={() => pick({ hour12: h })}>
              {h}
            </Option>
          ))}
        </Column>
        <Column label="Minute">
          {minuteOptions(parts?.minute ?? null).map((m) => (
            <Option key={m} selected={parts?.minute === m} onPick={() => pick({ minute: m })}>
              {String(m).padStart(2, "0")}
            </Option>
          ))}
        </Column>
        <Column label="AM / PM">
          {PERIOD_OPTIONS.map((p) => (
            <Option key={p} selected={parts?.period === p} onPick={() => pick({ period: p })}>
              {p}
            </Option>
          ))}
        </Column>
      </div>
      <div className="shrink-0 border-t border-brand-rule p-2">
        <button
          type="button"
          onClick={onDone}
          className={cn(
            buttonVariants({ variant: "default" }),
            "h-10 w-full bg-brand-primary text-brand-slip hover:bg-brand-primary-hover pointer-coarse:h-11",
          )}
        >
          Done
        </button>
      </div>
    </div>
  );
}

export const TimePicker = React.forwardRef<HTMLButtonElement, TimePickerProps>(
  function TimePicker(
    { value, onChange, disabled, placeholder = "Pick a time", id, "aria-label": ariaLabel, invalid, className },
    ref,
  ) {
    const [open, setOpen] = React.useState(false);
    const label = timeLabel(value);

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
              !label && "text-muted-foreground",
              invalid && "border-destructive",
              className,
            )}
          >
            <ClockIcon className="mr-2 h-4 w-4 shrink-0" />
            {label || placeholder}
          </button>
        </PopoverTrigger>
        <PopoverContent className={PANEL_FIT_CLASS} align="start" collisionPadding={POPOVER_EDGE_GAP_PX}>
          <Panel value={value} onChange={onChange} onDone={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    );
  },
);
