"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import { createCrudHooks } from "@/hooks/create-crud-hooks";
import { STALE_TIMES, GC_TIMES } from "@/lib/query";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { REPORT_KEYS } from "@/hooks/use-reports";
import type {
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
  Order,
} from "@/types";
import type { DuePaymentInput } from "@/schemas";
import type { DuesReceiptMode } from "@/lib/constants";

export const CUSTOMER_KEYS = {
  all: ["customers"] as const,
  search: (q: string) => ["customers", "search", q] as const,
  orders: (id: string) => ["customers", id, "orders"] as const,
  payments: (id: string) => ["customers", id, "payments"] as const,
};

// One row of a customer's due-payment history (admin edit + soft delete,
// CR1.4 follow-up). `mode` is a plain string, not DuesReceiptMode — legacy
// rows recorded before G7 narrowed the enum may still hold other values, and
// the row must render them rather than crash on an unrecognised PAY_STYLES key.
export interface DuePaymentRow {
  _id: string;
  customerId: string;
  amount: number; // rupees — render with inr(), never inrPaise()
  mode: string;
  note?: string;
  receivedBy: string;
  createdAt: string;
  deletedAt?: string;
  deletedBy?: string;
  deleteNote?: string;
  edits?: { at: string; by: string; amount: number; mode: string; note?: string }[];
}

export interface EditDuePaymentInput {
  amount: number;
  mode: DuesReceiptMode;
  note?: string;
}

export interface DeleteDuePaymentInput {
  note: string; // required — the reason a soft-delete must carry
}

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

// Below this the search never fires. Exported because a caller that does not
// know the floor renders a confident "no matches" for a query the server was
// never asked about.
export const CUSTOMER_SEARCH_MIN_CHARS = 2;

// Search customers by name or mobile. Only fires at 2+ chars to avoid hammering
// the (uncached) search endpoint on every keystroke; debounce the input upstream.
export function useCustomerSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: CUSTOMER_KEYS.search(q),
    queryFn: () =>
      apiGet<Customer[]>(`/api/customers?search=${encodeURIComponent(q)}`),
    enabled: q.length >= CUSTOMER_SEARCH_MIN_CHARS,
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

// Record money actually taken against a customer's outstanding balance
// (CR1.4) — staff-accessible: the cashier who takes the cash records it.
// Powers ReceivePaymentDialog, the one write path dues-collection UI uses.
export function useReceiveDuePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: DuePaymentInput }) =>
      apiSend<Customer>(`/api/customers/${id}/payments`, "POST", data),
    onSuccess: () => toast.success("Payment recorded"),
    onError: (err: Error) =>
      toast.error(err.message || "Could not record the payment"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
      // Both are prefix matches: ORDER_KEYS.all covers ORDER_KEYS.summary (the
      // dashboard) and REPORT_KEYS.all covers REPORT_KEYS.range(...) (reports)
      // — the dues figures on both are now stale.
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: REPORT_KEYS.all });
    },
  });
}

// A customer's due-payment history, newest first — drives the Payments tab
// of CustomerHistoryDialog. Only fetched while that tab is mounted (enabled).
export function useCustomerPayments(customerId: string | null) {
  return useQuery({
    queryKey: CUSTOMER_KEYS.payments(customerId ?? ""),
    queryFn: () =>
      apiGet<DuePaymentRow[]>(`/api/customers/${customerId}/payments`),
    enabled: !!customerId,
    staleTime: STALE_TIMES.LIVE,
  });
}

// Admin-only correction of a past due payment. Powers DuePaymentEditDialog.
export function useEditDuePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      customerId,
      paymentId,
      data,
    }: {
      customerId: string;
      paymentId: string;
      data: EditDuePaymentInput;
    }) =>
      apiSend<{ payment: DuePaymentRow; customer: Customer }>(
        `/api/customers/${customerId}/payments/${paymentId}`,
        "PATCH",
        data,
      ),
    onSuccess: () => toast.success("Payment updated"),
    onError: (err: Error) =>
      toast.error(err.message || "Could not update the payment"),
    onSettled: (_data, _err, vars) => {
      // The edited amount moves the customer's balance, the dashboard drawer
      // tally, AND any report range that covers this payment's date — same
      // fan-out as useReceiveDuePayment, plus the payments list itself.
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.payments(vars.customerId) });
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: REPORT_KEYS.all });
    },
  });
}

// Admin-only soft delete of a past due payment — adds the amount back to the
// customer's outstanding due. Powers DuePaymentDeleteDialog.
export function useDeleteDuePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      customerId,
      paymentId,
      data,
    }: {
      customerId: string;
      paymentId: string;
      data: DeleteDuePaymentInput;
    }) =>
      apiSend<{ payment: DuePaymentRow; customer: Customer }>(
        `/api/customers/${customerId}/payments/${paymentId}`,
        "DELETE",
        data,
      ),
    onSuccess: () => toast.success("Payment deleted"),
    onError: (err: Error) =>
      toast.error(err.message || "Could not delete the payment"),
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.payments(vars.customerId) });
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: REPORT_KEYS.all });
    },
  });
}
