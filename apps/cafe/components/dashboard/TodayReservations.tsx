"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock, ChefHat } from "lucide-react";

import { useUpdateReservation } from "@/hooks/use-reservations";
import { type ReservationStatus } from "@/lib/constants";
import { formatTime, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import type { Reservation } from "@/types";

interface TodayReservationsProps {
  reservations: Reservation[];
  loading?: boolean;
}

const STATUS_VARIANTS: Record<ReservationStatus, string> = {
  Booked: "border-blue-300 text-blue-700",
  Seated: "border-green-300 text-green-700",
  Completed: "border-gray-300 text-gray-600",
  Cancelled: "border-red-300 text-red-700",
};

// Today's active bookings (Booked/Seated), sorted by time, with a one-tap Seat
// action. Cancelled/Completed are filtered out — this is an "upcoming" panel.
export function TodayReservations({
  reservations,
  loading,
}: TodayReservationsProps) {
  const updateReservation = useUpdateReservation();

  const rows = reservations
    .filter((r) => r.status === "Booked" || r.status === "Seated")
    .sort((a, b) => a.time.localeCompare(b.time));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Today&apos;s reservations</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/reservations">
            View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="h-7 w-7" />}
            title="No upcoming reservations"
            description="Today's bookings will appear here."
          />
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li
                key={r._id}
                className="flex items-center gap-3 py-2.5"
              >
                <div className="w-16 shrink-0 text-sm font-medium tabular-nums">
                  {formatTime(r.time)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.guests} guests{r.tableNo ? ` · ${r.tableNo}` : ""}
                  </div>
                </div>
                <Badge variant="outline" className={cn("shrink-0", STATUS_VARIANTS[r.status])}>
                  {r.status}
                </Badge>
                {r.status === "Booked" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    disabled={updateReservation.isPending}
                    onClick={() =>
                      updateReservation.mutate({
                        id: r._id,
                        data: { status: "Seated" },
                      })
                    }
                    aria-label="Seat guest"
                    title="Seat"
                  >
                    <ChefHat className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
