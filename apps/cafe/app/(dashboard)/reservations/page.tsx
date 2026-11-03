"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { useReservationDelete, useReservationUpdate } from "@/hooks/use-reservation-writes";
import { useReservationsPage } from "@/hooks/use-reservations-page";
import type { ReservationStatus } from "@/lib/constants";
import {
  RESERVATIONS_PAGE_CLASS,
  RES_ADD_CLASS,
  RES_BODY_CLASS,
  RES_DETAIL_COLUMN_CLASS,
  RES_LIST_COLUMN_CLASS,
  RES_OFFLINE_CLASS,
  RES_PHONE_TITLE_MIN_PX,
  RES_SCROLLER_CLASS,
} from "@/lib/reservations-layout";
import { cancelledToast, statusToast } from "@/lib/reservations-toasts";
import { emptyWords, type ResAction } from "@/lib/reservations-view";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ReservationFormSheet, type ReservationPrefill } from "@/components/reservations/ReservationFormSheet";
import { ReservationsList } from "@/components/reservations/ReservationsList";
import { ReservationsEmpty, ReservationsSkeleton } from "@/components/reservations/ReservationsStates";
import { ReservationsToolbar } from "@/components/reservations/ReservationsToolbar";
import type { Reservation } from "@/types";

// The owner's HTML Reservations screen (U6; values 1 - 4, 9; design 5, 6): the page fills the screen under the shell's header
// like /orders (lib/reservations-layout.ts); the list column (the toolbar over the rows) and, from 1280px, the 400px detail
// column. The state (the day, the tab, the search, the rows, the counts, the header line) is hooks/use-reservations-page.ts
// (ruling U2); the writes are hooks/use-reservation-writes.ts. Task 2 draws the rows and cards, Task 3 the detail and the
// seat dialog, Task 4 the form.
export default function ReservationsPage() {
  const state = useReservationsPage();
  const reservations = state.status;
  // ONE instance for every status write (Seat, Complete, Cancel, Restore): its isPending is the page-wide busy flag (B13).
  const updateReservation = useReservationUpdate();
  const deleteReservation = useReservationDelete();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [prefill, setPrefill] = useState<ReservationPrefill | null>(null);
  const [deleting, setDeleting] = useState<Reservation | null>(null);
  const [cancelling, setCancelling] = useState<Reservation | null>(null);

  const openAdd = () => {
    setEditing(null);
    setPrefill(null);
    setFormOpen(true);
  };
  const openEdit = (r: Reservation) => {
    setEditing(r);
    setPrefill(null);
    setFormOpen(true);
  };
  // Book again (owner Q4): a NEW booking seeded with the guest's name, mobile and party.
  const bookAgain = (r: Reservation) => {
    setEditing(null);
    setPrefill({ name: r.name, mobile: r.mobile, guests: r.guests });
    setFormOpen(true);
  };

  const setStatus = (r: Reservation, next: ReservationStatus) =>
    updateReservation.mutate({ id: r._id, data: { status: next }, toast: statusToast(next) });

  // What a row raises (Task 2). Open order is a link the row draws itself (B17); the seat dialog and Assign come with Task 3.
  const onRowAction = (r: Reservation, action: ResAction) => {
    if (action === "seat") setStatus(r, "Seated");
    else if (action === "complete") setStatus(r, "Completed");
    else if (action === "restore") setStatus(r, "Booked");
    else if (action === "cancel") setCancelling(r);
    else if (action === "bookAgain") bookAgain(r);
  };

  const confirmCancel = async () => {
    if (!cancelling) return;
    try {
      await updateReservation.mutateAsync({ id: cancelling._id, data: { status: "Cancelled" }, toast: cancelledToast });
      setCancelling(null);
    } catch {
      // hook toasts on error
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteReservation.mutateAsync(deleting._id);
      setDeleting(null);
    } catch {
      // hook toasts on error
    }
  };

  const rows = state.rows;
  const busy = updateReservation.isPending;

  return (
    <div data-ui="reservations-page" className={RESERVATIONS_PAGE_CLASS}>
      <PageHeader
        eyebrow="Service"
        title="Reservations"
        description={state.header}
        phoneTitleMinPx={RES_PHONE_TITLE_MIN_PX}
        actions={
          <Button data-ui="reservations-add" aria-label="New reservation" onClick={openAdd} className={RES_ADD_CLASS}>
            <Plus aria-hidden="true" />
            <span className="max-tab:hidden">New reservation</span>
            <span className="tab:hidden">New</span>
          </Button>
        }
      />

      <div data-ui="reservations-body" className={RES_BODY_CLASS}>
        <div data-ui="reservations-list" className={RES_LIST_COLUMN_CLASS}>
          <div data-ui="reservations-scroller" className={RES_SCROLLER_CLASS}>
            <ReservationsToolbar
              day={state.day}
              today={state.today}
              onDay={state.setDay}
              tab={state.tab}
              onTab={state.setTab}
              counts={state.counts}
              query={state.query}
              onQuery={state.setQuery}
            />

            {reservations.isLoading ? (
              <ReservationsSkeleton />
            ) : reservations.isError && reservations.data === undefined ? (
              <ErrorState
                title="Couldn't load reservations"
                description="Check the internet connection, then try again."
                onRetry={() => void reservations.refetch()}
                retryLabel="Try again"
              />
            ) : reservations.isPaused && reservations.data === undefined ? (
              // A parked (offline) query has no data AND no error — never the empty box.
              <p role="status" className={RES_OFFLINE_CLASS}>
                You appear to be offline. Reservations will load when the connection is back.
              </p>
            ) : state.rows.length === 0 ? (
              <ReservationsEmpty {...emptyWords({ day: state.day, tab: state.tab, query: state.query, today: state.today })} onNew={openAdd} />
            ) : (
              <ReservationsList
                rows={rows}
                nowMs={state.nowMs}
                today={state.today}
                showDay={state.day === "all" || state.query.trim() !== ""}
                selectedId={null}
                busy={busy}
                onOpen={openEdit}
                onAction={onRowAction}
              />
            )}
          </div>
        </div>
        {/* The detail (Task 3): this column from 1280px, below it full screen from the foot. */}
        <div data-ui="reservations-detail-column" className={RES_DETAIL_COLUMN_CLASS} />
      </div>

      <ReservationFormSheet open={formOpen} onOpenChange={setFormOpen} reservation={editing} prefill={prefill ?? undefined} />

      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        look="sheet"
        title="Cancel this reservation?"
        description={
          cancelling
            ? `${cancelling.name} on ${formatDate(cancelling.date)} will be marked Cancelled.`
            : undefined
        }
        confirmLabel="Cancel reservation"
        cancelLabel="Keep booking"
        isLoading={updateReservation.isPending}
        onConfirm={confirmCancel}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        look="sheet"
        title="Delete reservation?"
        description={
          deleting ? `The booking for "${deleting.name}" will be permanently removed.` : undefined
        }
        confirmLabel="Delete"
        isLoading={deleteReservation.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
