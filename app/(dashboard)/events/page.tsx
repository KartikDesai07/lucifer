"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, PartyPopper, Wallet, Check, X } from "lucide-react";

import {
  useEvents,
  useUpdateEvent,
  useDeleteEvent,
  type EventFilters,
} from "@/hooks/use-events";
import { EVENT_STATUSES, type EventStatus } from "@/lib/constants";
import { formatDate, formatTime, inr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { EventFormSheet } from "@/components/events/EventFormSheet";
import type { Event } from "@/types";

const ALL = "all";

const STATUS_VARIANTS: Record<EventStatus, string> = {
  Booked: "border-blue-300 text-blue-700",
  Completed: "border-green-300 text-green-700",
  Cancelled: "border-red-300 text-red-700",
};

export default function EventsPage() {
  const [status, setStatusFilter] = useState(ALL);

  const filters: EventFilters = {
    status: status === ALL ? undefined : status,
  };
  const events = useEvents(filters);
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Event | null>(null);
  const [deleting, setDeleting] = useState<Event | null>(null);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (e: Event) => {
    setEditing(e);
    setFormOpen(true);
  };

  const receiveBalance = (e: Event) =>
    updateEvent.mutate({ id: e._id, data: { advance: e.payable } });
  const setStatus = (e: Event, next: EventStatus) =>
    updateEvent.mutate({ id: e._id, data: { status: next } });

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteEvent.mutateAsync(deleting._id);
      setDeleting(null);
    } catch {
      // hook toasts on error
    }
  };

  const list = events.data ?? [];
  const busy = updateEvent.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Events</h2>
          <p className="text-sm text-muted-foreground">
            Event bookings with advance payment tracking.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" /> New event
        </Button>
      </div>

      <Select value={status} onValueChange={setStatusFilter}>
        <SelectTrigger className="sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          {EVENT_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {events.isLoading ? (
        <div className="space-y-2 rounded-lg border p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : events.isError ? (
        <ErrorState
          title="Couldn't load events"
          description="There was a problem fetching event bookings. Check your connection and try again."
          onRetry={() => events.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<PartyPopper className="h-8 w-8" />}
          title="No events"
          description="Event bookings you add will appear here."
          action={
            <Button onClick={openAdd} className="mt-2">
              <Plus className="mr-2 h-4 w-4" /> New event
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Payable</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-44 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((e) => {
                const balance = Math.max(0, e.payable - e.advance);
                return (
                  <TableRow key={e._id}>
                    <TableCell className="font-medium">{e.eventName}</TableCell>
                    <TableCell>
                      <div>{formatDate(e.date)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatTime(e.time)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{e.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.mobile}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{inr(e.payable)}</TableCell>
                    <TableCell className="text-right">
                      {balance > 0 ? (
                        <Badge variant="destructive">{inr(balance)}</Badge>
                      ) : (
                        <span className="text-green-600">Paid</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(STATUS_VARIANTS[e.status])}
                      >
                        {e.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {balance > 0 && e.status === "Booked" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            onClick={() => receiveBalance(e)}
                            aria-label="Receive balance"
                            title="Receive balance"
                          >
                            <Wallet className="h-4 w-4 text-green-600" />
                          </Button>
                        )}
                        {e.status === "Booked" && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={busy}
                              onClick={() => setStatus(e, "Completed")}
                              aria-label="Complete event"
                              title="Complete"
                            >
                              <Check className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={busy}
                              onClick={() => setStatus(e, "Cancelled")}
                              aria-label="Cancel event"
                              title="Cancel"
                            >
                              <X className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(e)}
                          aria-label="Edit event"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleting(e)}
                          aria-label="Delete event"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <EventFormSheet open={formOpen} onOpenChange={setFormOpen} event={editing} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete event?"
        description={`"${deleting?.eventName}" will be permanently removed.`}
        confirmLabel="Delete"
        isLoading={deleteEvent.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
