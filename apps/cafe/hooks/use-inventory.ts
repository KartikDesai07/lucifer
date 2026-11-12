"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import type { CreateStockItemInput, UpdateStockItemInput } from "@/schemas";
import type { StockItemDto } from "@/types/inventory";

// Inventory lite, Slice 2: the stock items. Every write refreshes the list; a failed update refreshes it too, so
// the editor's next look is the current row (the item may be gone or renamed meanwhile).
export const INVENTORY_KEYS = {
  all: ["inventory"] as const,
  items: ["inventory", "items"] as const,
};

/** Stock moves with every settled bill, so the list is only briefly fresh; it also refetches when the tab regains focus. */
const STOCK_ITEMS_STALE_MS = 30_000;

/** Every active stock item (any signed-in user). */
export function useStockItems() {
  return useQuery({
    queryKey: INVENTORY_KEYS.items,
    queryFn: () => apiGet<StockItemDto[]>("/api/inventory/items"),
    staleTime: STOCK_ITEMS_STALE_MS,
    refetchOnWindowFocus: true,
  });
}

export function useCreateStockItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStockItemInput) => apiSend<StockItemDto>("/api/inventory/items", "POST", input),
    onSuccess: () => {
      toast.success("Stock item added");
      void qc.invalidateQueries({ queryKey: INVENTORY_KEYS.items });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateStockItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateStockItemInput }) =>
      apiSend<StockItemDto>(`/api/inventory/items/${id}`, "PATCH", input),
    onSuccess: (_item, { input }) => {
      toast.success(input.archived ? "Stock item archived" : "Stock item updated");
      void qc.invalidateQueries({ queryKey: INVENTORY_KEYS.items });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void qc.invalidateQueries({ queryKey: INVENTORY_KEYS.items });
    },
  });
}
