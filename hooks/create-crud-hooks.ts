"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";

// Toast copy for the three write operations. Kept per-entity (passed in) so the
// generated hooks read exactly like the hand-written ones did.
export interface CrudMessages {
  created: string; // success toast on create — e.g. "Product added"
  updated: string; // success toast on update — e.g. "Product updated"
  deleted: string; // success toast on delete — e.g. "Product removed"
  createError: string; // fallback error toast — e.g. "Could not add product"
  updateError: string;
  deleteError: string;
}

export interface CrudHooksConfig<F> {
  path: string; // API base, e.g. "/api/products"
  rootKey: QueryKey; // broad query key, e.g. ["products"] — the invalidation root
  staleTime: number;
  gcTime?: number;
  messages: CrudMessages;
  // List query key for a given filter set. Defaults to `rootKey` (filterless).
  listKey?: (filters: F) => QueryKey;
  // Query-string builder for the list endpoint. Defaults to "" (no params).
  buildListQuery?: (filters: F) => string;
  // Extra query keys to invalidate alongside `rootKey`, per operation. Lets e.g.
  // deleting a category also refresh the products list (denormalized names).
  extraInvalidate?: {
    create?: QueryKey[];
    update?: QueryKey[];
    remove?: QueryKey[];
  };
}

// Builds the standard list + create/update/delete hooks for a REST-ish entity
// whose API follows the CLAUDE.md §7 envelope. Entities with bespoke behaviour
// (orders' optimistic writes, customers' search) keep their own hooks and can
// still reuse a subset of these.
export function createCrudHooks<T, CreateInput, UpdateInput, F = Record<string, never>>(
  config: CrudHooksConfig<F>,
) {
  const listKey = config.listKey ?? (() => config.rootKey);
  const buildQuery = config.buildListQuery ?? (() => "");

  function invalidate(
    qc: ReturnType<typeof useQueryClient>,
    extra?: QueryKey[],
  ) {
    qc.invalidateQueries({ queryKey: config.rootKey });
    extra?.forEach((key) => qc.invalidateQueries({ queryKey: key }));
  }

  function useList(filters: F = {} as F) {
    return useQuery({
      queryKey: listKey(filters),
      queryFn: () => apiGet<T[]>(`${config.path}${buildQuery(filters)}`),
      staleTime: config.staleTime,
      gcTime: config.gcTime,
    });
  }

  function useCreate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (data: CreateInput) =>
        apiSend<T>(config.path, "POST", data),
      onSuccess: () => toast.success(config.messages.created),
      onError: (err: Error) =>
        toast.error(err.message || config.messages.createError),
      onSettled: () => invalidate(qc, config.extraInvalidate?.create),
    });
  }

  function useUpdate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: ({ id, data }: { id: string; data: UpdateInput }) =>
        apiSend<T>(`${config.path}/${id}`, "PUT", data),
      onSuccess: () => toast.success(config.messages.updated),
      onError: (err: Error) =>
        toast.error(err.message || config.messages.updateError),
      onSettled: () => invalidate(qc, config.extraInvalidate?.update),
    });
  }

  function useRemove() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) =>
        apiSend<{ deleted: true }>(`${config.path}/${id}`, "DELETE"),
      onSuccess: () => toast.success(config.messages.deleted),
      onError: (err: Error) =>
        toast.error(err.message || config.messages.deleteError),
      onSettled: () => invalidate(qc, config.extraInvalidate?.remove),
    });
  }

  return { useList, useCreate, useUpdate, useRemove };
}
