"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiSend } from "@/lib/api-client";
import { RESERVATION_KEYS } from "@/hooks/use-reservations";
import { bookedToast, DELETED_TOAST } from "@/lib/reservations-toasts";
import type { CreateReservationInput, Reservation, UpdateReservationInput } from "@/types";

// The /reservations page's three writes, written out (U6 Task 1; design 8.4, 11): the factory's useCreate / useUpdate /
// useRemove (hooks/use-reservations.ts, which the dashboard keeps) with the same requests, the same error toasts and the
// same invalidation (`["reservations"]` once, in onSettled), but a success toast that carries the booking (the HTML's words,
// lib/reservations-toasts.ts; the factory's are fixed strings). The same shape as hooks/use-categories.ts (U5 Task 4).

/** POST: a new booking; "Booked · Tue, 3 Nov, 7:00 PM · 2 guests". */
export function useReservationCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateReservationInput) => apiSend<Reservation>("/api/reservations", "POST", data),
    onSuccess: (saved) => toast.success(bookedToast(saved)),
    onError: (err: Error) => toast.error(err.message || "Could not book reservation"),
    onSettled: () => qc.invalidateQueries({ queryKey: RESERVATION_KEYS.all }),
  });
}

/** What an update says besides the id and the body: the success toast for the saved booking. */
export interface ReservationUpdateVars {
  id: string;
  data: UpdateReservationInput;
  toast: (saved: Reservation) => string;
}

/** PUT: a status change, an assignment or an edit. The page runs ONE instance for every status write: its isPending is the
 *  page-wide busy flag (B13). */
export function useReservationUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: ReservationUpdateVars) => apiSend<Reservation>(`/api/reservations/${id}`, "PUT", data),
    onSuccess: (saved, vars) => toast.success(vars.toast(saved)),
    onError: (err: Error) => toast.error(err.message || "Could not update reservation"),
    onSettled: () => qc.invalidateQueries({ queryKey: RESERVATION_KEYS.all }),
  });
}

/** DELETE: today's words. */
export function useReservationDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend<{ deleted: true }>(`/api/reservations/${id}`, "DELETE"),
    onSuccess: () => toast.success(DELETED_TOAST),
    onError: (err: Error) => toast.error(err.message || "Could not delete reservation"),
    onSettled: () => qc.invalidateQueries({ queryKey: RESERVATION_KEYS.all }),
  });
}
