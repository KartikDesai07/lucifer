"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiSend } from "@/lib/api-client";
import { createCrudHooks } from "@/hooks/create-crud-hooks";
import { STALE_TIMES, GC_TIMES } from "@/lib/query";
import type { Product, CreateProductInput, UpdateProductInput } from "@/types";

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
const productHooks = createCrudHooks<
  Product,
  CreateProductInput,
  UpdateProductInput,
  ProductFilters
>({
  path: "/api/products",
  rootKey: PRODUCT_KEYS.all,
  staleTime: STALE_TIMES.PRODUCTS,
  gcTime: GC_TIMES.DEFAULT,
  // Archived list nests under the root key so invalidating PRODUCT_KEYS.all
  // (any mutation) refreshes both the active and archived views.
  listKey: (f) =>
    f?.archived ? [...PRODUCT_KEYS.all, "archived"] : PRODUCT_KEYS.all,
  buildListQuery: (f) => (f?.archived ? "?archived=true" : ""),
  messages: {
    created: "Product added",
    updated: "Product updated",
    deleted: "Product removed",
    createError: "Could not add product",
    updateError: "Could not update product",
    deleteError: "Could not remove product",
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
    onSuccess: () => toast.success("Product archived"),
    onError: (err: Error) =>
      toast.error(err.message || "Could not archive product"),
    onSettled: () => qc.invalidateQueries({ queryKey: PRODUCT_KEYS.all }),
  });
}

// Restore an archived product (PUT isActive:true).
export function useRestoreProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiSend<Product>(`/api/products/${id}`, "PUT", { isActive: true }),
    onSuccess: () => toast.success("Product restored"),
    onError: (err: Error) =>
      toast.error(err.message || "Could not restore product"),
    onSettled: () => qc.invalidateQueries({ queryKey: PRODUCT_KEYS.all }),
  });
}

// Toggle the in-stock / "86" flag (PUT available). One tap from the menu table.
export function useSetProductAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, available }: { id: string; available: boolean }) =>
      apiSend<Product>(`/api/products/${id}`, "PUT", { available }),
    onSuccess: (_data, vars) =>
      toast.success(vars.available ? "Marked available" : "Marked out of stock"),
    onError: (err: Error) =>
      toast.error(err.message || "Could not update availability"),
    onSettled: () => qc.invalidateQueries({ queryKey: PRODUCT_KEYS.all }),
  });
}
