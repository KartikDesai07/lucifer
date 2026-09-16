"use client";

import { createCrudHooks } from "@/hooks/create-crud-hooks";
import { STALE_TIMES } from "@/lib/query";
import type {
  Reservation,
  CreateReservationInput,
  UpdateReservationInput,
} from "@/types";

export interface ReservationFilters {
  status?: string;
  date?: string; // YYYY-MM-DD
}

export const RESERVATION_KEYS = {
  all: ["reservations"] as const,
  list: (filters: ReservationFilters) =>
    ["reservations", "list", filters] as const,
};

function buildQuery(filters: ReservationFilters): string {
  const sp = new URLSearchParams();
  if (filters.status) sp.set("status", filters.status);
  if (filters.date) sp.set("date", filters.date);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

// Reservations sorted by date/time (cached 1min when unfiltered, server-side).
const reservationHooks = createCrudHooks<
  Reservation,
  CreateReservationInput,
  UpdateReservationInput,
  ReservationFilters
>({
  path: "/api/reservations",
  rootKey: RESERVATION_KEYS.all,
  staleTime: STALE_TIMES.RESERVATIONS,
  listKey: RESERVATION_KEYS.list,
  buildListQuery: buildQuery,
  messages: {
    created: "Reservation booked",
    updated: "Reservation updated",
    deleted: "Reservation deleted",
    createError: "Could not book reservation",
    updateError: "Could not update reservation",
    deleteError: "Could not delete reservation",
  },
});

export const useReservations = reservationHooks.useList;
export const useCreateReservation = reservationHooks.useCreate;
export const useUpdateReservation = reservationHooks.useUpdate;
export const useDeleteReservation = reservationHooks.useRemove;
