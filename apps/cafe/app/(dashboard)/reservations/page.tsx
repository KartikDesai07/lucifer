"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, CalendarClock, ChefHat, Check, X } from "lucide-react";

import {
  useReservations,
  useUpdateReservation,
  useDeleteReservation,
  type ReservationFilters,
} from "@/hooks/use-reservations";
import { RESERVATION_STATUSES, type ReservationStatus } from "@/lib/constants";
import { formatDate, formatTime, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ReservationFormSheet } from "@/components/reservations/ReservationFormSheet";
import type { Reservation } from "@/types";

const ALL = "all";

const STATUS_VARIANTS: Record<ReservationStatus, string> = {
  Booked: "border-blue-300 text-blue-700",
  Seated: "border-green-300 text-green-700",
  Completed: "border-gray-300 text-gray-600",
  Cancelled: "border-red-300 text-red-700",
};

export default function ReservationsPage() {
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

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteReservation.mutateAsync(deleting._id);
      setDeleting(null);
    } catch {
      // hook toasts on error
    }
  };

  const list = reservations.data ?? [];
  const busy = updateReservation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Reservations</h2>
          <p className="text-sm text-muted-foreground">
            Manage table bookings and seating.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" /> New reservation
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={status} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-44">
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
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="sm:w-44"
        />
        {date && (
          <Button variant="ghost" size="sm" onClick={() => setDate("")}>
            Clear date
          </Button>
        )}
      </div>

      {reservations.isLoading ? (
        <div className="space-y-2 rounded-lg border p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : reservations.isError ? (
        <ErrorState
          title="Couldn't load reservations"
          description="There was a problem fetching bookings. Check your connection and try again."
          onRetry={() => reservations.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-8 w-8" />}
          title="No reservations"
          description="Bookings you add will appear here."
          action={
            <Button onClick={openAdd} className="mt-2">
              <Plus className="mr-2 h-4 w-4" /> New reservation
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Guest</TableHead>
                <TableHead className="text-right">Guests</TableHead>
                <TableHead>Table</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-44 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r._id}>
                  <TableCell>
                    <div className="font-medium">{formatDate(r.date)}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatTime(r.time)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.mobile}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{r.guests}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.tableNo ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(STATUS_VARIANTS[r.status])}
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {r.status === "Booked" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busy}
                          onClick={() => setStatus(r, "Seated")}
                          aria-label="Seat guest"
                          title="Seat"
                        >
                          <ChefHat className="h-4 w-4" />
                        </Button>
                      )}
                      {r.status === "Seated" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busy}
                          onClick={() => setStatus(r, "Completed")}
                          aria-label="Complete reservation"
                          title="Complete"
                        >
                          <Check className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
                      {(r.status === "Booked" || r.status === "Seated") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busy}
                          onClick={() => setStatus(r, "Cancelled")}
                          aria-label="Cancel reservation"
                          title="Cancel"
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(r)}
                        aria-label="Edit reservation"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleting(r)}
                        aria-label="Delete reservation"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ReservationFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        reservation={editing}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete reservation?"
        description={`The booking for "${deleting?.name}" will be permanently removed.`}
        confirmLabel="Delete"
        isLoading={deleteReservation.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
