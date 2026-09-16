"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiSend } from "@/lib/api-client";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { CUSTOMER_KEYS } from "@/hooks/use-customers";
import type { VoidItemInput } from "@/types";
import type { Order, OrderVoid } from "@/types";

// Dialog-open state + the item-void mutation for the POS terminal (CR1.3-B).
// Mirrors useAddOrderItems' shape exactly (same mutationKey so live polls pause
// mid-write, same three cache invalidations) — a void is just another order
// write from the query cache's point of view.
export function useItemVoid(
  orderId: string | undefined,
  onVoided: (order: Order, entry: OrderVoid) => void,
) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: (data: VoidItemInput) =>
      apiSend<Order>(`/api/orders/${orderId}/items/void`, "POST", data),
    onSuccess: (order) => {
      // The route appends exactly one trail entry per call, so its last row is
      // this void's own snapshot — the authoritative thing to print. Guard the
      // (shouldn't-happen) missing case: no crash, and no fake print without it.
      const entry = order.voids?.at(-1);
      if (!entry) return;
      onVoided(order, entry);
      toast.success("Item voided");
      setOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not void item");
      // A rejection (409 stale view, 400 last-line) means the snapshot the
      // dialog is showing no longer describes the tab — close it rather than
      // let the operator resubmit the same view, since onSettled's invalidation
      // below already refetches a fresh one for the next open (CR1.3 review).
      setOpen(false);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
    },
  });

  const confirm = (payload: VoidItemInput) => {
    if (!orderId) return; // dialog only opens for a resumed (server-backed) tab
    mutation.mutate(payload);
  };

  return {
    open,
    setOpen,
    isPending: mutation.isPending,
    confirm,
  };
}
