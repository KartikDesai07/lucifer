"use client";

import { RowAssign, RowIcons, RowPrimary, RowRelative, type RowIntent } from "@/components/reservations/ReservationRowParts";
import { ReservationPill } from "@/components/reservations/ReservationPill";
import {
  RES_DIM_NAME_CLASS,
  RES_DIM_SUB_CLASS,
  RES_ICONS_CLASS,
  RES_OPEN_CLASS,
  RES_ROW_RULE_CLASS,
  RES_ROW_SELECTED_CLASS,
  RES_ROW_TABLE_CLASS,
  RES_TABLE_HEAD_CLASS,
  RES_TABLE_NAME_CLASS,
  RES_TABLE_SUB_CLASS,
  RES_TABLE_WRAP_CLASS,
} from "@/lib/reservations-layout";
import { clockOf, dayTag, formatMobile, pillOf, rowActions } from "@/lib/reservations-view";
import { cn } from "@/lib/utils";
import type { Reservation } from "@/types";

const HEAD_WORDS = ["Time", "Guest", "Party", "Table", "Status", "Actions"];

interface ReservationsTableProps {
  rows: Reservation[];
  nowMs: number;
  today: string;
  /** All dates or a search: the day leads the sub-line (design 6.3). */
  showDay: boolean;
  selectedId: string | null;
  busy: boolean;
  onOpen: (r: Reservation) => void;
  onAction: RowIntent;
}

function TableRow({ r, first, nowMs, today, showDay, selected, busy, onOpen, onAction }: Omit<ReservationsTableProps, "rows" | "selectedId"> & { r: Reservation; first: boolean; selected: boolean }) {
  const clock = clockOf(r.time);
  const pill = pillOf(r, nowMs, today);
  const dim = r.status === "Completed" || r.status === "Cancelled";
  const { icons, primary } = rowActions(r, today);
  const canAssign = !r.tableNo && (r.status === "Booked" || r.status === "Seated");
  const sub = [showDay ? dayTag(r.date) : "", formatMobile(r.mobile), r.notes?.trim() ?? ""].filter(Boolean).join(" · ");
  return (
    <div data-ui="reservations-row" className={cn(RES_ROW_TABLE_CLASS, !first && RES_ROW_RULE_CLASS, selected && RES_ROW_SELECTED_CLASS)}>
      <span className="min-w-0">
        <span data-ui="reservations-row-time" className={cn("block text-[14px] font-semibold", dim && RES_DIM_NAME_CLASS, r.status === "Cancelled" && "line-through")}>
          {clock.full}
        </span>
        <RowRelative r={r} nowMs={nowMs} today={today} ui="reservations-row-relative" />
      </span>
      <span className="min-w-0">
        <button
          type="button"
          data-ui="reservations-row-open"
          aria-label={`${r.name}, ${clock.full}, ${pill}`}
          aria-current={selected ? "true" : undefined}
          onClick={() => onOpen(r)}
          className={cn(RES_OPEN_CLASS, RES_TABLE_NAME_CLASS, dim && RES_DIM_NAME_CLASS)}
        >
          {r.name}
        </button>
        <span data-ui="reservations-row-sub" className={cn(RES_TABLE_SUB_CLASS, dim && RES_DIM_SUB_CLASS)}>
          {sub}
        </span>
      </span>
      <span className="text-[14px] font-medium">{r.guests}</span>
      <span className="min-w-0">
        {r.tableNo ? (
          <span data-ui="reservations-row-table" className="block text-[14px] font-medium [overflow-wrap:anywhere]">
            {r.tableNo}
          </span>
        ) : (
          canAssign && <RowAssign onPress={() => onAction(r, "assign")} />
        )}
      </span>
      <span>
        <ReservationPill kind={pill} size="table" ui="reservations-row-pill" />
      </span>
      <span className={RES_ICONS_CLASS}>
        <RowIcons r={r} icons={icons} busy={busy} onAction={onAction} />
        {primary && <RowPrimary r={r} action={primary} selected={selected} busy={busy} ui="reservations-row" onAction={onAction} />}
      </span>
    </div>
  );
}

/** The HTML's table form (values 8.2): the sticky head and one row per booking, in a section the list column's width shows
 *  from 904px (B1). Rows are not targets themselves: the stretched name button is (B7). */
export function ReservationsTable({ rows, selectedId, ...rest }: ReservationsTableProps) {
  return (
    <div data-ui="reservations-table" className={RES_TABLE_WRAP_CLASS}>
      <div data-ui="reservations-table-head" className={RES_TABLE_HEAD_CLASS}>
        {HEAD_WORDS.map((w) => (
          <span key={w} className={w === "Actions" ? "text-right" : undefined}>
            {w}
          </span>
        ))}
      </div>
      {rows.map((r, i) => (
        <TableRow key={r._id} r={r} first={i === 0} selected={r._id === selectedId} {...rest} />
      ))}
    </div>
  );
}
