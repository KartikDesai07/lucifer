"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import { STALE_TIMES } from "@/lib/query";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { CUSTOMER_KEYS } from "@/hooks/use-customers";
import type { Order } from "@/types";

// CR2.2 SLICE 9 — the staff order-request tray on the POS screen.

export type OrderRequestStatus = "pending" | "accepting" | "accepted" | "rejected";
export type OrderRequestTargetKind = "table" | "parcel";

export interface TrayOrderRequestItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
  variation?: string;
  modifiers: string[];
  instructions: string;
}

// Hard-typed wire mirror of lib/order-request-tray.ts's TrayRequest — that
// file is server-only (it types against Mongoose document shapes from
// models/OrderRequest.ts), so it can't be imported into this client bundle;
// mirroring the shape by hand is the repo's established pattern (types/index.ts
// re-exports @pos/shared's Order the same way for models/Order.ts). Keep both
// in sync by hand. `createdAt` is a `string` here (not `Date`) — it crosses
// the wire as JSON.
export interface TrayOrderRequest {
  id: string;
  shortCode: string;
  status: OrderRequestStatus;
  targetKind: OrderRequestTargetKind;
  tableNo?: string;
  items: TrayOrderRequestItem[];
  quotedSubtotal: number;
  quotedCharge: number;
  quotedChargeLabel?: string;
  quotedTotal: number;
  promoCode?: string;
  quotedDiscount?: number;
  note?: string;
  name: string;
  // Already role-masked server-side (toTrayRequest) — never re-mask here.
  mobile: string;
  createdAt: string;
  rejectedReason?: string;
  actor?: string;
  acceptedOrderId?: string;
}

export const ORDER_REQUEST_KEYS = {
  all: ["order-requests"] as const,
  pending: ["order-requests", "pending"] as const,
  mutation: ["order-requests", "mutation"] as const,
};

// The staff tray's live list. Never cached (staleTime 0 — same discipline as
// orders, CLAUDE.md §9): a pending request is a diner waiting on an answer.
// Deliberately NO refetchInterval — CR2.3 owns the polling beat; this hook
// only fetches when the tray opens (`enabled`) or its manual Refresh is hit.
// FIX8 — "open" (pending + accepting), not "pending" alone: an "accepting"
// row is a request a staff member started accepting and then lost (a crash,
// a closed tab) before the write finished — it must stay visible so the
// tray can offer Retry accept, not vanish from the list mid-flight.
export function usePendingOrderRequests(enabled: boolean) {
  return useQuery({
    queryKey: ORDER_REQUEST_KEYS.pending,
    queryFn: () => apiGet<TrayOrderRequest[]>("/api/order-requests?status=open"),
    staleTime: STALE_TIMES.LIVE,
    enabled,
  });
}

// CR2.3 §20 — the sidebar's red round badge moved OFF its own poll entirely:
// it now reads openCount straight off PosPulseProvider's shared pulse
// (components/layout/PosPulseProvider.tsx), which is the ONE place polling
// /api/order-requests/pulse. usePendingRequestCount/?count=1 are retired —
// no remaining caller.

interface AcceptResult {
  order: Order;
  request: TrayOrderRequest;
  // FIX10 — true when this accept call landed on an ALREADY-accepted request
  // (a retried/duplicate call reusing the bridge's own replay path). The
  // caller must not re-fire onAccepted (queueKotRound) on this result — the
  // KOT for this request already printed once.
  replayed: boolean;
}

// Accept mints (or updates) an Order, may claim a table, and may create a
// customer — invalidate every tree it can touch. onError ALSO invalidates the
// request keys rather than assuming the accept failed: a thrown fetch doesn't
// say whether the write landed server-side (never-revert-on-write-throw), so
// the tray's own refetch is what shows the truth.
//
// FIX11 (doc note, not a fix) — accepting a round onto a tab the POS
// currently has RESUMED (usePosTab's local cart/round state) leaves that
// local state stale until the operator reopens the tab: the invalidation
// above can't reach into usePosTab's own useState from here. No money is at
// risk (the settle guard catches a stale total), but the cart the cashier is
// staring at can undercount until they resume again. CR2.3's polling pass
// owns closing this gap; not a REQUEST_TOO_OLD_ERROR — a UX gap on the tab
// already open.
export interface UseAcceptOrderRequestOptions {
  // CR2.2 fix round (stranded acceptingId) — called from THIS hook's OWN
  // onSettled below, never from a per-call mutate() options object. Per
  // TanStack Query's own contract, callbacks defined on useMutation itself
  // fire regardless of whether the component that called mutate() is still
  // mounted, while callbacks passed to mutate() are tied to that caller and
  // can silently never fire if it unmounts first — exactly what happened
  // when each OrderRequestCard owned its own mutation instance and reset
  // acceptingId from a per-call onSettled: the card accepting the request
  // drops out of the "open" list on this SAME mutation's own invalidate
  // below, can unmount before settling, and permanently strand acceptingId
  // non-null, locking Accept for every other card. The containing screen
  // (app/(dashboard)/requests/page.tsx — the POS-screen tray this replaced
  // owned it the same way) now owns ONE instance for the whole list and
  // passes this option so hook-level onSettled always runs.
  onSettled?: () => void;
}

export function useAcceptOrderRequest(options?: UseAcceptOrderRequestOptions) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_REQUEST_KEYS.mutation,
    mutationFn: (id: string) =>
      apiSend<AcceptResult>(`/api/order-requests/${id}/accept`, "POST"),
    // FIX10 — a replayed accept did no new work server-side; say so instead
    // of promising a KOT that was already queued (and printed) the first time.
    onSuccess: (result) => {
      if (result.replayed) toast.info("Already accepted earlier — not reprinting the KOT.");
      else toast.success("Order accepted — KOT queued");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not accept the request");
      qc.invalidateQueries({ queryKey: ORDER_REQUEST_KEYS.all });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ORDER_REQUEST_KEYS.all });
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
      qc.invalidateQueries({ queryKey: TABLE_KEYS.all });
      qc.invalidateQueries({ queryKey: CUSTOMER_KEYS.all });
      options?.onSettled?.();
    },
  });
}

// Reject only resolves the request row — no Order, no table, no customer, so
// only the request keys need invalidating.
export function useRejectOrderRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_REQUEST_KEYS.mutation,
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiSend<TrayOrderRequest>(`/api/order-requests/${id}/reject`, "POST", { reason }),
    onSuccess: () => toast.success("Order request rejected"),
    onError: (err: Error) => {
      toast.error(err.message || "Could not reject the request");
      qc.invalidateQueries({ queryKey: ORDER_REQUEST_KEYS.all });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ORDER_REQUEST_KEYS.all }),
  });
}
