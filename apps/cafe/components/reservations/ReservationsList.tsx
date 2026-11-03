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
  /** The shown view: the day choice, the status tab and the typed query. The cards wrapper is keyed on it (U15, below). */
  viewKey: string;
  /** The page's one status-write flag (B13). */
  busy: boolean;
  onOpen: (r: Reservation) => void;
  onAction: RowIntent;
}

/** The list card (values 8.1): one white box holding the rows, as the table form and as cards; the list column's width
 *  (the container query) shows one of them. The box is a permanent wrapper around the rows (WebView 109, U3 VC-3). */
export function ReservationsList({ rows, nowMs, today, showDay, selectedId, viewKey, busy, onOpen, onAction }: ReservationsListProps) {
  return (
    <div data-ui="reservations-rows" className={RES_LIST_CARD_CLASS}>
      <ReservationsTable rows={rows} nowMs={nowMs} today={today} showDay={showDay} selectedId={selectedId} busy={busy} onOpen={onOpen} onAction={onAction} />
      {/* Keyed on the shown view (VC-3 / V2-1, ruling U15): WebView 109's accessibility tree drops cards that React inserts into
          a container that stayed mounted, so after All dates or a cleared search a screen reader lost cards (measured on the
          emulator's 109 in finalc3-fix\: All dates 3 of 6 and a cleared search 1 of 3 cards in the tree). A new wrapper per view
          takes every card into an empty container: 6 of 6 and 3 of 3. A card added later to the same view is still dropped on 109
          (3 of 4; an owner note), and 154 keeps all. The wrapper is the same box: nothing moves. */}
      <div key={viewKey} data-ui="reservations-cards" className={RES_CARDS_WRAP_CLASS}>
        {rows.map((r, i) => (
          <ReservationRowCard key={r._id} r={r} first={i === 0} nowMs={nowMs} today={today} showDay={showDay} selected={r._id === selectedId} busy={busy} onOpen={onOpen} onAction={onAction} />
        ))}
      </div>
    </div>
  );
}
