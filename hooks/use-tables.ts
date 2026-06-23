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
import type { Table, UpdateTableInput } from "@/types";

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
export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tableNo, data }: { tableNo: string; data: UpdateTableInput }) =>
      apiSend<Table>(`/api/tables/${tableNo}`, "PUT", data),
    onSuccess: () => toast.success("Table updated"),
    onError: (err: Error) => toast.error(err.message || "Could not update table"),
    onSettled: () => qc.invalidateQueries({ queryKey: TABLE_KEYS.all }),
  });
}
