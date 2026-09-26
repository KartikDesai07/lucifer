"use client";

import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import { STALE_TIMES, REFETCH_INTERVALS } from "@/lib/query";
import { ORDER_KEYS } from "@/hooks/use-orders";
import type { KitchenOrderCard } from "@/lib/kitchen-cards";

// P4-A — the kitchen board's data hooks. The board query gates its own poll
// (and focus-refetch) on an in-flight ORDER mutation, same idiom as
// use-tables.ts:29-38 — an order write (a new round firing, a void) must not
// race a board refetch. A tick, by contrast, gets its OWN mutationKey below
// so ticking a line never pauses the board's own poll.
export const KITCHEN_KEYS = {
  all: ["kitchen"] as const,
  mutation: ["kitchen", "tick"] as const,
  // P4-B — its own key so clearing a card never pauses the board's poll, the
  // same reasoning the tick key already documents.
  ready: ["kitchen", "ready"] as const,
};

interface KitchenBoardData {
  cards: KitchenOrderCard[];
  tabCount: number;
  generatedAt: string;
}

// Live board for the wall/kitchen screen — 10s poll, kept alive even while
// the tab is unfocused (refetchIntervalInBackground: true) because a wall
// display is never the "focused" tab in the browser's sense.
export function useKitchenBoard() {
  const isMutating = useIsMutating({ mutationKey: ORDER_KEYS.mutation }) > 0;
  return useQuery({
    queryKey: KITCHEN_KEYS.all,
    queryFn: () => apiGet<KitchenBoardData>("/api/kitchen"),
    staleTime: STALE_TIMES.LIVE,
    refetchInterval: isMutating ? false : REFETCH_INTERVALS.KITCHEN,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: !isMutating,
  });
}

interface TickKitchenLineInput {
  orderId: string;
  ref: string;
  done: boolean;
}

// Tick (or un-tick) one collapsed line off the board. Optimistic: the row
// drops (or reappears) immediately, with the previous snapshot captured so a
// failed write can be undone EXACTLY, not just invalidated (auto-memory:
// optimistic-rollback-needs-an-explicit-restore). Its own mutationKey means
// a tick never pauses useKitchenBoard's own poll (that gate watches
// ORDER_KEYS.mutation, not this one).
export function useTickKitchenLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: KITCHEN_KEYS.mutation,
    mutationFn: (input: TickKitchenLineInput) =>
      apiSend<TickKitchenLineInput & { action: "tick" }>("/api/kitchen", "POST", {
        action: "tick",
        ...input,
      }),
    onMutate: async ({ orderId, ref, done }) => {
      await qc.cancelQueries({ queryKey: KITCHEN_KEYS.all });
      const previous = qc.getQueryData<KitchenBoardData>(KITCHEN_KEYS.all);
      if (previous) {
        // P4-B — the line STAYS and flips; the card is what leaves, and only on
        // an explicit Ready. Both directions are optimistic now, so an un-tick
        // shows immediately instead of waiting for the next refetch.
        qc.setQueryData<KitchenBoardData>(KITCHEN_KEYS.all, {
          ...previous,
          cards: previous.cards.map((card) => {
            if (card.orderId !== orderId) return card;
            const lines = card.lines.map((line) =>
              line.ref === ref ? { ...line, done } : line,
            );
            const doneCount = lines.filter((line) => line.done).length;
            return { ...card, lines, doneCount, allDone: doneCount === lines.length };
          }),
        });
      }
      return { previous };
    },
    onError: (err: Error, _input, context) => {
      // Explicit restore — never invalidate-only, or a racing background
      // refetch could re-adopt the failed write's half-applied state.
      if (context?.previous) {
        qc.setQueryData(KITCHEN_KEYS.all, context.previous);
      }
      toast.error(err.message || "Could not update the kitchen line");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KITCHEN_KEYS.all });
    },
    // No onSuccess toast on purpose — a success toast per cooked line is
    // noise on a wall display that a cook glances at all shift.
  });
}

interface MarkOrderReadyInput {
  orderId: string;
  ready: boolean;
}

// P4-B — clear a finished order's card off the board (or put it back). This is
// the ONE action that removes a card: ticking every line only flips `allDone`,
// which is what surfaces the button. Optimistic, with the same explicit
// snapshot-and-restore discipline the tick uses — an invalidate-only rollback
// would let a racing background refetch re-adopt the failed write's state.
export function useMarkOrderReady() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: KITCHEN_KEYS.ready,
    mutationFn: (input: MarkOrderReadyInput) =>
      apiSend<MarkOrderReadyInput & { action: "ready" }>("/api/kitchen", "POST", {
        action: "ready",
        ...input,
      }),
    onMutate: async ({ orderId, ready }) => {
      await qc.cancelQueries({ queryKey: KITCHEN_KEYS.all });
      const previous = qc.getQueryData<KitchenBoardData>(KITCHEN_KEYS.all);
      if (previous && ready) {
        qc.setQueryData<KitchenBoardData>(KITCHEN_KEYS.all, {
          ...previous,
          cards: previous.cards.filter((card) => card.orderId !== orderId),
        });
      }
      return { previous };
    },
    onError: (err: Error, _input, context) => {
      if (context?.previous) {
        qc.setQueryData(KITCHEN_KEYS.all, context.previous);
      }
      toast.error(err.message || "Could not clear that order");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KITCHEN_KEYS.all });
    },
  });
}
