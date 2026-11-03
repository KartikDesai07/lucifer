"use client";

import { RowPrimary, RowRelative, guestsWord, type RowIntent } from "@/components/reservations/ReservationRowParts";
import { ReservationPill } from "@/components/reservations/ReservationPill";
import {
  RES_CARD_AP_CLASS,
  RES_CARD_HM_CLASS,
  RES_CARD_MIDDLE_CLASS,
  RES_CARD_NAME_CLASS,
  RES_CARD_RIGHT_CLASS,
  RES_CARD_SUB_CLASS,
  RES_CARD_TIME_CLASS,
  RES_DIM_NAME_CLASS,
  RES_DIM_SUB_CLASS,
  RES_OPEN_CLASS,
  RES_ROW_CARD_CLASS,
  RES_ROW_RULE_CLASS,
  RES_ROW_SELECTED_CLASS,
} from "@/lib/reservations-layout";
import { clockOf, dayTag, pillOf, rowActions } from "@/lib/reservations-view";
import { cn } from "@/lib/utils";
import type { Reservation } from "@/types";

interface ReservationRowCardProps {
  r: Reservation;
  first: boolean;
  nowMs: number;
  today: string;
  /** All dates or a search: "Wed 4 · " in front of the sub (design 6.3). */
  showDay: boolean;
  selected: boolean;
  busy: boolean;
  onOpen: (r: Reservation) => void;
  onAction: RowIntent;
}

/** The HTML's card row (values 8.3): the time column, the name / sub / relative line, the pill over the primary. No icon
 *  buttons: the rest of the actions live in the detail (Task 3). The row is one real button stretched over it (B7). */
export function ReservationRowCard({ r, first, nowMs, today, showDay, selected, busy, onOpen, onAction }: ReservationRowCardProps) {
  const clock = clockOf(r.time);
  const pill = pillOf(r, nowMs, today);
  const dim = r.status === "Completed" || r.status === "Cancelled";
  const { primary } = rowActions(r, today);
  const sub = `${showDay ? `${dayTag(r.date)} · ` : ""}${guestsWord(r.guests)} · ${r.tableNo || "No table"}`;
  return (
    <div data-ui="reservations-card" className={cn(RES_ROW_CARD_CLASS, !first && RES_ROW_RULE_CLASS, selected && RES_ROW_SELECTED_CLASS)}>
      <span className={RES_CARD_TIME_CLASS}>
        <span data-ui="reservations-card-time" className={cn(RES_CARD_HM_CLASS, dim && RES_DIM_NAME_CLASS, r.status === "Cancelled" && "line-through")}>
          {clock.hm}
        </span>
        <span data-ui="reservations-card-ap" className={RES_CARD_AP_CLASS}>
          {clock.ap}
        </span>
      </span>
      <span className={RES_CARD_MIDDLE_CLASS}>
        <button
          type="button"
          data-ui="reservations-card-open"
          aria-label={`${r.name}, ${clock.full}, ${pill}`}
          aria-current={selected ? "true" : undefined}
          onClick={() => onOpen(r)}
          className={cn(RES_OPEN_CLASS, RES_CARD_NAME_CLASS, dim && RES_DIM_NAME_CLASS)}
        >
          {r.name}
        </button>
        <span data-ui="reservations-card-sub" className={cn(RES_CARD_SUB_CLASS, dim && RES_DIM_SUB_CLASS)}>
          {sub}
        </span>
        <RowRelative r={r} nowMs={nowMs} today={today} ui="reservations-card-relative" />
      </span>
      <span className={RES_CARD_RIGHT_CLASS}>
        <ReservationPill kind={pill} size="card" ui="reservations-card-pill" />
        {primary && <RowPrimary r={r} action={primary} selected={selected} busy={busy} ui="reservations-card" onAction={onAction} />}
      </span>
    </div>
  );
}
