"use client";

import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { useStableCallback } from "@/hooks/use-stable-callback";
import {
  ORDERS_DATE_CHOICES,
  ORDERS_PAYMENT_CHOICES,
  PICK_A_DAY,
  dateLabel,
  type OrdersChip,
  type OrdersChipKey,
  type OrdersDate,
  type OrdersFilterState,
} from "@/lib/orders-lanes";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ORDERS_POPOVER_EDGE_GAP_PX, OrdersDayCalendar } from "@/components/orders/OrdersDateBox";

/** The panel's id: the Filters button's aria-controls while it is open. */
export const ORDERS_FILTERS_PANEL_ID = "orders-filters";

// The "All tables" choice's value. Table names are free text (CR1.1) but TABLE_NO_PATTERN needs an alphanumeric first
// character, so a leading underscore is a value no real table can carry (a table named "all" never clears the filter).
const ALL_TABLES = "__all__";

// values 5.1: in the page flow under the toolbar (it pushes the list down), radius 12, 14px padding, groups 14px apart,
// no shadow; it rises in .25s.
const PANEL_CLASS =
  "flex flex-col gap-3.5 rounded-[12px] border border-border bg-card p-3.5 motion-safe:animate-html-rise-fast";
const GROUP_CLASS = "flex flex-col gap-2";
const LABEL_CLASS = "text-[11.5px] font-semibold tracking-[.06em] text-subtle-foreground uppercase";
const OPTIONS_CLASS = "flex flex-wrap gap-1.5";
const PILL_CLASS = "h-8 cursor-pointer whitespace-nowrap rounded-[999px] border px-3 text-[13px] font-medium";
const PILL_ON_CLASS = "border-ink bg-ink text-on-ink";
const PILL_OFF_CLASS = "border-border bg-card text-foreground";
// The Table select (values 5.1): the kit Select (no native select, pin P13) at 260 x 38, 0 32px 0 12px, radius 9,
// 13.5px 400; its chevron 14px --text-2 at right 11.
const TABLE_TRIGGER_CLASS =
  "h-[38px] w-full max-w-[260px] cursor-pointer rounded-[9px] border-border bg-card py-0 pl-3 pr-[11px] text-[13.5px] text-foreground [&>svg]:size-3.5 [&>svg]:text-muted-foreground [&>svg]:opacity-100";
const FOOT_CLASS = "flex justify-end gap-2 border-t border-border-2 pt-3";
const RESET_CLASS = "h-[34px] cursor-pointer border-0 bg-transparent px-3 text-[13px] font-medium text-muted-foreground";
const DONE_CLASS = "h-[34px] cursor-pointer rounded-[8px] border-0 bg-ink px-4 text-[13px] font-semibold text-on-ink";

// values 6: the chips row, 6px apart; a chip 28px, 0 6px 0 10px, --accent-t / --accent-i, 12.5px 600; its 18px ✕ circle
// in the accent's 14% tint (the HTML's literal rgba(15,98,254,.14) in a token, design 6.3: follows presets and dark).
const CHIPS_CLASS = "flex flex-wrap items-center gap-1.5";
const CHIP_CLASS =
  "flex h-7 cursor-pointer items-center gap-1.5 rounded-[999px] border-0 bg-accent py-0 pl-2.5 pr-1.5 text-[12.5px] font-semibold text-accent-foreground";
const CHIP_X_CLASS = "flex size-[18px] items-center justify-center rounded-[50%] bg-primary/14 text-[9px]";
const CLEAR_ALL_CLASS = "cursor-pointer border-0 bg-transparent px-1 text-[12.5px] font-medium text-muted-foreground";

/** A choice pill; the rest of its props (a popover trigger's handlers, aria and ref) go to the button. */
function Pill({ on, className, ...rest }: ComponentProps<"button"> & { on: boolean }) {
  return (
    <button
      type="button"
      data-ui="orders-filter-option"
      aria-pressed={on}
      {...rest}
      className={cn(PILL_CLASS, on ? PILL_ON_CLASS : PILL_OFF_CLASS, className)}
    />
  );
}

/** A group of pills, named by its visible label (aria-labelledby, so the name is the words on screen). */
function Group({ ui, label, className, children }: { ui: string; label: string; className?: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <div data-ui={ui} role="group" aria-labelledby={labelId} className={cn(GROUP_CLASS, className)}>
      <span id={labelId} data-ui="orders-filter-label" className={LABEL_CLASS}>
        {label}
      </span>
      <div className={OPTIONS_CLASS}>{children}</div>
    </div>
  );
}

