"use client";

// Fix and send on the POS (Printing Phase 5, spec 5.8, ruling 9; plan Task 14): a fix asked for from Offline orders
// opens the refused entry in the cart (its lines unsent, its table, customer and note; a round on a tab the POS still
// lists opens on that tab; a sale opens the payment sheet), and the send controller is armed: the next send goes
// online under a new key with the entry's offline lines (lib/offline-fix.ts). Clearing the cart disarms it.

import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { cartItemFromOrderItem, type CartItem } from "@/hooks/use-cart";
import { CUSTOMER_KEYS } from "@/hooks/use-customers";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { apiSend } from "@/lib/api-client";
import { finishOfflineFix, fixCartItems, fixRequestBody, offlineFixes, offlineFixOf, type OfflineFix } from "@/lib/offline-fix";
import { offlineOutbox } from "@/lib/offline-outbox-store";
import type { ReplayAnswer } from "@/lib/offline-replay";
import { classifyFailure } from "@/lib/pending-writes";
import { printAgentRequestOptions } from "@/lib/print-agent-calls";
import type { SendJob } from "@/lib/pos-send";
import type { Customer, Order } from "@/types";

/** The armed send: online only (never kept or parked: the old entry stays until the server saves this one). */
export function fixedJob(job: SendJob, fix: OfflineFix, qc: QueryClient, disarm: () => void): SendJob {
  const facts = job.offline;
  if (facts === undefined) return job;
  const url = facts.base === null ? "/api/orders" : `/api/orders/${encodeURIComponent(facts.base._id)}/items`;
  return {
    kind: job.kind,
    scope: job.scope,
    request: async (key) => {
      if (key === undefined) return job.request(key);
      try {
        const answer = await apiSend<ReplayAnswer>(url, "POST", fixRequestBody(facts.body, key, fix, facts.shownTotal), printAgentRequestOptions(job.kind === "pay"));
        const { offline: _echo, ...order } = answer;
        void _echo; // stripped before anything else sees the order
        return order as Order;
      } catch (error) {
        if (classifyFailure(error) !== "uncertain") toast.error(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    confirm: (order, key) => {
      disarm();
      void offlineOutbox.update((record) => finishOfflineFix(record, fix, order._id));
      for (const queryKey of [ORDER_KEYS.all, TABLE_KEYS.all, CUSTOMER_KEYS.all]) void qc.invalidateQueries({ queryKey });
      job.confirm(order, key);
    },
  };
}

/** The open tab the POS still lists (a round's tab), from the orders lists already read: no request. */
export function cachedTab(qc: QueryClient, orderId: string | null): Order | null {
  if (orderId === null) return null;
  for (const [, list] of qc.getQueriesData<Order[]>({ queryKey: ORDER_KEYS.lists })) {
    const tab = Array.isArray(list) ? list.find((order) => order._id === orderId && order.status === "Pending") : undefined;
    if (tab !== undefined) return tab;
  }
  return null;
}

interface OfflineFixPorts {
  armFix: (fix: OfflineFix | null) => void;
  resetOrder: () => void;
  enterResume: (order: Order) => void;
  hydrate: (items: CartItem[]) => void;
  setTable: (table: string | undefined) => void;
  setCustomer: (customer: Customer | undefined) => void;
  setNotes: (notes: string) => void;
  payNow: () => void;
}

export function useOfflineFix(ports: OfflineFixPorts): void {
  const qc = useQueryClient();
  const pending = useSyncExternalStore(offlineFixes.subscribe, offlineFixes.pending, () => null);
  useEffect(() => {
    if (pending === null) return;
    const entry = offlineFixes.take();
    if (entry === null) return;
    const body = (entry.body ?? {}) as Record<string, unknown>;
    const base = entry.kind === "round" ? cachedTab(qc, entry.orderId) : null;
    const lines = fixCartItems(entry);
    if (base !== null) {
      ports.enterResume(base);
      ports.hydrate([...base.items, ...lines].map((line, index) => cartItemFromOrderItem(line, index)));
    } else {
      // A new order, or a round whose tab the POS no longer lists (closed meanwhile): a new order with its lines.
      ports.resetOrder();
      ports.hydrate(lines.map((line, index) => cartItemFromOrderItem(line, index)));
      ports.setTable(entry.table !== "" ? entry.table : undefined);
      const customerId = typeof body.customerId === "string" ? body.customerId : undefined;
      ports.setCustomer(customerId !== undefined ? ({ _id: customerId, name: typeof body.customerName === "string" ? body.customerName : "" } as Customer) : undefined);
      ports.setNotes(typeof body.notes === "string" ? body.notes : "");
    }
    ports.armFix(offlineFixOf(entry));
    if (entry.sale) ports.payNow();
    // The ports are the POS's own setters, read once per fix asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, qc]);
}
