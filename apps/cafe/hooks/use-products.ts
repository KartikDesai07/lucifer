"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiSend } from "@/lib/api-client";
import { createCrudHooks } from "@/hooks/create-crud-hooks";
import { STALE_TIMES, GC_TIMES } from "@/lib/query";
import type { BulkProductsInput } from "@pos/shared/schemas";
import type { Product, CreateProductInput, UpdateProductInput, ProductBulkResult } from "@/types";

export const PRODUCT_KEYS = {
  all: ["products"] as const,
};

// List filters. The default (filterless) call lists active products; `archived`
// switches to the soft-deleted set for the management Archived view.
export interface ProductFilters {
  archived?: boolean;
}

// Active products, sorted by category then name. Pattern A (UI-based via
// isPending) for management mutations (CLAUDE.md §9).
//
// Master data (CB-DL-1): the products list is seeded once per page load from
// GET /api/bootstrap (MasterDataProvider) and served from the tab's own copy
// afterwards. The 5-min background poll this hook used to run is gone — it was
// exactly the recurring query the owner rule removes; a price change or an "86"
// made on another device reaches this terminal on its next page refresh (and
// immediately in the tab that made the change, which still invalidates
// PRODUCT_KEYS.all).
const productHooks = createCrudHooks<
  Product,
  CreateProductInput,
  UpdateProductInput,
  ProductFilters
>({
  path: "/api/products",
  rootKey: PRODUCT_KEYS.all,
  staleTime: STALE_TIMES.MASTERS,
  gcTime: GC_TIMES.MASTERS,
  // Archived list nests under the root key so invalidating PRODUCT_KEYS.all
  // (any mutation) refreshes both the active and archived views.
  listKey: (f) =>
    f?.archived ? [...PRODUCT_KEYS.all, "archived"] : PRODUCT_KEYS.all,
  buildListQuery: (f) => (f?.archived ? "?archived=true" : ""),
  messages: {
    created: "Item added",
    updated: "Item updated",
    deleted: "Item removed",
    createError: "Could not add item",
    updateError: "Could not update item",
    deleteError: "Could not remove item",
  },
});

export const useProducts = productHooks.useList;
export const useCreateProduct = productHooks.useCreate;
export const useUpdateProduct = productHooks.useUpdate;

// Archive (soft-delete via DELETE → isActive:false). Distinct from useUpdate so
// the toast reads "archived", not "removed/updated".
export function useArchiveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiSend<{ deleted: true }>(`/api/products/${id}`, "DELETE"),
    onSuccess: () => toast.success("Item archived"),
    onError: (err: Error) =>
      toast.error(err.message || "Could not archive item"),
    onSettled: () => qc.invalidateQueries({ queryKey: PRODUCT_KEYS.all }),
  });
}

// Restore an archived item (PUT isActive:true).
export function useRestoreProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiSend<Product>(`/api/products/${id}`, "PUT", { isActive: true }),
    onSuccess: () => toast.success("Item restored"),
    onError: (err: Error) =>
      toast.error(err.message || "Could not restore item"),
    onSettled: () => qc.invalidateQueries({ queryKey: PRODUCT_KEYS.all }),
  });
}

// Toggle the in-stock flag (PUT available). One tap from the Items list —
// staff-writable (the ROUTE enforces the split, not this hook).
export function useSetProductAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, available }: { id: string; available: boolean }) =>
      apiSend<Product>(`/api/products/${id}`, "PUT", { available }),
    onSuccess: (_data, vars) =>
      toast.success(vars.available ? "Marked in stock" : "Marked out of stock"),
    onError: (err: Error) =>
      toast.error(err.message || "Could not update stock"),
    onSettled: () => qc.invalidateQueries({ queryKey: PRODUCT_KEYS.all }),
  });
}

// Admin-only: show/hide an item on the public QR menu. `visible: false` hides
// it; `visible: true` sends the explicit-clear sentinel (`publicVisible:null`)
// that un-hides back to the omit-empty "shown" default.
export function useSetProductQrVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, visible }: { id: string; visible: boolean }) =>
      apiSend<Product>(`/api/products/${id}`, "PUT", {
        publicVisible: visible ? null : false,
      }),
    onSuccess: (_data, vars) => toast.success(vars.visible ? "Shown on QR menu" : "Hidden from QR menu"),
    onError: (err: Error) => toast.error(err.message || "Could not update QR visibility"),
    onSettled: () => qc.invalidateQueries({ queryKey: PRODUCT_KEYS.all }),
  });
}

// R9 — the bulk bar's single mutation for all 5 actions. Toast copy reads
// `matched` (items the action actually applied to), never `requested` or
// `modified` (timestamps can make modified == matched, but matched is the
// number that answers "how many of my selection changed").
function bulkToast(result: ProductBulkResult): string {
  const n = result.matched;
  const label: Record<string, string> = {
    "out-of-stock": `Marked ${n} item${n === 1 ? "" : "s"} out of stock`,
    "in-stock": `Marked ${n} item${n === 1 ? "" : "s"} in stock`,
    move: `Moved ${n} item${n === 1 ? "" : "s"}`,
    archive: `Archived ${n} item${n === 1 ? "" : "s"}`,
    restore: `Restored ${n} item${n === 1 ? "" : "s"}`,
  };
  return label[result.action] ?? `Updated ${n} item${n === 1 ? "" : "s"}`;
}

export function useBulkProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkProductsInput) =>
      apiSend<ProductBulkResult>("/api/products/bulk", "POST", body),
    onSuccess: (result) => toast.success(bulkToast(result)),
    onError: (err: Error) => toast.error(err.message || "Could not update the selected items"),
    onSettled: () => qc.invalidateQueries({ queryKey: PRODUCT_KEYS.all }),
  });
}