/** The phone's "Pick a day…" pill: our calendar in a popover; a picked day closes it. */
function DayPill({ date, onDate }: { date: OrdersDate; onDate: (date: OrdersDate) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Pill on={date.kind === "day"}>{PICK_A_DAY}</Pill>
      </PopoverTrigger>
      <PopoverContent aria-label="Pick a day" align="start" collisionPadding={ORDERS_POPOVER_EDGE_GAP_PX} className="w-auto p-0">
        <OrdersDayCalendar
          date={date}
          onPick={(day) => {
            onDate({ kind: "day", date: day });
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

interface OrdersFiltersPanelProps {
  filters: OrdersFilterState;
  /** The cafe's table names for the Table select. */
  tables: string[];
  onChange: (patch: Partial<OrdersFilterState>) => void;
  /** Reset: the HTML's ov.clear (payment, table and the phone search; the date stays; the panel stays open). */
  onReset: () => void;
  /** Done or Escape; `focusWasInside` lets the page hand the focus back to the Filters button. */
  onClose: (focusWasInside: boolean) => void;
}

/**
 * The owner's HTML Filters panel (values 5; design 6.3): on the phone a Date group first (Today · Yesterday · All dates ·
 * Pick a day…), then Payment (Any and our five settled modes) and Table (the kit select); Reset and Done. Picking keeps it
 * open. Escape closes it too (design 6.13) unless a popover or select inside it took the key (Radix prevents default).
 */
export function OrdersFiltersPanel({ filters, tables, onChange, onReset, onClose }: OrdersFiltersPanelProps) {
  const root = useRef<HTMLDivElement>(null);
  const close = useStableCallback(() => onClose(root.current?.contains(document.activeElement) ?? false));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div ref={root} id={ORDERS_FILTERS_PANEL_ID} data-ui="orders-filters" role="region" aria-label="Filters" className={PANEL_CLASS}>
      <Group ui="orders-filter-date" label="Date" className="tab:hidden">
        {ORDERS_DATE_CHOICES.map((choice) => (
          <Pill key={choice.kind} on={filters.date.kind === choice.kind} onClick={() => onChange({ date: choice })}>
            {dateLabel(choice)}
          </Pill>
        ))}
        <DayPill date={filters.date} onDate={(date) => onChange({ date })} />
      </Group>
      <Group ui="orders-filter-payment" label="Payment">
        <Pill on={filters.payment === null} onClick={() => onChange({ payment: null })}>
          Any
        </Pill>
        {ORDERS_PAYMENT_CHOICES.map((mode) => (
          <Pill key={mode} on={filters.payment === mode} onClick={() => onChange({ payment: mode })}>
            {mode}
          </Pill>
        ))}
      </Group>
      <div data-ui="orders-filter-table" className={GROUP_CLASS}>
        <span data-ui="orders-filter-label" className={LABEL_CLASS}>
          Table
        </span>
        <Select
          value={filters.tableNo ?? ALL_TABLES}
          onValueChange={(v) => onChange({ tableNo: v === ALL_TABLES ? null : v })}
        >
          <SelectTrigger data-ui="orders-filter-table-select" aria-label="Filter by table" className={TABLE_TRIGGER_CLASS}>
            <SelectValue>{filters.tableNo ?? "All tables"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TABLES}>All tables</SelectItem>
            {tables.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div data-ui="orders-filters-foot" className={FOOT_CLASS}>
        <button type="button" data-ui="orders-filters-reset" onClick={onReset} className={RESET_CLASS}>
          Reset
        </button>
        <button type="button" data-ui="orders-filters-done" onClick={close} className={DONE_CLASS}>
          Done
        </button>
      </div>
    </div>
  );
}

interface OrdersChipsProps {
  chips: OrdersChip[];
  onClear: (key: OrdersChipKey) => void;
  /** "Clear all": the HTML's ov.clear (payment, table and the phone search; the date stays). */
  onClearAll: () => void;
}

/** The chips row (values 6): one chip per filter on (lib/orders-lanes.ts filterChips), each clearing its own filter, and
 *  "Clear all". Nothing when no filter is on. */
export function OrdersChips({ chips, onClear, onClearAll }: OrdersChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div data-ui="orders-chips" className={CHIPS_CLASS}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          data-ui="orders-chip"
          data-chip={chip.key}
          aria-label={`Remove ${chip.label}`}
          onClick={() => onClear(chip.key)}
          className={CHIP_CLASS}
        >
          {chip.label}
          <span aria-hidden="true" data-ui="orders-chip-x" className={CHIP_X_CLASS}>
            ✕
          </span>
        </button>
      ))}
      <button type="button" data-ui="orders-chips-clear" onClick={onClearAll} className={CLEAR_ALL_CLASS}>
        Clear all
      </button>
    </div>
  );
}
