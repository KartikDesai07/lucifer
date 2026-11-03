"use client";

import { ReservationRowCard } from "@/components/reservations/ReservationRowCard";
import { ReservationsTable } from "@/components/reservations/ReservationsTable";
import type { RowIntent } from "@/components/reservations/ReservationRowParts";
import { RES_CARDS_WRAP_CLASS, RES_LIST_CARD_CLASS } from "@/lib/reservations-layout";
import type { Reservation } from "@/types";

interface ReservationsListProps {
  rows: Reservation[];
  nowMs: number;
  today: string;
  /** True while All dates is chosen or a search is typed (design 6.3): each row names its day. */
  showDay: boolean;
  selectedId: string | null;
  /** The page's one status-write flag (B13). */
  busy: boolean;
  onOpen: (r: Reservation) => void;
  onAction: RowIntent;
}

/** The list card (values 8.1): one white box holding the rows, as the table form and as cards; the list column's width
 *  (the container query) shows one of them. The box is a permanent wrapper around the rows (WebView 109, U3 VC-3). */
export function ReservationsList({ rows, nowMs, today, showDay, selectedId, busy, onOpen, onAction }: ReservationsListProps) {
  return (
    <div data-ui="reservations-rows" className={RES_LIST_CARD_CLASS}>
      <ReservationsTable rows={rows} nowMs={nowMs} today={today} showDay={showDay} selectedId={selectedId} busy={busy} onOpen={onOpen} onAction={onAction} />
      <div data-ui="reservations-cards" className={RES_CARDS_WRAP_CLASS}>
        {rows.map((r, i) => (
          <ReservationRowCard key={r._id} r={r} first={i === 0} nowMs={nowMs} today={today} showDay={showDay} selected={r._id === selectedId} busy={busy} onOpen={onOpen} onAction={onAction} />
        ))}
      </div>
    </div>
  );
}
