"use client";

import { useEffect, useState } from "react";

import type { useReservationUpdate } from "@/hooks/use-reservation-writes";
import { liveSeatBooking } from "@/lib/reservations-tables";
import { assignedToast, seatedToast, statusToast } from "@/lib/reservations-toasts";
import type { SeatTarget } from "@/components/reservations/ReservationSeatDialog";
import type { Reservation } from "@/types";

/**
 * The seat / assign dialog's state and its writes (U6 Task 3; design 8.2, B13, Q1). It runs on the page's ONE status
 * `useReservationUpdate()` instance (its isPending is the page-wide busy flag): a pick seats (`{ status: "Seated",
 * tableNo }`) or assigns (`{ tableNo }`), "Seat without a table" is `{ status: "Seated" }`; the dialog closes on success
 * and stays open on a failure (the hook's error toast says why).
 */
export function useReservationSeating(update: ReturnType<typeof useReservationUpdate>, list: readonly Reservation[], answered: boolean) {
  const [target, setTarget] = useState<SeatTarget | null>(null);
  const open = (r: Reservation, mode: SeatTarget["mode"]) => setTarget({ r, mode });
  const close = () => setTarget(null);

  // Another device cancelled, deleted or completed the booking meanwhile: the dialog closes (review M9); no write is sent.
  const gone = target !== null && answered && liveSeatBooking(list, target.r._id) === null;
  useEffect(() => {
    if (gone) setTarget(null);
  }, [gone]);

  const send = async (r: Reservation, data: Parameters<typeof update.mutateAsync>[0]["data"], toast: (saved: Reservation) => string) => {
    try {
      await update.mutateAsync({ id: r._id, data, toast });
      setTarget(null);
    } catch {
      // the hook toasts the error; the dialog stays open to try again
    }
  };
  const pick = (tableNo: string) => {
    if (!target) return;
    if (gone) return;
    const { r, mode } = target;
    if (mode === "seat") void send(r, { status: "Seated", tableNo }, (saved) => seatedToast(saved, tableNo));
    else void send(r, { tableNo }, (saved) => assignedToast(saved, tableNo));
  };
  const seatWithoutTable = () => {
    if (target && !gone) void send(target.r, { status: "Seated" }, statusToast("Seated"));
  };

  return { target, open, close, pick, seatWithoutTable };
}
