"use client";

import { ChefHat } from "lucide-react";

import { useUpdateReservation } from "@/hooks/use-reservations";
import { RESERVATION_KIND } from "@/lib/ui";
import { formatTime } from "@/lib/utils";
import { DashCard } from "@/components/dashboard/DashCard";
import { StatusPill } from "@/components/shared/StatusPill";
import type { Reservation } from "@/types";

interface TodayReservationsProps {
  reservations: Reservation[];
  loading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

const ROW_PX = 52;
const MIN_ROWS = 3;

// Today's active bookings (Booked/Seated), sorted by time, with a one-tap Seat
// action. Cancelled/Completed are filtered out — this is an "upcoming" panel.
export function TodayReservations({ reservations, loading, isError, onRetry }: TodayReservationsProps) {
  const updateReservation = useUpdateReservation();

  const rows = reservations
    .filter((r) => r.status === "Booked" || r.status === "Seated")
    .sort((a, b) => a.time.localeCompare(b.time));
  const status = loading ? "loading" : isError && reservations.length === 0 ? "error" : rows.length === 0 ? "empty" : "ready";

  return (
    <DashCard
      title="Today's reservations"
      period="Booked and seated · by time"
      link={{ href: "/reservations", label: "View all" }}
      status={status}
      onRetry={onRetry}
      empty={{ title: "No bookings left today", description: "New bookings made on the Reservations screen appear here." }}
      bodyMinHeight={MIN_ROWS * ROW_PX}
    >
      <ul className="divide-y divide-brand-rule/70">
        {rows.map((r) => (
          <li key={r._id} className="flex items-center gap-3" style={{ minHeight: ROW_PX }}>
            <div className="w-[4.75rem] shrink-0 whitespace-nowrap rounded-md bg-status-reserved-tint px-1.5 py-1 text-center text-[12.5px] font-semibold tabular-nums text-status-reserved-ink">
              {formatTime(r.time)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium text-brand-ink">{r.name}</div>
              <div className="truncate text-[12px] text-brand-muted">
                {r.guests} guests{r.tableNo ? ` · ${r.tableNo}` : ""}
              </div>
            </div>
            <StatusPill kind={RESERVATION_KIND[r.status]} dot className="shrink-0 text-[11.5px]">
              {r.status}
            </StatusPill>
            {r.status === "Booked" && (
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-brand-ink hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:opacity-50"
                disabled={updateReservation.isPending}
                onClick={() => updateReservation.mutate({ id: r._id, data: { status: "Seated" } })}
                aria-label={`Seat ${r.name}`}
                title="Seat"
              >
                <ChefHat className="h-4 w-4" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </DashCard>
  );
}
