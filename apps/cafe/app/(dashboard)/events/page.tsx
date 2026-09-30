"use client";

import { useState } from "react";
import { Plus, PartyPopper } from "lucide-react";

import {
  useEvents,
  useUpdateEvent,
  useDeleteEvent,
  type EventFilters,
} from "@/hooks/use-events";
import { EVENT_STATUSES, type EventStatus } from "@/lib/constants";
import { formatDate, inr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { EventFormSheet } from "@/components/events/EventFormSheet";
import { EventRowCard } from "@/components/events/EventRowCard";
import { EventsTable } from "@/components/events/EventsTable";
import type { Event } from "@/types";

const ALL = "all";

// The two actions that ask first: one writes money, the other cannot be undone.
type PendingAction = { kind: "receive" | "cancel"; event: Event };

const balanceOf = (e: Event) => Math.max(0, e.payable - e.advance);

function confirmCopy({ kind, event: e }: PendingAction) {
  if (kind === "receive") {
    return {
      title: "Receive balance?",
      description: `${inr(balanceOf(e))} for "${e.eventName}" will be recorded as paid (${e.payMode}).`,
      confirmLabel: "Receive balance",
      cancelLabel: "Cancel",
    };
  }
  return {
    title: "Cancel this event?",
    description: `"${e.eventName}" on ${formatDate(e.date)} will be marked Cancelled.`,
    confirmLabel: "Cancel event",
    cancelLabel: "Keep event",
  };
}

export default function EventsPage() {
  return (
    <MenuPageShell>
      <EventsContent />
    </MenuPageShell>
  );
}

function EventsContent() {
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
  // `pending` is kept after the dialog closes so its text does not blank out
  // during the exit animation; only `pendingOpen` decides visibility.
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const ask = (kind: PendingAction["kind"], event: Event) => {
    setPending({ kind, event });
    setPendingOpen(true);
  };

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (e: Event) => {
    setEditing(e);
    setFormOpen(true);
  };

  const setStatus = (e: Event, next: EventStatus) =>
    updateEvent.mutate({ id: e._id, data: { status: next } });

  const confirmPending = async () => {
    if (!pending) return;
    const { kind, event: e } = pending;
    try {
      await updateEvent.mutateAsync({
        id: e._id,
        data: kind === "receive" ? { advance: e.payable } : { status: "Cancelled" },
      });
      setPendingOpen(false);
    } catch {
      // hook toasts on error
    }
  };

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
  const copy = pending ? confirmCopy(pending) : null;

  return (
    <>
      <PageHeader
        eyebrow="Manage"
        title="Events"
        description="Event bookings with advance payment tracking."
        actions={
          <Button onClick={openAdd} className={BRAND_CONTROL_CLASS}>
            <Plus className="mr-2 h-4 w-4" /> New event
          </Button>
        }
      />

      <Select value={status} onValueChange={setStatusFilter}>
        <SelectTrigger className={cn(BRAND_CONTROL_CLASS, "sm:w-44")} aria-label="Filter by status">
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
        <div className={cn("space-y-2 rounded-lg border p-4", BRAND_PANEL_CLASS)}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : events.isError && events.data === undefined ? (
        <ErrorState
          title="Couldn't load events"
          description="Check the internet connection, then try again."
          onRetry={() => void events.refetch()}
          retryLabel="Try again"
        />
      ) : events.isPaused && events.data === undefined ? (
        // A parked (offline) query has no data AND no error — never "No events".
        <p role="status" className="text-sm text-muted-foreground">
          You appear to be offline. Events will load when the connection is back.
        </p>
      ) : list.length === 0 && status !== ALL ? (
        <EmptyState
          icon={<PartyPopper className="h-8 w-8" />}
          title="No events match"
          description="Try a different status."
          action={
            <Button
              type="button"
              variant="outline"
              className={cn("mt-2", BRAND_CONTROL_CLASS)}
              onClick={() => setStatusFilter(ALL)}
            >
              Show all events
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<PartyPopper className="h-8 w-8" />}
          title="No events"
          description="Event bookings you add will appear here."
          action={
            <Button onClick={openAdd} className={cn("mt-2", BRAND_CONTROL_CLASS)}>
              <Plus className="mr-2 h-4 w-4" /> New event
            </Button>
          }
        />
      ) : (
        <>
          <EventsTable
            list={list}
            busy={busy}
            onReceiveBalance={(row) => ask("receive", row)}
            onComplete={(row) => setStatus(row, "Completed")}
            onCancel={(row) => ask("cancel", row)}
            onEdit={openEdit}
            onDelete={setDeleting}
          />

          <div className="space-y-2 xl:hidden">
            {list.map((e) => (
              <EventRowCard
                key={e._id}
                event={e}
                busy={busy}
                onReceiveBalance={(row) => ask("receive", row)}
                onComplete={(row) => setStatus(row, "Completed")}
                onCancel={(row) => ask("cancel", row)}
                onEdit={openEdit}
                onDelete={setDeleting}
              />
            ))}
          </div>
        </>
      )}

      <EventFormSheet open={formOpen} onOpenChange={setFormOpen} event={editing} />

      <ConfirmDialog
        open={pendingOpen}
        onOpenChange={setPendingOpen}
        title={copy?.title ?? ""}
        description={copy?.description}
        confirmLabel={copy?.confirmLabel}
        cancelLabel={copy?.cancelLabel}
        destructive={pending?.kind === "cancel"}
        isLoading={updateEvent.isPending}
        onConfirm={confirmPending}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete event?"
        description={deleting ? `"${deleting.eventName}" will be permanently removed.` : undefined}
        confirmLabel="Delete"
        isLoading={deleteEvent.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
