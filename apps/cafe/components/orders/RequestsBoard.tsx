"use client";

import { Inbox } from "lucide-react";

import { OrderRequestCard } from "@/components/orders/OrderRequestCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import type { TrayOrderRequest, useAcceptOrderRequest } from "@/hooks/use-order-requests";
import type { Order } from "@/types";

// Typed off the hook itself so this file and OrderRequestCard can never drift
// on the mutation's variables/result shape (mirrors OrderRequestCard's own
// AcceptMutate).
type AcceptMutate = ReturnType<typeof useAcceptOrderRequest>["mutate"];

interface RequestsBoardProps {
  requests: TrayOrderRequest[];
  isLoading: boolean;
  // True only when the list has NEVER loaded (the page passes a failed load
  // with no data) — a failed background refetch keeps the cards on screen.
  isError: boolean;
  // True when the list has never loaded because the device is offline (a
  // parked query: no data AND no error) — never "No pending requests".
  isOffline: boolean;
  onRetry: () => void;
  onAccepted: (order: Order) => void;
  acceptingId: string | null;
  onAcceptingChange: (id: string | null) => void;
  printBusy: boolean;
  acceptMutate: AcceptMutate;
}

// The full-screen requests grid (owner's ask — moved off the POS-screen
// tray onto its own page). Purely a layout wrapper around OrderRequestCard,
// which owns the accept/reject UI itself; kept separate so
// app/(dashboard)/requests/page.tsx stays focused on the print bridge.
export function RequestsBoard({
  requests,
  isLoading,
  isError,
  isOffline,
  onRetry,
  onAccepted,
  acceptingId,
  onAcceptingChange,
  printBusy,
  acceptMutate,
}: RequestsBoardProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="Couldn't load order requests"
        description="Check the internet connection, then try again."
        onRetry={onRetry}
        retryLabel="Try again"
      />
    );
  }

  if (isOffline) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        You appear to be offline. Order requests will load when the connection is back.
      </p>
    );
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-8 w-8" />}
        title="No pending requests"
        description="Diner orders from the QR menu appear here on their own."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {requests.map((request) => (
        <OrderRequestCard
          key={request.id}
          request={request}
          onAccepted={onAccepted}
          acceptingId={acceptingId}
          onAcceptingChange={onAcceptingChange}
          printBusy={printBusy}
          acceptMutate={acceptMutate}
        />
      ))}
    </div>
  );
}
