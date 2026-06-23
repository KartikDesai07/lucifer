"use client";

import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import { cafeDateString } from "@/lib/utils";
import { STALE_TIMES, GC_TIMES, REFETCH_INTERVALS } from "@/lib/query";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { CUSTOMER_KEYS } from "@/hooks/use-customers";
import type {
  Order,
  OrderSummary,
  CreateOrderInput,
  UpdateOrderInput,
  AddItemsInput,
  SettleOrderInput,
} from "@/types";

export interface OrderFilters {
  status?: string;
  tableNo?: string;
  payment?: string;
  date?: string; // YYYY-MM-DD
  phone?: string; // search by the customer's mobile (server reverse-look-up)
  limit?: number; // override the default 50-row cap (server caps at 200)
}

export const ORDER_KEYS = {
  all: ["orders"] as const,
  lists: ["orders", "list"] as const,
  list: (filters: OrderFilters) => ["orders", "list", filters] as const,
  summary: ["orders", "summary"] as const,
  // Shared mutationKey so live queries can pause auto-refetch while any order
  // write is in flight (prevents a poll/focus refetch clobbering optimistic state).
  mutation: ["orders", "mutation"] as const,
};

// Today's dashboard summary. The server caches it ~30s (TTL.SUMMARY); the client
// polls on the live 30s beat (REFETCH_INTERVALS.SUMMARY) so the KPI cards stay in
// step with the floor / recent-orders widgets beside them during service.
export function useOrderSummary() {
  return useQuery({
    queryKey: ORDER_KEYS.summary,
    queryFn: () => apiGet<OrderSummary>("/api/orders/summary"),
    staleTime: STALE_TIMES.SUMMARY,
    refetchInterval: REFETCH_INTERVALS.SUMMARY,
  });
}

function buildQuery(filters: OrderFilters): string {
  const sp = new URLSearchParams();
  if (filters.status) sp.set("status", filters.status);
  if (filters.tableNo) sp.set("tableNo", filters.tableNo);
  if (filters.payment) sp.set("payment", filters.payment);
  if (filters.date) sp.set("date", filters.date);
  if (filters.phone) sp.set("phone", filters.phone);
  if (filters.limit) sp.set("limit", String(filters.limit));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

// Orders are never cached (staleTime 0) — POS accuracy is critical (CLAUDE.md §9).
// Pass refetchInterval to poll live (e.g. dashboard widgets, Step 6.7).
// refetchOnWindowFocus is on (overriding the global default) so returning to the
// tab during service shows live orders; both auto-refetches pause while an order
// mutation is in flight so they can't clobber the optimistic update mid-write.
export function useOrders(
  filters: OrderFilters = {},
  options: { refetchInterval?: number } = {},
) {
  const isMutating = useIsMutating({ mutationKey: ORDER_KEYS.mutation }) > 0;
  return useQuery({
    queryKey: ORDER_KEYS.list(filters),
    queryFn: () => apiGet<Order[]>(`/api/orders${buildQuery(filters)}`),
    staleTime: STALE_TIMES.LIVE,
    gcTime: GC_TIMES.ORDERS,
    refetchInterval: isMutating ? false : options.refetchInterval,
    refetchOnWindowFocus: !isMutating,
  });
}

// Build a transient optimistic order from the create payload so the orders list
// (when mounted) reflects the new order instantly before the server responds.
// Honors the payload's status/payment (a held tab is Pending/Unpaid, a one-shot
// sale is Completed) so the optimistic row lands in the lists it actually matches.
function optimisticOrder(input: CreateOrderInput): Order {
  return {
    ...input,
    _id: "optimistic",
    orderId: "…",
    discount: input.discount ?? 0,
    items: input.items.map((it) => ({ ...it, kotRound: 1 })),
    kotRounds: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Order;
}

// Whether an order belongs in a list rendered under these filters. Used so the
// optimistic insert only lands in matching lists — prepending to a non-matching
// filtered list (e.g. the dashboard's status:Pending list) would flash a phantom
// row that violates the filter until the refetch reconciles.
function orderMatchesFilters(order: Order, filters: OrderFilters): boolean {
  if (filters.status && order.status !== filters.status) return false;
  if (filters.tableNo && order.tableNo !== filters.tableNo) return false;
  if (filters.payment && order.payment !== filters.payment) return false;
  if (filters.date && cafeDateString(new Date(order.createdAt)) !== filters.date)
    return false;
  // A phone-filtered list is a server-side reverse-look-up (orders carry no
  // phone) — we can't verify the match client-side, so never optimistically
  // inject into it; the list refetches and reconciles on its own.
  if (filters.phone) return false;
  return true;
}

// Pattern B (cache-based optimistic) per CLAUDE.md §9 — POS order creation only.
// The optimistic order must be written to the *list* caches (`['orders','list',f]`)
// the views actually read — writing to `['orders']` alone is a no-op nothing renders.
export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: (data: CreateOrderInput) =>
      apiSend<Order>("/api/orders", "POST", data),
    onMutate: async (newOrder) => {
      // Always cancel in-flight queries before writing the cache (design skill #4).
      await qc.cancelQueries({ queryKey: ORDER_KEYS.all });
      // Snapshot every cached orders list so we can roll all of them back on error.
      const snapshot = qc.getQueriesData<Order[]>({ queryKey: ORDER_KEYS.lists });
      const optimistic = optimisticOrder(newOrder);
      // Prepend only to the lists this order actually belongs in (the filters
      // live at queryKey[2]); never inject a phantom into a non-matching list.
      snapshot.forEach(([key, data]) => {
        if (!data) return;
        const filters = (key[2] ?? {}) as OrderFilters;
        if (orderMatchesFilters(optimistic, filters)) {
          qc.setQueryData<Order[]>(key, [optimistic, ...data]);
        }
      });
      return { snapshot };
    },
    onError: (err: Error, _vars, ctx) => {
      ctx?.snapshot?.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(err.message || "Order failed — please try again");
    },
    onSettled: () => {
      // Reconcile after the write, even on rollback (design skill #5).
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
    },
    onSuccess: (order) => {
      toast.success(`Order ${order.orderId} placed`);
    },
  });
}

