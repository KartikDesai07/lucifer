"use client";

import { useEffect } from "react";

import {
  useInfiniteQuery,
  type InfiniteData,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api-client";
import { printAgentRequestOptions } from "@/lib/print-agent-calls";
import { cafeDateString } from "@/lib/utils";
import { STALE_TIMES, GC_TIMES, REFETCH_INTERVALS } from "@/lib/query";
import { firstPageOnly, nextOrderCursor, onePageAtMost } from "@/lib/order-query";
import { classifyFailure, settledMessage } from "@/lib/pending-writes";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { CUSTOMER_KEYS } from "@/hooks/use-customers";
import { PRODUCT_KEYS } from "@/hooks/use-products";
import { refreshMenuNow } from "@/lib/menu-refresh";
import { MENU_REFUSAL_STATUS } from "@/lib/order-availability";
import type {
  Order,
  OrderSummary,
  CreateOrderInput,
  UpdateOrderInput,
  AddItemsInput,
  SettleOrderInput,
  CancelOrderInput,
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
  // Deliberately NOT prefixed by `lists` ("list" vs "infinite" at index 1) —
  // useCreateOrder's optimistic writer targets getQueriesData({queryKey:
  // ORDER_KEYS.lists}) and spreads plain Order[] arrays; if this key shared
  // that prefix, the writer would match an infinite query's {pages,pageParams}
  // cache entry and corrupt it.
  infinite: ["orders", "infinite"] as const,
  infiniteList: (filters: OrderFilters) => ["orders", "infinite", filters] as const,
  summary: (date?: string) => ["orders", "summary", date ?? ""] as const,
  // Shared mutationKey so live queries can pause auto-refetch while any order
  // write is in flight (prevents a poll/focus refetch clobbering optimistic state).
  mutation: ["orders", "mutation"] as const,
};

// Dashboard summary for one cafe-local day. `date` (YYYY-MM-DD) defaults to
// today when omitted (CR1.5 Slice 5 — EOD for staff can review a past day).
// The server caches it ~30s per day (TTL.SUMMARY); the client polls on the
// live 30s beat (REFETCH_INTERVALS.SUMMARY) so the KPI cards stay in step with
// the floor / recent-orders widgets beside them during service. The hook only
// ever receives an explicit `date` for a past day (the EOD picker) — that
// data is immutable, so the poll is wasted (a full M0 aggregation every 30s
// for a figure that will never change); disabled whenever `date` is set.
export function useOrderSummary(date?: string) {
  return useQuery({
    queryKey: ORDER_KEYS.summary(date),
    queryFn: () =>
      apiGet<OrderSummary>(`/api/orders/summary${date ? `?date=${date}` : ""}`),
    staleTime: STALE_TIMES.SUMMARY,
    refetchInterval: date ? false : REFETCH_INTERVALS.SUMMARY,
  });
}

function buildQuery(filters: OrderFilters, before?: string): string {
  const sp = new URLSearchParams();
  if (filters.status) sp.set("status", filters.status);
  if (filters.tableNo) sp.set("tableNo", filters.tableNo);
  if (filters.payment) sp.set("payment", filters.payment);
  if (filters.date) sp.set("date", filters.date);
  if (filters.phone) sp.set("phone", filters.phone);
  if (filters.limit) sp.set("limit", String(filters.limit));
  if (before) sp.set("before", before);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

// Orders are never cached (staleTime 0) — POS accuracy is critical (CLAUDE.md §9).
// Pass refetchInterval to poll live (e.g. dashboard widgets, Step 6.7), and
// gcTime to keep a list longer than GC_TIMES.ORDERS (OPEN_TABS_QUERY_OPTIONS). Pass
// enabled: false to skip the fetch entirely (CR1.5 Slice 5 — EndOfDayButton's
// open-tabs query only makes sense for today, not a past EOD date); omitted,
// it behaves exactly as before (TanStack default: enabled).
// refetchOnWindowFocus is on (overriding the global default) so returning to the
// tab during service shows live orders; both auto-refetches pause while an order
// mutation is in flight so they can't clobber the optimistic update mid-write.
export function useOrders(
  filters: OrderFilters = {},
  options: { refetchInterval?: number; enabled?: boolean; gcTime?: number } = {},
) {
  const isMutating = useIsMutating({ mutationKey: ORDER_KEYS.mutation }) > 0;
  return useQuery({
    queryKey: ORDER_KEYS.list(filters),
    queryFn: () => apiGet<Order[]>(`/api/orders${buildQuery(filters)}`),
    staleTime: STALE_TIMES.LIVE,
    gcTime: options.gcTime ?? GC_TIMES.ORDERS,
    enabled: options.enabled,
    refetchInterval: isMutating ? false : options.refetchInterval,
    refetchOnWindowFocus: !isMutating,
  });
}

// Cursor-paginated ("Load more") orders list — orders/page.tsx. Same never-
// cache staleTime as useOrders; each page requests PAGE_SIZE rows and the next
// page's cursor is the last row's createdAt (nextOrderCursor, lib/order-query).
// Kept as its own hook (not a mode of useOrders) so the plain Order[] list
// query and the {pages,pageParams} infinite query never share a cache entry
// shape — see the ORDER_KEYS.infinite comment above.
const ORDERS_PAGE_SIZE = 50; // mirrors app/api/orders/route.ts's DEFAULT_LIMIT
// How long the Orders page's list survives while nobody is looking at it — six
// times the live lists' GC_TIMES.ORDERS. Coming back to Orders mid-service then
// paints the last rows at once while the refetch runs (staleTime stays 0, so it
// always refetches), instead of a skeleton for a whole round trip on a slow
// counter link. Only the first page is kept (useTrimOrdersListOnLeave below).
export const ORDERS_LIST_GC_MS = 30 * 60 * 1000;
// The POS open-tabs list (and the Dashboard's): polled on the live beat so a tab
// another device opened, grew or settled shows up here, and kept as long as the
// Orders list so coming back paints at once. Declared after ORDERS_LIST_GC_MS,
// which it reads.
export const OPEN_TABS_QUERY_OPTIONS = { refetchInterval: REFETCH_INTERVALS.LIVE_LISTS, gcTime: ORDERS_LIST_GC_MS } as const;

export function useOrdersInfinite(filters: OrderFilters = {}) {
  const pageSize = filters.limit ?? ORDERS_PAGE_SIZE;
  // Same pause-while-mutating mechanism as useOrders: a focus-refetch or poll
  // mid-mutation could clobber optimistic state. The poll runs ONLY while one
  // page is loaded (onePageAtMost) — a timer re-fetching every loaded page, not
  // just the first, on this list is still not wanted.
  const isMutating = useIsMutating({ mutationKey: ORDER_KEYS.mutation }) > 0;
  return useInfiniteQuery({
    queryKey: ORDER_KEYS.infiniteList(filters),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      apiGet<Order[]>(`/api/orders${buildQuery({ ...filters, limit: pageSize }, pageParam)}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: Order[]) => nextOrderCursor(lastPage, pageSize),
    staleTime: STALE_TIMES.LIVE,
    gcTime: ORDERS_LIST_GC_MS,
    refetchInterval: isMutating ? false : (query) => (onePageAtMost(query.state.data) ? REFETCH_INTERVALS.LIVE_LISTS : false),
    refetchOnWindowFocus: !isMutating,
  });
}

// Called by the Orders page: as it closes, every cached list is cut back to its
// first page (firstPageOnly), because TanStack refetches EVERY kept page in
// sequence when a list is shown again — one request on return, not ten. It
// trims the whole ORDER_KEYS.infinite prefix because the Orders page is its
// ONLY reader (every filter combination it visited is one of its own lists); a
// second screen that mounts useOrdersInfinite must scope this to its own keys.
export function useTrimOrdersListOnLeave() {
  const qc = useQueryClient();
  useEffect(
    () => () => {
      qc.setQueriesData<InfiniteData<Order[], string | undefined>>(
        { queryKey: ORDER_KEYS.infinite },
        (data) => firstPageOnly(data),
      );
    },
    [qc],
  );
}

// The optimistic row's id — never a real ObjectId, so it can be found and swapped.
const OPTIMISTIC_ORDER_ID = "optimistic";

// An unanswered write (timeout, offline, 5xx) is shown by the POS's own
// "Couldn't confirm" notice (lib/pos-send.ts), never also as a toast.
const toastsFailure = (err: Error) => classifyFailure(err) !== "uncertain";

// The server ANSWERED that the menu no longer allows a line (Menu B2 — 409 from
// lib/order-availability.ts). A dropped connection or a 5xx is not that.
const isMenuRefusal = (err: Error) =>
  err instanceof ApiError && err.status === MENU_REFUSAL_STATUS;

// Build a transient optimistic order from the create payload so the orders list
// (when mounted) reflects the new order instantly before the server responds.
// Honors the payload's status/payment (a held tab is Pending/Unpaid, a one-shot
// sale is Completed) so the optimistic row lands in the lists it actually matches.
function optimisticOrder(input: CreateOrderInput): Order {
  return {
    ...input,
    _id: OPTIMISTIC_ORDER_ID,
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
    // Session 1C (R1): this hook's one caller (the POS) prints the KOT, and Pay Now's bill, so the
    // server makes both in this request (lib/print-order-jobs.ts).
    mutationFn: (data: CreateOrderInput) =>
      apiSend<Order>("/api/orders", "POST", data, printAgentRequestOptions(data.status === "Completed")),
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
      if (toastsFailure(err)) toast.error(err.message || "Order failed — please try again");
      // A rejected order write can mean the menu moved under this terminal: the
      // list on screen predates the change, so every retry fails the same way.
      // A 409 is the server's own "the menu changed" answer (an item 86'd, a
      // price or size changed): re-read products and categories now, bypassing
      // the server's 20 s cache, so the cart notice can name the lines to fix.
      // The refresh is NOT paired with the plain refetch below — that one is
      // served from the cache and could repaint an older list over it.
      // Any other error keeps the plain products refetch it always had.
      if (isMenuRefusal(err)) void refreshMenuNow(qc).catch(() => undefined);
      else qc.invalidateQueries({ queryKey: PRODUCT_KEYS.all });
    },
    onSettled: () => {
      // Reconcile after the write, even on rollback (design skill #5).
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
    },
    // The POS frees its cart on this answer, so the optimistic row becomes the
    // real order now: until the refetch lands, Open tabs would otherwise offer a
    // phantom "optimistic" tab that no round can be sent to. No toast — the
    // caller's confirm says it once (lib/pos-send.ts).
    onSuccess: (order) => {
      qc.getQueriesData<Order[]>({ queryKey: ORDER_KEYS.lists }).forEach(([key, data]) => {
        if (!data) return;
        const belongs = orderMatchesFilters(order, (key[2] ?? {}) as OrderFilters) && !data.some((o) => o._id === order._id);
        qc.setQueryData<Order[]>(key, data.flatMap((o) => (o._id !== OPTIMISTIC_ORDER_ID ? [o] : belongs ? [order] : [])));
      });
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
      apiSend<Order>(`/api/orders/${id}/items`, "POST", data, printAgentRequestOptions()),
    // No success toast — the POS's confirm says it once, with the round number.
    onError: (err: Error) => {
      if (toastsFailure(err)) toast.error(err.message || "Could not send to kitchen");
      // Same menu-refresh rule as useCreateOrder's onError above.
      if (isMenuRefusal(err)) void refreshMenuNow(qc).catch(() => undefined);
      else qc.invalidateQueries({ queryKey: PRODUCT_KEYS.all });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
    },
  });
}

// Settle an open tab: take payment server-authoritatively (paidAmount derived
// from the stored total) → Completed + frees the table. The server frees the
// table, so callers must NOT also touch table state. No error toast: the one
// caller (hooks/use-settle-flow.ts) shows every failure inside the payment
// popup, and a toast would say it twice. onSettled stays a block body, so
// mutateAsync never waits on the refetches.
export function useSettleOrder(options: { printsBill?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: ({ id, data }: { id: string; data: SettleOrderInput }) =>
      apiSend<Order>(`/api/orders/${id}/settle`, "POST", data, options.printsBill === true ? printAgentRequestOptions(true) : {}),
    onSuccess: (order) => toast.success(settledMessage(order)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
    },
  });
}

// Move a live tab to another table — or, with tableNo: null, unseat it from
// whichever table it currently holds. Invalidates orders + tables only: no
// money and no customer ledger moves, so CUSTOMER_KEYS is deliberately not
// touched (unlike every other order mutation here). TABLE_KEYS is required
// here (not optional cleanup): assign/move/unseat all change table occupancy,
// so the floor plan must refetch after every one of the three verbs.
export function useMoveOrderTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: ({ id, tableNo }: { id: string; tableNo: string | null }) =>
      apiSend<Order>(`/api/orders/${id}/table`, "POST", { tableNo }, printAgentRequestOptions()),
    onError: (err: Error) => toast.error(err.message || "Could not move the table"),
    // No success toast — the caller shows the outcome and prints a slip.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
    },
  });
}

// Admin-only cancel (CR1.3): the order stays on the ledger but stops being a
// sale — reconcileLedger reverses whatever it contributed to the customer's
// visit/spend/due, and the route frees the table same as settle. Same
// invalidation set as useSettleOrder: ORDER_KEYS.all's prefix match already
// covers the summary/dashboard key, so nothing extra is needed for that.
export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: ({ id, data }: { id: string; data: CancelOrderInput }) =>
      apiSend<Order>(`/api/orders/${id}/cancel`, "POST", data),
    onSuccess: (order) => toast.success(`Order ${order.orderId} cancelled`),
    onError: (err: Error) =>
      toast.error(err.message || "Could not cancel order"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
    },
  });
}
