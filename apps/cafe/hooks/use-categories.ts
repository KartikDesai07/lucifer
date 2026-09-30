"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { createCrudHooks } from "@/hooks/create-crud-hooks";
import { STALE_TIMES, GC_TIMES } from "@/lib/query";
import { PRODUCT_KEYS } from "@/hooks/use-products";
import type {
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "@/types";

export const CATEGORY_KEYS = {
  all: ["categories"] as const,
};

// N1 (arbiter-confirmed): MasterDataProvider is the ONLY writer of the
// device's stored master blob, and it deliberately writes back only on a REAL
// fetch success -- every queryClient.setQueryData() call is stamped
// manual:true internally (queryClient.js) and the provider's cache subscriber
// skips those on sight (MasterDataProvider.tsx: "if (event.action.manual ===
// true) return"), so a setQueryData after a reorder/create/recovery would
// update the in-memory cache but never reach the offline copy -- a reload (or
// staying offline) would show the OLD list until the next real /api/bootstrap
// fetch. fetchQuery's own success dispatch carries no `manual` flag (it calls
// Query.setData(data) with no options -- query.js), so routing the write
// through a trivial network-free queryFn makes it indistinguishable, to the
// provider, from a normal background refetch. staleTime: 0 forces fetchQuery
// to actually run that queryFn (and dispatch) every time, rather than
// short-circuiting on an unexpired cache entry -- but only once the entry is
// marked invalidated: a list seeded by the bootstrap carries the SERVER's
// clock as its dataUpdatedAt (lib/masters-seed.ts), which sits in the future
// on a device whose clock runs behind, and fetchQuery would then serve the
// cache and drop this commit (Menu B2 seam; same guard as lib/menu-refresh.ts).
// refetchType "none": the invalidate itself starts no network read. The cancel
// first: fetchQuery JOINS a read already in flight (query-core query.js fetch)
// — New Order's uncached menu refresh is one — and would land ITS older list.
export async function commitCategories(qc: QueryClient, list: Category[]): Promise<Category[]> {
  await qc.cancelQueries({ queryKey: CATEGORY_KEYS.all, exact: true });
  await qc.invalidateQueries({ queryKey: CATEGORY_KEYS.all, exact: true, refetchType: "none" });
  return qc.fetchQuery({
    queryKey: CATEGORY_KEYS.all,
    queryFn: () => Promise.resolve(list),
    staleTime: 0,
  });
}

// Categories sorted by display order then name (near-static). A category can
// only be deleted once it has no products (the route's 409 guard, CB-DL-2),
// so a successful delete can never itself change which category a product
// belongs to — but a stale cached products list could still show a card for
// the category id that was just removed, so the delete still invalidates the
// products list too (extraInvalidate below), just to fix the display rather
// than to follow a server-side cascade that no longer exists.
//
// Master data (CB-DL-1): seeded once per page load from GET /api/bootstrap
// (MasterDataProvider) and served from the tab's own copy afterwards, so the
// freshness window is the blob's 24h; a page refresh re-fetches the bootstrap.
const categoryHooks = createCrudHooks<
  Category,
  CreateCategoryInput,
  UpdateCategoryInput
>({
  path: "/api/categories",
  rootKey: CATEGORY_KEYS.all,
  staleTime: STALE_TIMES.MASTERS,
  gcTime: GC_TIMES.MASTERS,
  messages: {
    created: "Category added",
    updated: "Category updated",
    deleted: "Category removed",
    createError: "Could not add category",
    updateError: "Could not update category",
    deleteError: "Could not remove category",
  },
  extraInvalidate: { remove: [PRODUCT_KEYS.all] },
});

export const useCategories = categoryHooks.useList;
export const useUpdateCategory = categoryHooks.useUpdate;
export const useDeleteCategory = categoryHooks.useRemove;

// Hand-written (not the factory's useCreate): on success the returned doc is
// appended straight to the cached list rather than relying on an invalidate's
// refetch, which can land on a different, still-stale server instance behind
// the load balancer (R12) — the factory has no append hook. Committed via
// commitCategories (N1), not setQueryData, so the new category also reaches
// the offline device blob, not just the in-memory cache.
export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCategoryInput) =>
      apiSend<Category>("/api/categories", "POST", data),
    onSuccess: (created) => {
      toast.success("Category added");
      const prev = qc.getQueryData<Category[]>(CATEGORY_KEYS.all);
      // A concurrent cancel of the categories read can reject this commit; the
      // read that cancelled it lands the live list (with this category) itself.
      void commitCategories(qc, prev ? [...prev, created] : [created]).catch(() => undefined);
    },
    onError: (err: Error) => toast.error(err.message || "Could not add category"),
  });
}

// The drag-and-drop reorder: PATCH the FULL ordered id list (never a partial
// range — the server refuses anything but the exact current set). Mirrors
// useReorderTables, plus the recovery this screen needs that Tables does not:
// ANY failed save (not just a 409) means this tab's list may already disagree
// with the server, so every error re-reads the live list rather than "toast
// and give up".
//
// G3 (arbiter-confirmed): there is deliberately NO onSettled invalidate here.
// invalidateQueries's refetch hits the plain GET, which is served from the
// per-instance cache for up to CATEGORIES's TTL (~20s) -- on a multi-instance
// deploy that refetch can win the race against this hook's own fresher write
// and paint a stale list right back over it. Every path that can change what
// the cache should hold writes it directly via commitCategories instead
// (N1: not setQueryData, so the device blob is kept in sync too): success
// commits the PATCH response, any error commits an uncached ?fresh=1 read.
export function useReorderCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => apiSend<Category[]>("/api/categories", "PATCH", { ids }),
    onSuccess: (fresh) => commitCategories(qc, fresh),
    onError: async (err: Error) => {
      try {
        const fresh = await apiGet<Category[]>("/api/categories?fresh=1");
        await commitCategories(qc, fresh);
      } catch {
        // The refresh-after-error read failed too; the cache keeps whatever
        // it had (still the last confirmed-good list, never the failed write).
      }
      // A 409 carries the server's own plain-English copy
      // (CATEGORY_LIST_CHANGED_ERROR); anything else gets this hook's own.
      const is409 = err instanceof ApiError && err.status === 409;
      toast.error(is409 ? err.message : "Could not save the new order");
    },
  });
}
