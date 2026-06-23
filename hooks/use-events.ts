"use client";

import { createCrudHooks } from "@/hooks/create-crud-hooks";
import { STALE_TIMES } from "@/lib/query";
import type { Event, CreateEventInput, UpdateEventInput } from "@/types";

export interface EventFilters {
  status?: string;
  date?: string; // YYYY-MM-DD
}

export const EVENT_KEYS = {
  all: ["events"] as const,
  list: (filters: EventFilters) => ["events", "list", filters] as const,
};

function buildQuery(filters: EventFilters): string {
  const sp = new URLSearchParams();
  if (filters.status) sp.set("status", filters.status);
  if (filters.date) sp.set("date", filters.date);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

// Events sorted by date/time (cached 1min when unfiltered, server-side).
const eventHooks = createCrudHooks<
  Event,
  CreateEventInput,
  UpdateEventInput,
  EventFilters
>({
  path: "/api/events",
  rootKey: EVENT_KEYS.all,
  staleTime: STALE_TIMES.EVENTS,
  listKey: EVENT_KEYS.list,
  buildListQuery: buildQuery,
  messages: {
    created: "Event booked",
    updated: "Event updated",
    deleted: "Event deleted",
    createError: "Could not book event",
    updateError: "Could not update event",
    deleteError: "Could not delete event",
  },
});

export const useEvents = eventHooks.useList;
export const useCreateEvent = eventHooks.useCreate;
export const useUpdateEvent = eventHooks.useUpdate;
export const useDeleteEvent = eventHooks.useRemove;
