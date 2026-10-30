"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useMarkOrderReady, useTickKitchenLine } from "@/hooks/use-kitchen";
import type { KitchenRow } from "@/lib/kitchen-board";
import { readyToastMessage, type KitchenOrderCard as KitchenOrderCardData } from "@/lib/kitchen-cards";

/** What the Kitchen board's cards do: tick / un-tick a line, Mark ready, and which of those writes are in flight. */
export interface KitchenActions {
  onToggleLine: (row: KitchenRow, done: boolean) => void;
  onReady: (card: KitchenOrderCardData) => void;
  /** A line (row id) with its tick in flight: that line's control is disabled until its write ends. */
  lineInFlight: (id: string) => boolean;
  /** A card (order id) with its Ready in flight: that card's button is disabled until its write ends. */
  readyInFlight: (orderId: string) => boolean;
}

// The Kitchen board's two writes and their in-flight sets, moved as they were out of the page (U4 Task 1, so the page
// keeps its line budget for the header line, the filter and the strip). Same requests, same bodies, same optimistic
// writes (in use-kitchen.ts), same toasts with their Undo.
export function useKitchenActions(): KitchenActions {
  const tick = useTickKitchenLine();
  const ready = useMarkOrderReady();
  // Row ids with a tick in flight (see onToggleLine — per-row, never global).
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  // Order ids with a Ready tap in flight — its OWN set, so a cook clearing
  // one card never disables the Ready button on another.
  const [readyInFlight, setReadyInFlight] = useState<ReadonlySet<string>>(() => new Set());

  // A ticked line STAYS on the board (only the Ready tap removes a card), so
  // the checkbox can simply flip back — the API already accepts `done:false`.
  // Per-ROW, not one shared `tick.isPending`: a cook ticking several boxes in
  // a row must not have the others silently disabled mid-flight.
  const onToggleLine = (row: KitchenRow, done: boolean) => {
    if (inFlight.has(row.id)) return;
    setInFlight((current) => new Set(current).add(row.id));
    tick.mutate(
      { orderId: row.orderId, ref: row.ref, done },
      {
        onSettled: () =>
          setInFlight((current) => {
            const next = new Set(current);
            next.delete(row.id);
            return next;
          }),
      },
    );
    if (!done) return;
    toast(`${row.qty} × ${row.name} marked done`, {
      action: {
        label: "Undo",
        onClick: () => tick.mutate({ orderId: row.orderId, ref: row.ref, done: false }),
      },
    });
  };

  // Ready button: the ONE action that removes a card. Same per-id in-flight +
  // undo-toast discipline as the tick — clearing the wrong card must be
  // recoverable.
  const onReady = (card: KitchenOrderCardData) => {
    if (readyInFlight.has(card.orderId)) return;
    setReadyInFlight((current) => new Set(current).add(card.orderId));
    ready.mutate(
      // seenFiredAt: what this card actually showed. See MarkOrderReadyInput —
      // it stops the stamp burying a round fired since the last refresh.
      { orderId: card.orderId, ready: true, seenFiredAt: card.newestFiredAt },
      {
        onSettled: () =>
          setReadyInFlight((current) => {
            const next = new Set(current);
            next.delete(card.orderId);
            return next;
          }),
      },
    );
    // The message distinguishes a finished card from one cleared with lines
    // still open — see readyToastMessage for why that matters now.
    toast(readyToastMessage(card), {
      action: {
        label: "Undo",
        onClick: () => ready.mutate({ orderId: card.orderId, ready: false }),
      },
    });
  };

  return {
    onToggleLine,
    onReady,
    lineInFlight: (id) => inFlight.has(id),
    readyInFlight: (orderId) => readyInFlight.has(orderId),
  };
}
