"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import { createCrudHooks } from "@/hooks/create-crud-hooks";
import { STALE_TIMES, GC_TIMES } from "@/lib/query";
import type {
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  Order,
} from "@/types";

export const CUSTOMER_KEYS = {
  all: ["customers"] as const,
  search: (q: string) => ["customers", "search", q] as const,
  orders: (id: string) => ["customers", id, "orders"] as const,
};

// Standard list + create/update/delete. The bespoke search / order-history /
// settle hooks below live outside the factory.
const customerHooks = createCrudHooks<
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput
>({
  path: "/api/customers",
  rootKey: CUSTOMER_KEYS.all,
  staleTime: STALE_TIMES.CUSTOMERS,
  gcTime: GC_TIMES.DEFAULT,
  messages: {
    created: "Customer added",
    updated: "Customer updated",
    deleted: "Customer removed",
    createError: "Could not add customer",
    updateError: "Could not update customer",
    deleteError: "Could not remove customer",
  },
});

// Full customer list for the management page.
export const useCustomers = customerHooks.useList;
// Quick-add a customer (inline from POS or from the customers page).
export const useCreateCustomer = customerHooks.useCreate;
export const useUpdateCustomer = customerHooks.useUpdate;
export const useDeleteCustomer = customerHooks.useRemove;

// Search customers by name or mobile. Only fires at 2+ chars to avoid hammering
// the (uncached) search endpoint on every keystroke; debounce the input upstream.
export function useCustomerSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: CUSTOMER_KEYS.search(q),
    queryFn: () =>
      apiGet<Customer[]>(`/api/customers?search=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
    staleTime: STALE_TIMES.CUSTOMER_SEARCH,
  });
}

// Past orders for one customer — drives the order-history modal. Only fetched
// when the modal is open (enabled).
export function useCustomerOrders(customerId: string | null) {
  return useQuery({
    queryKey: CUSTOMER_KEYS.orders(customerId ?? ""),
    queryFn: () =>
      apiGet<Order[]>(`/api/orders?customerId=${customerId}&limit=100`),
    enabled: !!customerId,
    staleTime: STALE_TIMES.LIVE,
  });
}

// Clear a customer's outstanding dues (admin). Goes through a dedicated,
// authorized endpoint (replaces the old "PUT totalDue:0" path).
export function useSettleCustomerDue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiSend<Customer>(`/api/customers/${id}/settle`, "POST"),
    onSuccess: () => toast.success("Dues cleared"),
    onError: (err: Error) => toast.error(err.message || "Could not settle dues"),
    onSettled: () => qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all }),
  });
}
