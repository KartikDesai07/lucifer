"use client";

import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { TABLES_FRESH_PARAM } from "@/lib/table-order";
import { STALE_TIMES, REFETCH_INTERVALS } from "@/lib/query";
import { ORDER_KEYS } from "@/hooks/use-orders";
import type {
  CreateTableInput,
  PatchTableInput,
  Table,
  UpdateTableInput,
} from "@/types";

export const TABLE_KEYS = {
  all: ["tables"] as const,
};

// Live table status. 30s TTL + 30s auto-poll so occupancy stays fresh during
// service (CLAUDE.md §9). Order mutations also invalidate ['tables']; the poll
// and focus-refetch pause while an order write is in flight (an order grabs/frees
// a table) so live data can't race the mutation. refetchOnWindowFocus is on so
// returning to the tab refreshes occupancy.
export function useTables() {
  const isMutating = useIsMutating({ mutationKey: ORDER_KEYS.mutation }) > 0;
  return useQuery({
    queryKey: TABLE_KEYS.all,
    queryFn: () => apiGet<Table[]>("/api/tables"),
    staleTime: STALE_TIMES.TABLES,
    refetchInterval: isMutating ? false : REFETCH_INTERVALS.TABLES,
    refetchOnWindowFocus: !isMutating,
  });
}

// Manual status change from the tables overview (Available / Reserved / Occupied).
// Table names are now free text and may contain spaces (CR1.1), so tableNo must
// be URL-encoded — it's a path segment, not just a display label.
export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tableNo, data }: { tableNo: string; data: UpdateTableInput }) =>
      apiSend<Table>(`/api/tables/${encodeURIComponent(tableNo)}`, "PUT", data),
    onSuccess: () => toast.success("Table updated"),
    onError: (err: Error) => toast.error(err.message || "Could not update table"),
    onSettled: () => qc.invalidateQueries({ queryKey: TABLE_KEYS.all }),
  });
}

// Tables redesign (2026-09-30): the floor list is a persisted master part
// (lib/masters-seed), so every write lands through commitTables — the
// commitCategories shape in hooks/use-categories.ts (read its N1 comment):
// setQueryData would update this tab's memory but never the device's stored
// copy, and a plain invalidate's refetch can land on a still-stale server
// instance (5 s list cache) and paint the old list back. Cancel first so the
// commit never joins an older read already in flight.
// Counts commits. A fresh read that started before a newer commit may carry the
// older floor (the save landed on the server after the read was answered), so
// refreshTablesNow re-reads once rather than commit it over the newer list.
let tablesCommitSeq = 0;

export async function commitTables(qc: QueryClient, list: Table[]): Promise<Table[]> {
  tablesCommitSeq += 1;
  await qc.cancelQueries({ queryKey: TABLE_KEYS.all, exact: true });
  await qc.invalidateQueries({ queryKey: TABLE_KEYS.all, exact: true, refetchType: "none" });
  return qc.fetchQuery({
    queryKey: TABLE_KEYS.all,
    queryFn: () => Promise.resolve(list),
    staleTime: 0,
  });
}

// A read that skips the serving instance's list cache, committed as the truth.
// If another commit landed while it was in flight, the read is repeated once
// (that second read started after the commit, so it already includes it).
export async function refreshTablesNow(qc: QueryClient): Promise<Table[]> {
  const readFresh = () => apiGet<Table[]>(`/api/tables?${TABLES_FRESH_PARAM}=1`);
  const seq = tablesCommitSeq;
  let fresh = await readFresh();
  if (seq !== tablesCommitSeq) fresh = await readFresh();
  return commitTables(qc, fresh);
}

/** Replace the row with the same _id, else append (a new table sorts last). */
export function withTableRow(list: readonly Table[], saved: Table): Table[] {
  return list.some((t) => t._id === saved._id)
    ? list.map((t) => (t._id === saved._id ? saved : t))
    : [...list, saved];
}

export function withoutTableRow(list: readonly Table[], tableNo: string): Table[] {
  return list.filter((t) => t.tableNo !== tableNo);
}

// Commit one row's change onto the cached list. With no list cached yet a
// one-row "floor" must never be committed (it would reach the device copy as
// the whole plan) — read the real list instead. A failure here is harmless:
// the cache keeps the last confirmed list and the poll corrects it.
export async function commitTableChange(
  qc: QueryClient,
  change: (list: readonly Table[]) => Table[],
): Promise<void> {
  const prev = qc.getQueryData<Table[]>(TABLE_KEYS.all);
  try {
    if (prev === undefined) await refreshTablesNow(qc);
    else await commitTables(qc, change(prev));
  } catch {
    // Cancelled by a newer read (which lands the live list) or offline.
  }
}

async function refreshQuietly(qc: QueryClient): Promise<void> {
  try {
    await refreshTablesNow(qc);
  } catch {
    // Offline: the cache keeps the last confirmed list.
  }
}

// Add a table to the floor plan (admin config seam).
export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTableInput) => apiSend<Table>("/api/tables", "POST", data),
    // POST gives the new table displayOrder = max + 1, so appending is exact.
    onSuccess: (created) => {
      toast.success("Table added");
      void commitTableChange(qc, (list) => withTableRow(list, created));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not add table");
      void refreshQuietly(qc);
    },
  });
}

// Rename and/or re-seat an existing table (admin config seam).
export function usePatchTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tableNo, data }: { tableNo: string; data: PatchTableInput }) =>
      apiSend<Table>(`/api/tables/${encodeURIComponent(tableNo)}`, "PATCH", data),
    // A rename can move the row (the server sorts un-arranged tables by name),
    // so the server's order is re-read rather than patched in place.
    onSuccess: () => {
      toast.success("Table updated");
      void refreshQuietly(qc);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not update table");
      void refreshQuietly(qc);
    },
  });
}

// Persist a hand arrangement of the floor plan. Sends the whole ordered list
// (the route refuses anything but the exact current set with a 409). Mirrors
// useReorderCategories: success commits the response; ANY error re-reads the
// live list (this tab may already disagree with the server) and commits it.
// Deliberately NO onSettled invalidate (its refetch can hit a stale instance).
export function useReorderTables() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tableNos: string[]) =>
      apiSend<Table[]>("/api/tables", "PATCH", { tableNos }),
    onSuccess: (fresh) => commitTables(qc, fresh),
    onError: async (err: Error) => {
      await refreshQuietly(qc);
      // A 409 carries the server's own plain-English copy (TABLE_LIST_CHANGED_ERROR).
      const is409 = err instanceof ApiError && err.status === 409;
      toast.error(is409 ? err.message : "Could not save the new order");
    },
  });
}

// Mint (or re-mint) a table's public QR token (CR2 admin config seam).
// Re-minting invalidates whatever sticker was already printed for that table
// — the confirmation dialog calling this must say so.
export function useMintTableToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tableNo: string) =>
      apiSend<Table>(`/api/tables/${encodeURIComponent(tableNo)}/token`, "POST"),
    onSuccess: () => toast.success("QR token generated"),
    onError: (err: Error) => toast.error(err.message || "Could not generate a token"),
    onSettled: () => qc.invalidateQueries({ queryKey: TABLE_KEYS.all }),
  });
}

// Remove a table from the floor plan (admin config seam).
export function useDeleteTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tableNo: string) =>
      apiSend<{ deleted: true }>(`/api/tables/${encodeURIComponent(tableNo)}`, "DELETE"),
    onSuccess: (_res, tableNo) => {
      toast.success("Table removed");
      void commitTableChange(qc, (list) => withoutTableRow(list, tableNo));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not remove table");
      void refreshQuietly(qc);
    },
  });
}
