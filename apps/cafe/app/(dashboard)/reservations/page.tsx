"use client";

import { useState } from "react";
import { Plus, CalendarClock } from "lucide-react";

import {
  useReservations,
  useUpdateReservation,
  useDeleteReservation,
  type ReservationFilters,
} from "@/hooks/use-reservations";
import { RESERVATION_STATUSES, type ReservationStatus } from "@/lib/constants";
import { formatDate, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DatePicker } from "@/components/shared/DatePicker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { BRAND_CONTROL_CLASS, BRAND_PANEL_CLASS } from "@/components/brand/brand-classes";
import { ReservationFormSheet } from "@/components/reservations/ReservationFormSheet";
import { ReservationRowCard } from "@/components/reservations/ReservationRowCard";
import { ReservationsTable } from "@/components/reservations/ReservationsTable";
import type { Reservation } from "@/types";

const ALL = "all";

export default function ReservationsPage() {
  return (
    <MenuPageShell>
      <ReservationsContent />
    </MenuPageShell>
  );
}

function ReservationsContent() {
  const [status, setStatusFilter] = useState(ALL);
  const [date, setDate] = useState("");

  const filters: ReservationFilters = {
    status: status === ALL ? undefined : status,
    date: date || undefined,
  };
  const reservations = useReservations(filters);
  const updateReservation = useUpdateReservation();
  const deleteReservation = useDeleteReservation();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [deleting, setDeleting] = useState<Reservation | null>(null);
  const [cancelling, setCancelling] = useState<Reservation | null>(null);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (r: Reservation) => {
    setEditing(r);
    setFormOpen(true);
  };

  const setStatus = (r: Reservation, next: ReservationStatus) =>
    updateReservation.mutate({ id: r._id, data: { status: next } });

  const confirmCancel = async () => {
    if (!cancelling) return;
    try {
      await updateReservation.mutateAsync({ id: cancelling._id, data: { status: "Cancelled" } });
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

  const isFiltered = status !== ALL || date !== "";
  const clearFilters = () => {
    setStatusFilter(ALL);
    setDate("");
  };

  const list = reservations.data ?? [];
  const busy = updateReservation.isPending;

  return (
    <>
      <PageHeader
        eyebrow="Service"
        title="Reservations"
        description="Manage table bookings and seating."
        actions={
          <Button onClick={openAdd} className={BRAND_CONTROL_CLASS}>
            <Plus className="mr-2 h-4 w-4" /> New reservation
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={status} onValueChange={setStatusFilter}>
          <SelectTrigger className={cn(BRAND_CONTROL_CLASS, "sm:w-44")} aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {RESERVATION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DatePicker
          value={date}
          onChange={setDate}
          aria-label="Filter by date"
          className={cn(BRAND_CONTROL_CLASS, "sm:w-44")}
        />
        {date && (
          <Button variant="ghost" className={BRAND_CONTROL_CLASS} onClick={() => setDate("")}>
            Clear date
          </Button>
        )}
      </div>

      {reservations.isLoading ? (
        <div className={cn("space-y-2 rounded-lg border p-4", BRAND_PANEL_CLASS)}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : reservations.isError && reservations.data === undefined ? (
        <ErrorState
          title="Couldn't load reservations"
          description="Check the internet connection, then try again."
          onRetry={() => void reservations.refetch()}
          retryLabel="Try again"
        />
      ) : reservations.isPaused && reservations.data === undefined ? (
        // A parked (offline) query has no data AND no error — never "No reservations".
        <p role="status" className="text-sm text-muted-foreground">
          You appear to be offline. Reservations will load when the connection is back.
        </p>
      ) : list.length === 0 && isFiltered ? (
        <EmptyState
          icon={<CalendarClock className="h-8 w-8" />}
          title="No reservations match"
          description="Try a different status or date."
          action={
            <Button
              type="button"
              variant="outline"
              className={cn("mt-2", BRAND_CONTROL_CLASS)}
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-8 w-8" />}
          title="No reservations"
          description="Bookings you add will appear here."
          action={
            <Button onClick={openAdd} className={cn("mt-2", BRAND_CONTROL_CLASS)}>
              <Plus className="mr-2 h-4 w-4" /> New reservation
            </Button>
          }
        />
      ) : (
        <>
          <ReservationsTable
            list={list}
            busy={busy}
            onSeat={(row) => setStatus(row, "Seated")}
            onComplete={(row) => setStatus(row, "Completed")}
            onCancel={setCancelling}
            onEdit={openEdit}
            onDelete={setDeleting}
          />

          <div className="space-y-2 lg:hidden">
            {list.map((r) => (
              <ReservationRowCard
                key={r._id}
                reservation={r}
                busy={busy}
                onSeat={(row) => setStatus(row, "Seated")}
                onComplete={(row) => setStatus(row, "Completed")}
                onCancel={setCancelling}
                onEdit={openEdit}
                onDelete={setDeleting}
              />
            ))}
          </div>
        </>
      )}

      <ReservationFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        reservation={editing}
      />

      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
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
        title="Delete reservation?"
        description={
          deleting ? `The booking for "${deleting.name}" will be permanently removed.` : undefined
        }
        confirmLabel="Delete"
        isLoading={deleteReservation.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
