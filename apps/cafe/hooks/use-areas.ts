"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { AREAS_FRESH_PARAM } from "@/lib/area-order";
import { STALE_TIMES, GC_TIMES } from "@/lib/query";
import { refreshTablesNow } from "@/hooks/use-tables";
import type { Area, CreateAreaInput, RenameAreaInput } from "@/types";

export const AREA_KEYS = {
  all: ["areas"] as const,
};

// The floor areas. A persisted master part (lib/masters-seed): seeded once per
// page load from GET /api/bootstrap and served from the tab's own copy after,
// so the freshness window is the blob's 24 h. A page reload re-fetches it; a
// device that opens with an older copy heals through hooks/use-table-areas.
export function useAreas() {
  return useQuery({
    queryKey: AREA_KEYS.all,
    queryFn: () => apiGet<Area[]>("/api/areas"),
    staleTime: STALE_TIMES.MASTERS,
    gcTime: GC_TIMES.MASTERS,
  });
}

// Every write lands through commitAreas - the commitTables shape in
// hooks/use-tables.ts (read its comment, and N1 in hooks/use-categories.ts): a
// manual cache write would update this tab's memory but never the device's
// stored copy, and a plain invalidate's refetch can land on a still-stale
// server instance (20 s list cache) and paint the old list back. Cancel first
// so the commit never joins an older read already in flight.
// Counts commits. A fresh read that started before a newer commit may carry the
// older list, so refreshAreasNow re-reads once rather than commit it over the
// newer one.
let areasCommitSeq = 0;

export async function commitAreas(qc: QueryClient, list: Area[]): Promise<Area[]> {
  areasCommitSeq += 1;
  await qc.cancelQueries({ queryKey: AREA_KEYS.all, exact: true });
  await qc.invalidateQueries({ queryKey: AREA_KEYS.all, exact: true, refetchType: "none" });
  return qc.fetchQuery({
    queryKey: AREA_KEYS.all,
    queryFn: () => Promise.resolve(list),
    staleTime: 0,
  });
}

// A read that skips the serving instance's list cache, committed as the truth.
// If another commit landed while it was in flight, the read is repeated once
// (that second read started after the commit, so it already includes it).
export async function refreshAreasNow(qc: QueryClient): Promise<Area[]> {
  const readFresh = () => apiGet<Area[]>(`/api/areas?${AREAS_FRESH_PARAM}=1`);
  const seq = areasCommitSeq;
  let fresh = await readFresh();
  if (seq !== areasCommitSeq) fresh = await readFresh();
  return commitAreas(qc, fresh);
}

/** Replace the row with the same _id, else append (a new area sorts last). */
export function withAreaRow(list: readonly Area[], saved: Area): Area[] {
  return list.some((a) => a._id === saved._id)
    ? list.map((a) => (a._id === saved._id ? saved : a))
    : [...list, saved];
}

export function withoutAreaRow(list: readonly Area[], id: string): Area[] {
  return list.filter((a) => a._id !== id);
}

// Commit one row's change onto the cached list. With no list cached yet a
// one-row "list" must never be committed (it would reach the device copy as
// every area) - read the real list instead. A failure here is harmless: the
// cache keeps the last confirmed list.
export async function commitAreaChange(
  qc: QueryClient,
  change: (list: readonly Area[]) => Area[],
): Promise<void> {
  const prev = qc.getQueryData<Area[]>(AREA_KEYS.all);
  try {
    if (prev === undefined) await refreshAreasNow(qc);
    else await commitAreas(qc, change(prev));
  } catch {
    // Cancelled by a newer read (which lands the live list) or offline.
  }
}

async function refreshQuietly(qc: QueryClient): Promise<void> {
  try {
    await refreshAreasNow(qc);
  } catch {
    // Offline: the cache keeps the last confirmed list.
  }
}

// The Areas sheet counts tables from the tables list; a delete the server refused
// as "in use" (409) may mean that list was stale, so re-read it as well.
async function refreshTablesQuietly(qc: QueryClient): Promise<void> {
  try {
    await refreshTablesNow(qc);
  } catch {
    // Offline: the cache keeps the last confirmed list.
  }
}

// Add an area (admin config seam). The mutation settles only AFTER the new area
// is committed to the cache, so a form that creates an area and then saves the
// table with it never sees an id the list does not hold yet. A failure
// (typically a duplicate name) re-reads the list and shows the server copy.
export function useCreateArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateAreaInput) => {
      const created = await apiSend<Area>("/api/areas", "POST", data);
      await commitAreaChange(qc, (list) => withAreaRow(list, created));
      return created;
    },
    onSuccess: () => toast.success("Area added"),
    onError: (err: Error) => {
      toast.error(err.message || "Could not add the area");
      void refreshQuietly(qc);
    },
  });
}

// Rename an area (PUT). The response replaces the row in place - a rename never
// changes the arrangement.
export function useRenameArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: RenameAreaInput["name"] }) =>
      apiSend<Area>(`/api/areas/${encodeURIComponent(id)}`, "PUT", { name }),
    onSuccess: (saved) => {
      toast.success("Area renamed");
      void commitAreaChange(qc, (list) => withAreaRow(list, saved));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not rename the area");
      void refreshQuietly(qc);
    },
  });
}

// Remove an area. The server refuses while any table still uses it (409, with
// the count in its copy), so a success never orphans a table.
export function useDeleteArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiSend<{ deleted: true }>(`/api/areas/${encodeURIComponent(id)}`, "DELETE"),
    onSuccess: (_res, id) => {
      toast.success("Area removed");
      void commitAreaChange(qc, (list) => withoutAreaRow(list, id));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not remove the area");
      void refreshQuietly(qc);
      void refreshTablesQuietly(qc);
    },
  });
}

// Persist a hand arrangement of the areas. Sends the whole ordered id list (the
// route refuses anything but the exact current set with a 409). Mirrors
// useReorderTables: success commits the response; ANY error re-reads the live
// list (this tab may already disagree with the server) and commits it.
// Deliberately NO onSettled invalidate (its refetch can hit a stale instance).
export function useReorderAreas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => apiSend<Area[]>("/api/areas", "PATCH", { ids }),
    onSuccess: (fresh) => commitAreas(qc, fresh),
    onError: async (err: Error) => {
      await refreshQuietly(qc);
      // A 409 carries the server copy (AREA_LIST_CHANGED_ERROR).
      const is409 = err instanceof ApiError && err.status === 409;
      toast.error(is409 ? err.message : "Could not save the new order");
    },
  });
}