// Update an order (status changes, settling dues, table moves). The route
// reconciles customer ledger + table occupancy, so invalidate those too.
export function useUpdateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: ({ id, data }: { id: string; data: UpdateOrderInput }) =>
      apiSend<Order>(`/api/orders/${id}`, "PUT", data),
    onSuccess: () => toast.success("Order updated"),
    onError: (err: Error) =>
      toast.error(err.message || "Could not update order"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
    },
  });
}

// Fire another KOT round on an open tab: append the new items + recompute money
// server-side. No optimistic update — the server assigns the round and the
// authoritative total, and the POS re-hydrates from the returned order; the
// mutationKey pauses live polls while the write is in flight.
export function useAddOrderItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: ({ id, data }: { id: string; data: AddItemsInput }) =>
      apiSend<Order>(`/api/orders/${id}/items`, "POST", data),
    onSuccess: () => toast.success("Sent to kitchen"),
    onError: (err: Error) =>
      toast.error(err.message || "Could not send to kitchen"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
    },
  });
}

// Settle an open tab: take payment server-authoritatively (paidAmount derived
// from the stored total) → Completed + frees the table. The server frees the
// table, so callers must NOT also touch table state.
export function useSettleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: ({ id, data }: { id: string; data: SettleOrderInput }) =>
      apiSend<Order>(`/api/orders/${id}/settle`, "POST", data),
    onSuccess: (order) => toast.success(`Order ${order.orderId} settled`),
    onError: (err: Error) =>
      toast.error(err.message || "Could not settle order"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
    },
  });
}

export function useDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: (id: string) =>
      apiSend<{ deleted: true }>(`/api/orders/${id}`, "DELETE"),
    onSuccess: () => toast.success("Order deleted"),
    onError: (err: Error) =>
      toast.error(err.message || "Could not delete order"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
    },
  });
}
