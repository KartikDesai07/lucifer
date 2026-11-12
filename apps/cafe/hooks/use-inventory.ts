"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import type { CreateStockEntryInput, CreateStockItemInput, CreateSupplierInput, UpdateStockItemInput, UpdateSupplierInput } from "@/schemas";
import type { StockEntryDto, StockEntryPageDto, StockItemDto, SupplierDto } from "@/types/inventory";

// Inventory lite, Slice 2: the stock items. Every write refreshes the list; a failed update refreshes it too, so
// the editor's next look is the current row (the item may be gone or renamed meanwhile).
export const INVENTORY_KEYS = {
  all: ["inventory"] as const,
  items: ["inventory", "items"] as const,
  entries: ["inventory", "entries"] as const,
  suppliers: ["inventory", "suppliers"] as const,
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

// Slice 4: wastage, counts and the entries history. A wastage or count moves stock, so both lists refresh after it; on an
// ERROR too, because a 500 ("Saved, but the stock number may be off") means the entry WAS saved. Slice 5: a purchase (and
// deleting one) also moves a supplier's dues, so the suppliers list refreshes with them.
const refreshStockAndEntries = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: INVENTORY_KEYS.items });
  void qc.invalidateQueries({ queryKey: INVENTORY_KEYS.entries });
  void qc.invalidateQueries({ queryKey: INVENTORY_KEYS.suppliers });
};

const ENTRY_SAVED_TOAST: Record<CreateStockEntryInput["kind"], string> = {
  waste: "Wastage logged",
  count: "Stock count saved",
  purchase: "Purchase saved",
};

/** The entries history (admin), newest first, one page at a time; `enabled` keeps staff from ever asking. */
export function useStockEntries(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: INVENTORY_KEYS.entries,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      apiGet<StockEntryPageDto>(`/api/inventory/entries${pageParam === undefined ? "" : `?before=${encodeURIComponent(pageParam)}`}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: StockEntryPageDto) => last.nextBefore,
    staleTime: STOCK_ITEMS_STALE_MS,
    enabled,
  });
}

export function useCreateStockEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStockEntryInput) => apiSend<StockEntryDto>("/api/inventory/entries", "POST", input),
    onSuccess: (_entry, input) => {
      toast.success(ENTRY_SAVED_TOAST[input.kind]);
      refreshStockAndEntries(qc);
    },
    onError: (error: Error) => {
      toast.error(error.message);
      refreshStockAndEntries(qc);
    },
  });
}

export function useDeleteStockEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend<{ deleted: true }>(`/api/inventory/entries/${id}`, "DELETE"),
    onSuccess: () => {
      toast.success("Entry deleted");
      refreshStockAndEntries(qc);
    },
    onError: (error: Error) => {
      toast.error(error.message);
      refreshStockAndEntries(qc);
    },
  });
}

// Slice 5: suppliers (admin). `enabled` keeps staff from ever asking. A failed update refreshes the list too, so the
// editor's next look is the current row (archiving is refused while dues are not 0, and the dues may have moved).
export function useSuppliers(enabled: boolean) {
  return useQuery({
    queryKey: INVENTORY_KEYS.suppliers,
    queryFn: () => apiGet<SupplierDto[]>("/api/inventory/suppliers"),
    staleTime: STOCK_ITEMS_STALE_MS,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSupplierInput) => apiSend<SupplierDto>("/api/inventory/suppliers", "POST", input),
    onSuccess: () => {
      toast.success("Supplier added");
      void qc.invalidateQueries({ queryKey: INVENTORY_KEYS.suppliers });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSupplierInput }) =>
      apiSend<SupplierDto>(`/api/inventory/suppliers/${id}`, "PATCH", input),
    onSuccess: (_supplier, { input }) => {
      toast.success(input.archived ? "Supplier archived" : "Supplier updated");
      void qc.invalidateQueries({ queryKey: INVENTORY_KEYS.suppliers });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void qc.invalidateQueries({ queryKey: INVENTORY_KEYS.suppliers });
    },
  });
}
