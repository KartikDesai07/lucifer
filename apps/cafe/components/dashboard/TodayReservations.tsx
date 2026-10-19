"use client";

import { useUpdateReservation } from "@/hooks/use-reservations";
import { RESERVATION_KIND, STATUS_CLASSES } from "@/lib/ui";
import { cn, formatTime } from "@/lib/utils";
import { plural } from "@/lib/dashboard/format";
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { DASH_PILL_CLASS, DashCard } from "@/components/dashboard/DashCard";
import type { Reservation } from "@/types";

interface TodayReservationsProps {
  reservations: Reservation[];
  loading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/** A row (values 3.8): 10px + the 34px name and table lines + 10px, over its 1px rule. */
const ROW_PX = 55;
const MIN_ROWS = 3;

// The HTML's 30px outline button ("Seat", values 3.8).
const SEAT_CLASS = cn(
  "h-[30px] rounded-[8px] border border-border bg-card px-[11px] text-[12.5px] font-medium text-foreground hover:bg-hover outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
  HTML_PRESS_CLASS,
);

/**
 * Today's active bookings (Booked/Seated), sorted by time, as the owner's HTML list (values 3.8, ruling R17): the 64px
 * time pill, the guest's name, "{guests} guests · {table}", and "Seat" (our one-tap seat action) — a seated booking
 * shows our "Seated" status as an ok pill in its place. Cancelled/Completed are filtered out: an "upcoming" panel.
 */
export function TodayReservations({ reservations, loading, isError, onRetry }: TodayReservationsProps) {
  const updateReservation = useUpdateReservation();

  const rows = reservations
    .filter((r) => r.status === "Booked" || r.status === "Seated")
    .sort((a, b) => a.time.localeCompare(b.time));
  const status = loading ? "loading" : isError && reservations.length === 0 ? "error" : rows.length === 0 ? "empty" : "ready";

  return (
    <DashCard
      variant="dashboard"
      ui="res-card"
      className="flex flex-col"
      bodyGap={10}
      title="Today's reservations"
      period="Booked and seated · by time"
      link={{ href: "/reservations", label: "View all" }}
      status={status}
      onRetry={onRetry}
      empty={{ title: "No bookings left today", description: "New bookings made on the Reservations screen appear here." }}
      bodyMinHeight={MIN_ROWS * ROW_PX}
    >
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r._id} data-ui="res-row" className="flex items-center gap-3 border-t border-border-2 py-2.5">
            <span
              data-ui="res-time"
              className="flex h-[30px] w-16 flex-none items-center justify-center whitespace-nowrap rounded-[8px] bg-status-reserved-tint text-[12.5px] font-semibold text-status-reserved-ink"
            >
              {formatTime(r.time)}
            </span>
            <span className="min-w-0 flex-1">
              <span data-ui="res-who" className="block truncate text-[14px] font-medium">
                {r.name}
              </span>
              <span data-ui="res-where" className="block text-[12px] text-subtle-foreground">
                {`${plural(r.guests, "guest")}${r.tableNo ? ` · ${r.tableNo}` : ""}`}
              </span>
            </span>
            {r.status === "Booked" ? (
              <button
                type="button"
                data-ui="res-seat"
                className={SEAT_CLASS}
                disabled={updateReservation.isPending}
                onClick={() => updateReservation.mutate({ id: r._id, data: { status: "Seated" } })}
                aria-label={`Seat ${r.name}`}
              >
                Seat
              </button>
            ) : (
              <span data-ui="res-seated" className={cn(DASH_PILL_CLASS, STATUS_CLASSES[RESERVATION_KIND[r.status]].pill)}>
                {r.status}
              </span>
            )}
          </li>
        ))}
      </ul>
    </DashCard>
  );
}
