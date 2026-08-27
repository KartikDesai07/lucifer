"use client";

import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
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

// Add a table to the floor plan (admin config seam).
export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTableInput) => apiSend<Table>("/api/tables", "POST", data),
    onSuccess: () => toast.success("Table added"),
    onError: (err: Error) => toast.error(err.message || "Could not add table"),
    onSettled: () => qc.invalidateQueries({ queryKey: TABLE_KEYS.all }),
  });
}

// Rename and/or re-seat an existing table (admin config seam).
export function usePatchTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tableNo, data }: { tableNo: string; data: PatchTableInput }) =>
      apiSend<Table>(`/api/tables/${encodeURIComponent(tableNo)}`, "PATCH", data),
    onSuccess: () => toast.success("Table updated"),
    onError: (err: Error) => toast.error(err.message || "Could not update table"),
    onSettled: () => qc.invalidateQueries({ queryKey: TABLE_KEYS.all }),
  });
}

// Persist a hand arrangement of the floor plan. Sends the whole ordered list
// (see the route) and seeds the cache from the response, so the arrange
// screen never briefly renders the pre-swap order.
export function useReorderTables() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tableNos: string[]) =>
      apiSend<Table[]>("/api/tables", "PATCH", { tableNos }),
    onSuccess: (tables) => qc.setQueryData(TABLE_KEYS.all, tables),
    onError: (err: Error) => toast.error(err.message || "Could not save the order"),
    onSettled: () => qc.invalidateQueries({ queryKey: TABLE_KEYS.all }),
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
    onSuccess: () => toast.success("Table removed"),
    onError: (err: Error) => toast.error(err.message || "Could not remove table"),
    onSettled: () => qc.invalidateQueries({ queryKey: TABLE_KEYS.all }),
  });
}
